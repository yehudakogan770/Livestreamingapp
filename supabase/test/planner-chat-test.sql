-- Checks who may do what with Planner chat and schedules (update-8-planner.sql;
-- for testing only, never in the real project). On a plain PostgreSQL 15+ database:
--   psql -d test -f supabase/test/mock-auth.sql -f supabase/setup.sql \
--        -f supabase/update-8-planner.sql -f supabase/test/planner-chat-test.sql
-- (update-8 is already in setup.sql; running it again checks that it is safe to re-run.)
-- Every check prints "ok: ..."; the first that fails stops with "FAILED: ...".
\set ON_ERROR_STOP 1
-- People: A (team, first), U (approved owner), T (teammate, editor), V (teammate, viewer), X (stranger)
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a', 'a@x.org', now(), '{"name":"Ann"}'),
 ('00000000-0000-0000-0000-00000000000b', 'u@x.org', now(), '{"name":"Uri"}'),
 ('00000000-0000-0000-0000-00000000000c', 't@x.org', now(), '{"name":"Tal","planner":"true"}'),
 ('00000000-0000-0000-0000-00000000000d', 'v@x.org', now(), '{"name":"Vic","planner":"true"}'),
 ('00000000-0000-0000-0000-00000000000e', 'x@x.org', now(), '{"name":"Xen"}');
update public.profiles set approved = true, lumora = true where email = 'u@x.org';
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function pg_temp.as_user(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000' || who, 'aal', 'aal1',
    'email', (select email from auth.users where id = ('00000000-0000-0000-0000-00000000000' || who)::uuid))::text, false)
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.check((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
  and tablename in ('planner_messages', 'planner_schedule')) = 2, 'chat and schedule are live (Realtime)');

-- U makes a plan, invites T (editor) and V (viewer), writes a message and a block.
select pg_temp.as_user('b');
set role authenticated;
insert into planner_plans (name) values ('Fall gala');
select invite_to_planner((select id from planner_plans), 't@x.org', 'editor');
select invite_to_planner((select id from planner_plans), 'v@x.org', 'viewer');
insert into planner_messages (plan_id, body) select id, '  Doors at 6  ' from planner_plans;
select pg_temp.check((select author_name from planner_messages) = 'Uri', 'message stamped with the author''s name');
select pg_temp.check((select body from planner_messages) = 'Doors at 6', 'message trimmed');
insert into planner_schedule (plan_id, day, starts, ends, title, who)
  select id, '2026-11-14', '15:00', '17:00', 'Load-in', 'Crew' from planner_plans;
select pg_temp.check((select count(*) from planner_schedule) = 1, 'owner adds a schedule block');
reset role;

-- V (viewer, not approved) reads and chats, can't change the schedule; deletes own message only.
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from planner_messages) = 1, 'viewer reads the chat');
insert into planner_messages (plan_id, body) select id, 'Got it' from planner_plans;
select pg_temp.check((select count(*) from planner_messages) = 2, 'viewer sends a message');
delete from planner_messages where body = 'Doors at 6';
select pg_temp.check((select count(*) from planner_messages) = 2, 'viewer cannot delete someone else''s message');
select pg_temp.check((select count(*) from planner_schedule) = 1, 'viewer reads the schedule');
update planner_schedule set title = 'Hacked';
select pg_temp.check((select title from planner_schedule) = 'Load-in', 'viewer cannot change the schedule');
do $$ begin
  insert into planner_schedule (plan_id, title) select id, 'Mine' from planner_plans;
  raise exception 'viewer added a block';
exception when insufficient_privilege then raise notice 'ok: viewer cannot add schedule blocks';
end $$;
insert into planner_messages (plan_id, body, author) select id, 'Mine', '00000000-0000-0000-0000-00000000000b' from planner_plans;
select pg_temp.check((select author from planner_messages where body = 'Mine') = '00000000-0000-0000-0000-00000000000d',
  'nobody writes as someone else (the author is always the sender)');
delete from planner_messages where body = 'Mine';
do $$ begin
  insert into planner_messages (plan_id, body) select id, repeat('a', 2001) from planner_plans;
  raise exception 'long message';
exception when check_violation then raise notice 'ok: messages are at most 2000 characters';
end $$;
delete from planner_messages where body = 'Got it';
select pg_temp.check((select count(*) from planner_messages) = 1, 'author deletes own message');
reset role;

-- T (editor) changes the schedule.
select pg_temp.as_user('c');
set role authenticated;
update planner_schedule set title = 'Load-in and setup';
select pg_temp.check((select title from planner_schedule) = 'Load-in and setup', 'editor changes the schedule');
select pg_temp.check((select updated_by_name from planner_schedule) = 'Tal', 'block stamped with who changed it');
insert into planner_messages (plan_id, body) select id, 'On my way' from planner_plans;
reset role;

-- X (on nothing) sees and writes nothing.
select pg_temp.as_user('e');
set role authenticated;
select pg_temp.check((select count(*) from planner_messages) = 0 and (select count(*) from planner_schedule) = 0, 'stranger sees no chat or schedule');
do $$ begin
  insert into planner_messages (plan_id, body) select id, 'Hi' from planner_plans;
  -- The stranger can't see the plan, so the select above gives no rows: try with the id directly.
  insert into planner_messages (plan_id, body) values ((select plan_id from public.planner_members limit 1), 'Hi');
  raise exception 'stranger sent a message';
exception when insufficient_privilege then raise notice 'ok: stranger cannot send messages';
when not_null_violation then raise notice 'ok: stranger cannot send messages';
end $$;
reset role;

-- The owner deletes anyone's message.
select pg_temp.as_user('b');
set role authenticated;
delete from planner_messages where body = 'On my way';
select pg_temp.check((select count(*) from planner_messages) = 1, 'owner deletes any message');
reset role;

-- Blocked: nothing.
update public.profiles set blocked = true where email = 'v@x.org';
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from planner_messages) = 0, 'blocked account reads no chat');
reset role;

-- At most 30 messages a minute.
select pg_temp.as_user('c');
set role authenticated;
do $$ begin
  for i in 1..40 loop
    insert into planner_messages (plan_id, body) select id, 'm' || i from planner_plans;
  end loop;
  raise exception 'no limit';
exception when raise_exception then
  if sqlerrm = 'no limit' then raise; end if;
  raise notice 'ok: messages limited (%)', sqlerrm;
end $$;
reset role;

-- Deleting the plan deletes its chat and schedule.
select pg_temp.as_user('b');
set role authenticated;
delete from planner_plans;
reset role;
select pg_temp.check((select count(*) from planner_messages) = 0 and (select count(*) from planner_schedule) = 0, 'chat and schedule go with the plan');

-- Signed out: nothing.
set role anon;
do $$ begin
  perform count(*) from planner_messages;
  raise exception 'anon read messages';
exception when insufficient_privilege then raise notice 'ok: signed-out visitors read no chat';
end $$;
reset role;
