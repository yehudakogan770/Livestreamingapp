-- Checks the sign-in settings and features (update-9-sign-in-settings.sql;
-- for testing only, never in the real project). On a plain PostgreSQL 15+ database:
--   psql -d test -f supabase/test/mock-auth.sql -f supabase/setup.sql \
--        -f supabase/update-3-reports.sql -f supabase/update-9-sign-in-settings.sql \
--        -f supabase/test/sign-in-settings-test.sql
-- (update-9 is already in setup.sql; running it again checks that it is safe to re-run.)
-- Every check prints "ok: ..."; the first that fails stops with "FAILED: ...".
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function pg_temp.id(who text) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-00000000000' || who)::uuid
$$;
create or replace function pg_temp.as_user(who text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(who), 'aal', aal,
    'email', (select email from auth.users where id = pg_temp.id(who)))::text, false)
$$;
-- Make an account (confirmed or not), as Supabase does.
create or replace function pg_temp.sign_up(who text, email text, confirmed boolean default true, meta jsonb default '{}') returns void language sql as $$
  insert into auth.users values (pg_temp.id(who), email, case when confirmed then now() end, meta)
$$;
-- Did this fail (with a message like this)?
create or replace function pg_temp.fails(q text, msg text default '%') returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  if sqlerrm not like msg then raise notice 'unexpected error: %', sqlerrm; return false; end if;
  return true;
end $$;
create or replace function pg_temp.approved(who text) returns boolean language sql as $$
  select approved from public.profiles where id = pg_temp.id(who)
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- A: the Lumora team (first account); U: approved, Lumora only.
select pg_temp.sign_up('a', 'a@x.org', true, '{"name":"Ann"}');
select pg_temp.sign_up('b', 'u@x.org');
update public.profiles set approved = true, lumora = true, studio = false where email = 'u@x.org';

-- ---- Defaults: as before ----
select pg_temp.check((select count(*) from app_settings) = 1, 'one settings row');
select pg_temp.sign_up('c', 'new1@x.org');
select pg_temp.check(not pg_temp.approved('c'), 'by default a new account waits for approval');
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((sign_in_rules() ->> 'offline_days')::int = 7 and sign_in_rules() ->> 'signups' = 'open'
  and sign_in_rules() ->> 'two_step' = 'optional' and not (sign_in_rules() ->> 'two_step_required')::boolean, 'default rules');
select pg_temp.check((sign_in_rules() ->> 'can_make_plans')::boolean, 'an approved Lumora account makes plans');
select pg_temp.check((select bool_and(v::boolean) from jsonb_each_text(sign_in_rules() -> 'features') f(k, v)), 'every feature on by default');
select pg_temp.check(sign_ups_open(), 'sign-ups open');
-- Only the team changes or reads the settings.
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"approval":"auto"}')$q$, 'Only the Lumora team%'), 'others cannot change settings');
select pg_temp.check(pg_temp.fails('select admin_app_settings()', 'Only the Lumora team%'), 'others cannot read all settings');
select pg_temp.check(pg_temp.fails('select * from app_settings', '%permission denied%'), 'others cannot read the table');
select pg_temp.check((select count(*) from app_settings_log) = 0, 'others see no change log');
select pg_temp.check(pg_temp.fails($q$select invite_to_lumora('z@x.org', true, false)$q$, 'Only the Lumora team%'), 'others cannot invite');
select pg_temp.check(pg_temp.fails($q$select set_feature_override(pg_temp.id('b'), 'captions', true)$q$, 'Only the Lumora team%'), 'others cannot switch features');
reset role;
set role anon;
select pg_temp.check(sign_ups_open(), 'signed out: can ask whether sign-ups are open');
select pg_temp.check(pg_temp.fails('select sign_in_rules()', '%permission denied%'), 'signed out: no rules');
reset role;

-- ---- New accounts: approved automatically ----
select pg_temp.as_user('a');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"approval":"auto","auto_lumora":false,"auto_studio":false}')$q$, '%at least one app%'),
  'automatic approval needs at least one app');
select save_app_settings('{"approval":"auto","auto_lumora":true,"auto_studio":false}');
reset role;
select pg_temp.check((select updated_by = pg_temp.id('a') and updated_by_name = 'Ann' and updated_at is not null from app_settings), 'who changed it, and when, is kept');
select pg_temp.sign_up('d', 'new2@x.org');
select pg_temp.check(pg_temp.approved('d') and (select lumora and not studio from profiles where id = pg_temp.id('d')), 'confirmed: approved with the chosen apps');
select pg_temp.sign_up('e', 'new3@x.org', false);
select pg_temp.check(not pg_temp.approved('e'), 'email not confirmed: still waiting');
update auth.users set email_confirmed_at = now() where id = pg_temp.id('e');
select pg_temp.check(pg_temp.approved('e'), 'approved once the email is confirmed');
-- Made in the Planner: only when they open Lumora or Studio.
select pg_temp.sign_up('f', 'tal@x.org', true, '{"planner":"true"}');
select pg_temp.check(not pg_temp.approved('f'), 'Planner sign-up is not approved for the apps');
select pg_temp.as_user('f');
set role authenticated;
select request_app_access();
reset role;
select pg_temp.check(pg_temp.approved('f') and not (select planner_only from profiles where id = pg_temp.id('f')), 'approved when they open Lumora');

