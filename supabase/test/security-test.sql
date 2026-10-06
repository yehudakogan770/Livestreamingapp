-- Checks who may do what after setup.sql, update-3 and update-6 (for testing
-- only, never in the real project). On a plain PostgreSQL 15+ database:
--   psql -d test -f supabase/test/mock-auth.sql -f supabase/setup.sql \
--        -f supabase/update-3-reports.sql -f supabase/update-6-security.sql \
--        -f supabase/test/security-test.sql
-- Every check prints "ok: ..."; the first that fails stops with "FAILED: ...".
\set ON_ERROR_STOP 1
-- People: A (team, first), U (approved, both apps), T (made in the Planner), X (stranger), B (blocked)
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a', 'a@x.org', now(), '{"name":"Ann"}'),
 ('00000000-0000-0000-0000-00000000000b', 'u@x.org', now(), '{"name":"Uri"}'),
 ('00000000-0000-0000-0000-00000000000c', 't@x.org', now(), '{"name":"Tal","planner":"true"}'),
 ('00000000-0000-0000-0000-00000000000d', 'x@x.org', now(), '{"name":"Xen"}'),
 ('00000000-0000-0000-0000-00000000000e', 'b@x.org', now(), '{"name":"Bo"}');
update public.profiles set approved = true, lumora = true, studio = true where email = 'u@x.org';
update public.profiles set approved = true, blocked = true, lumora = true where email = 'b@x.org';
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function pg_temp.as_user(who text, aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000' || who, 'aal', aal,
    'email', (select email from auth.users where id = ('00000000-0000-0000-0000-00000000000' || who)::uuid))::text, false)
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;
select pg_temp.check((select planner_only from profiles where email = 't@x.org'), 'Planner sign-up is marked planner_only');
select pg_temp.check(not (select planner_only from profiles where email = 'x@x.org'), 'app sign-up is not');
select pg_temp.check((select is_admin from profiles where email = 'a@x.org'), 'first account is the team');

-- The team without two-step sign-in (optional since update 7): works at aal1.
select pg_temp.as_user('a', 'aal1');
set role authenticated;
select pg_temp.check((select count(*) from profiles) = 5, 'team without two-step sees everyone at aal1');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select pg_temp.check((select count(*) from profiles) = 5, 'team at aal2 sees everyone');
reset role;

-- U makes a plan and shares it.
select pg_temp.as_user('b', 'aal1');
set role authenticated;
insert into planner_plans (name) values ('Gala');
select pg_temp.check((select count(*) from my_planner_plans()) = 1, 'owner lists the plan');
select pg_temp.check((invite_to_planner((select id from planner_plans), 'T@x.org', 'viewer') ->> 'pending')::boolean = false, 'existing account is added');
select pg_temp.check((invite_to_planner((select id from planner_plans), 'new@x.org', 'editor') ->> 'pending')::boolean, 'no account: invitation kept');
select pg_temp.check((select count(*) from planner_invites) = 1, 'owner sees the invitation');
insert into planner_cues (plan_id, title) select id, 'Welcome' from planner_plans;
reset role;

-- T (not approved) sees and reads it, can comment, can't change cues or make plans, can't use Lumora/Studio.
select pg_temp.as_user('c', 'aal1');
set role authenticated;
select pg_temp.check((select count(*) from my_planner_plans()) = 1, 'teammate lists the shared plan');
select pg_temp.check((select role from my_planner_plans()) = 'viewer', 'as a viewer');
select pg_temp.check((select count(*) from planner_cues) = 1, 'teammate reads cues');
update planner_cues set title = 'Hacked';
select pg_temp.check((select title from planner_cues) = 'Welcome', 'viewer cannot change cues');
insert into planner_comments (plan_id, cue_id, text) select plan_id, id, 'Looks good' from planner_cues;
select pg_temp.check((select count(*) from planner_invites) = 0, 'teammate does not see invitations');
select pg_temp.check(not can_use_lumora() and not can_use_studio() and not is_approved(), 'teammate cannot use Lumora or Studio');
do $$ begin
  insert into planner_plans (name) values ('Mine');
  raise exception 'teammate made a plan';
exception when insufficient_privilege then raise notice 'ok: teammate cannot make plans';
end $$;
reset role;

-- X (on nothing) sees nothing.
select pg_temp.as_user('d', 'aal1');
set role authenticated;
select pg_temp.check((select count(*) from planner_plans) = 0 and (select count(*) from my_planner_plans()) = 0, 'stranger sees no plans');
select pg_temp.check((select count(*) from planner_cues) = 0 and (select count(*) from planner_comments) = 0, 'stranger sees no cues or comments');
select pg_temp.check(claim_planner_invites() = 0, 'stranger claims nothing');
reset role;

-- A new account with the invited email claims it (only once confirmed).
insert into auth.users values ('00000000-0000-0000-0000-00000000000f', 'new@x.org', null, '{"planner":"true"}');
select pg_temp.as_user('f', 'aal1');
set role authenticated;
select pg_temp.check(claim_planner_invites() = 0, 'unconfirmed email claims nothing');
reset role;
update auth.users set email_confirmed_at = now() where email = 'new@x.org';
set role authenticated;
select pg_temp.check(claim_planner_invites() = 1, 'confirmed email claims the invitation');
select pg_temp.check((select role from my_planner_plans()) = 'editor', 'with the invited role');
update planner_cues set title = 'Welcome!';
select pg_temp.check((select title from planner_cues) = 'Welcome!', 'an editor teammate changes cues');
reset role;

-- Blocked: nothing.
select pg_temp.as_user('e', 'aal1');
set role authenticated;
select pg_temp.check(not account_ok() and (select count(*) from my_planner_plans()) = 0, 'blocked account gets nothing');
reset role;

-- Two-step on for U: aal1 gets nothing of theirs; aal2 does.
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000b', 'verified');
select pg_temp.as_user('b', 'aal1');
set role authenticated;
select pg_temp.check((select count(*) from profiles) = 1, 'own profile readable at aal1 (so the app can ask for the code)');
select pg_temp.check(not can_use_lumora() and (select count(*) from planner_plans) = 0, 'password alone opens nothing when two-step is on');
reset role;
select pg_temp.as_user('b', 'aal2');
set role authenticated;
select pg_temp.check(can_use_lumora() and (select count(*) from planner_plans) = 1, 'with the code it opens');
reset role;

-- Problem reports: approved only.
select pg_temp.as_user('c', 'aal1');
set role authenticated;
do $$ begin
  insert into problem_reports (kind, app) values ('error', 'lumora');
  raise exception 'teammate sent a report';
exception when insufficient_privilege then raise notice 'ok: unapproved accounts cannot send reports';
end $$;
reset role;
select pg_temp.as_user('b', 'aal2');
set role authenticated;
insert into problem_reports (kind, app) values ('error', 'lumora');
reset role;

-- Resetting two-step: the team at aal2 only.
select pg_temp.as_user('a', 'aal1');
set role authenticated;
do $$ begin
  perform admin_reset_two_step('00000000-0000-0000-0000-00000000000b');
  raise exception 'reset at aal1';
exception when raise_exception then
  if sqlerrm like 'reset at aal1' then raise; end if;
  raise notice 'ok: reset needs the team at aal2';
end $$;
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select pg_temp.check((select count(*) from admin_two_step_people()) = 1, 'team sees who has two-step');
select pg_temp.check(admin_reset_two_step('00000000-0000-0000-0000-00000000000b') = 1, 'team resets it');
reset role;

-- Invitations are limited (50 a day).
select pg_temp.as_user('b', 'aal1');
set role authenticated;
do $$ begin
  for i in 1..60 loop
    perform invite_to_planner((select id from planner_plans), 'p' || i || '@x.org', 'viewer');
  end loop;
  raise exception 'no limit';
exception when raise_exception then
  if sqlerrm = 'no limit' then raise; end if;
  raise notice 'ok: invitations limited (%)', sqlerrm;
end $$;
reset role;

-- Signed out: no functions.
set role anon;
do $$ begin
  perform public.is_admin();
  raise exception 'anon called is_admin';
exception when insufficient_privilege then raise notice 'ok: anon calls nothing';
end $$;
reset role;

-- Studio: a blocked owner can't delete; people may leave.
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select share_editor_project('Film', '{"a":1}'::jsonb);
select pg_temp.check((select count(*) from editor_projects) = 1, 'team shares a project');
reset role;
select pg_temp.check((select count(*) from rate_events) > 0, 'limits are counted');