-- Only some domains.
select pg_temp.as_user('a');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"auto_domains":["not a domain"]}')$q$, '%is not a domain%'), 'domains are checked');
select save_app_settings('{"auto_domains":["@MyCompany.com", " mycompany.com "]}');
select pg_temp.check((admin_app_settings() -> 'settings' -> 'auto_domains') = '["mycompany.com"]', 'domains cleaned up');
reset role;
select pg_temp.sign_up('1', 'out@other.org');
select pg_temp.check(not pg_temp.approved('1'), 'other domains wait');
select pg_temp.sign_up('2', 'in@mycompany.com');
select pg_temp.check(pg_temp.approved('2'), 'your domain is approved');
select pg_temp.as_user('a');
set role authenticated;
select save_app_settings('{"approval":"manual","auto_domains":[]}');
reset role;
select pg_temp.sign_up('3', 'in2@mycompany.com');
select pg_temp.check(not pg_temp.approved('3'), 'back to approval: waits again');

-- ---- New sign-ups closed; invitations ----
select pg_temp.as_user('a');
set role authenticated;
select save_app_settings('{"signups":"closed"}');
select pg_temp.check((invite_to_lumora('Inv@X.org', false, true) ->> 'pending')::boolean, 'an email without an account is invited');
select pg_temp.check((invite_to_lumora('new1@x.org', true, true) ->> 'pending')::boolean = false, 'an existing account is approved at once');
select pg_temp.check((select count(*) from app_invites) = 1, 'the team sees the invitation');
reset role;
select pg_temp.check(pg_temp.approved('c') and (select lumora and studio from profiles where id = pg_temp.id('c')), 'invited existing account has the apps');
set role anon;
select pg_temp.check(not sign_ups_open(), 'signed out: sign-ups closed');
reset role;
select pg_temp.check(pg_temp.fails($q$select pg_temp.sign_up('4', 'stranger@x.org')$q$, 'New sign-ups are closed%'), 'closed: an uninvited email cannot make an account');
select pg_temp.check((select count(*) from profiles where email = 'stranger@x.org') = 0, 'and nothing was made');
select pg_temp.sign_up('5', 'inv@x.org', false);
select pg_temp.check(not pg_temp.approved('5'), 'invited: waits until the email is confirmed');
update auth.users set email_confirmed_at = now() where id = pg_temp.id('5');
select pg_temp.check(pg_temp.approved('5') and (select studio and not lumora from profiles where id = pg_temp.id('5')), 'invited: approved with the invited apps');
select pg_temp.check((select count(*) from app_invites) = 0, 'the invitation is used up');
-- Invited to a Planner plan: may make an account too.
select pg_temp.as_user('b');
set role authenticated;
insert into planner_plans (name) values ('Gala');
select invite_to_planner((select id from planner_plans), 'crew@x.org', 'editor');
reset role;
select pg_temp.sign_up('6', 'crew@x.org', true, '{"planner":"true"}');
select pg_temp.check(not pg_temp.approved('6') and (select planner_only from profiles where id = pg_temp.id('6')), 'invited to a plan: may make an account');
select pg_temp.as_user('a');
set role authenticated;
select save_app_settings('{"signups":"open"}');
reset role;

-- ---- Two-step sign-in ----
select pg_temp.as_user('a');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"two_step":"team"}')$q$, 'Turn on two-step sign-in for your own account first%'),
  'the team cannot lock itself out');
reset role;
insert into auth.mfa_factors (user_id, status) values (pg_temp.id('a'), 'verified');
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"two_step":"team"}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check(can_use_lumora() and not (sign_in_rules() ->> 'two_step_required')::boolean, 'required for the team: others are not asked');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"two_step":"everyone"}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((sign_in_rules() ->> 'two_step_required')::boolean, 'required for everyone: the app is told');
select pg_temp.check(not can_use_lumora() and not account_ok() and (select count(*) from planner_plans) = 0, 'without the code nothing opens');
select pg_temp.check((select count(*) from profiles) = 1, 'own profile still readable (to set it up)');
reset role;
select pg_temp.as_user('b', 'aal2');
set role authenticated;
select pg_temp.check(can_use_lumora() and (select count(*) from planner_plans) = 1, 'with the code it opens');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"two_step":"optional"}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check(can_use_lumora(), 'optional again: the password alone works');
reset role;

-- ---- Offline days, waiting message ----
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"offline_days":5}')$q$, 'Offline use%'), 'offline days: only the listed choices');
select save_app_settings('{"offline_days":14,"waiting_message":"  Call Dana at 555-0100.  "}');
select pg_temp.check(pg_temp.fails(format('select save_app_settings(%L)', jsonb_build_object('waiting_message', repeat('x', 501))), '%at most 500%'), 'waiting message: at most 500 characters');
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"colour":"red"}')$q$, 'Unknown setting%'), 'unknown settings are refused');
reset role;
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.check((sign_in_rules() ->> 'offline_days')::int = 14, 'offline days reach the apps');
select pg_temp.check(sign_in_rules() ->> 'waiting_message' = 'Call Dana at 555-0100.', 'waiting message reaches the apps (trimmed)');
reset role;

-- ---- Planner: who makes plans ----
select pg_temp.as_user('6');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$insert into planner_plans (name) values ('Mine')$q$, '%row-level security%'), 'by default a teammate cannot make plans');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"planner_makers":"anyone"}');
reset role;
select pg_temp.as_user('6');
set role authenticated;
select pg_temp.check((sign_in_rules() ->> 'can_make_plans')::boolean, 'any account: told it can make plans');
insert into planner_plans (name) values ('Crew plan');
select pg_temp.check((select role from my_planner_plans() where name = 'Crew plan') = 'owner', 'any account makes and owns a plan');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"planner_makers":"lumora"}');
reset role;

-- ---- Features ----
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select save_app_settings('{"features":{"teleport":false}}')$q$, 'Unknown feature%'), 'unknown features are refused');
select save_app_settings('{"features":{"planner_chat":false,"captions":false},"pause_messages":{"planner":"Back at 6 PM"}}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check(not feature_on('captions') and not (sign_in_rules() -> 'features' ->> 'captions')::boolean, 'off for everyone');
select pg_temp.check(pg_temp.fails($q$insert into planner_messages (plan_id, body) select id, 'Hi' from planner_plans where name = 'Gala'$q$, 'Planner chat is turned off%'),
  'chat off: no new messages (enforced on the server)');
reset role;
-- One person on, though off for everyone (and the other way round).
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select set_feature_override(pg_temp.id('b'), 'planner_chat', true);
select set_feature_override(pg_temp.id('c'), 'problem_reports', false);
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check(feature_on('planner_chat') and not feature_on('captions'), 'their own setting wins over everyone''s');
insert into planner_messages (plan_id, body) select id, 'Hi' from planner_plans where name = 'Gala';
select pg_temp.check((select count(*) from feature_overrides) = 1, 'people see only their own switches');
reset role;
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.check(not feature_on('problem_reports') and not feature_on('planner_chat'), 'off just for one person');
select pg_temp.check(pg_temp.fails($q$insert into problem_reports (kind, app) values ('error', 'lumora')$q$, 'Problem reports are turned off%'), 'reports off for them (server)');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select set_feature_override(pg_temp.id('b'), 'planner_chat', null);
select pg_temp.check((select count(*) from feature_overrides) = 1, 'back to the setting for everyone');
-- Sharing off.
select save_app_settings('{"features":{"planner_sharing":false,"studio_sharing":false}}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select invite_to_planner((select id from planner_plans where name = 'Gala'), 'more@x.org', 'viewer')$q$, 'Sharing plans is turned off%'),
  'Planner sharing off (server)');
reset role;
select pg_temp.as_user('5');
set role authenticated;
select pg_temp.check(pg_temp.fails($q$select share_editor_project('Film', '{}')$q$, 'Team sharing%'), 'Studio sharing off (server)');
reset role;
-- An app paused: nothing of it opens (except for the team).
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"features":{"planner":false,"studio":false,"planner_sharing":true,"studio_sharing":true}}');
select pg_temp.check(feature_on('planner') and can_use_studio(), 'the team is never paused');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((select count(*) from my_planner_plans()) = 0 and not (sign_in_rules() -> 'features' ->> 'planner')::boolean
  and sign_in_rules() -> 'pause_messages' ->> 'planner' = 'Back at 6 PM', 'Planner paused, with its message');
reset role;
select pg_temp.as_user('5');
set role authenticated;
select pg_temp.check(not can_use_studio(), 'Studio paused');
reset role;
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select save_app_settings('{"features":{"planner":true,"studio":true}}');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((select count(*) from my_planner_plans()) >= 1, 'Planner back on');
reset role;

-- ---- Who changed what, and when ----
select pg_temp.as_user('a', 'aal2');
set role authenticated;
select pg_temp.check((select count(*) from jsonb_array_elements(admin_app_settings() -> 'log') l
  where l ->> 'setting' = 'signups' and l ->> 'by_name' = 'Ann') = 2, 'each change is logged with who made it');
select pg_temp.check((select count(*) from jsonb_array_elements(admin_app_settings() -> 'log') l
  where l ->> 'setting' = 'features.captions' and l -> 'new_value' = 'false') = 1, 'feature changes are logged one by one');
select pg_temp.check((select count(*) from jsonb_array_elements(admin_app_settings() -> 'log') l
  where l ->> 'setting' = 'person.problem_reports' and l ->> 'person_email' = 'new1@x.org') = 1, 'per-person switches are logged');
select pg_temp.check((select count(*) from jsonb_array_elements(admin_app_settings() -> 'log') l
  where l ->> 'setting' = 'invite_used' and l ->> 'person_email' = 'inv@x.org') = 1, 'invitations used are logged');
reset role;
