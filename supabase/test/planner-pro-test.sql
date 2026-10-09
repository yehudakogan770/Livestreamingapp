-- Checks who may do what with the Planner's show day and production tools
-- (update-10-planner-pro.sql; for testing only, never in the real project).
-- On a plain PostgreSQL 15+ database:
--   psql -d test -f supabase/test/mock-auth.sql -f supabase/setup.sql \
--        -f supabase/test/planner-pro-test.sql
-- (It makes a small stand-in for Supabase Storage, then runs update 10 again,
-- which also checks that it is safe to re-run.)
-- Every check prints "ok: ..."; the first that fails stops with "FAILED: ...".
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A stand-in for Supabase Storage.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
set client_min_messages = warning;
\i supabase/update-10-planner-pro.sql
set client_min_messages = notice;

-- People: A (team, first), U (approved owner), T (editor), V (viewer), X (stranger)
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
-- Expect a statement to be refused (any error).
create or replace function pg_temp.refused(q text, what text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise notice 'ok: % (%)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (it was allowed)', what;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.check((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
  and tablename in ('planner_live', 'planner_items', 'planner_files', 'planner_notifications', 'planner_sections')) = 5, 'new tables are live (Realtime)');
select pg_temp.check((select not public and file_size_limit = 26214400 from storage.buckets where id = 'planner-files'), 'private bucket, 25 MB a file');

-- U makes a plan with three cues, invites T (editor) and V (viewer).
select pg_temp.as_user('b');
set role authenticated;
insert into planner_plans (name, event_date, start_time, venue) values ('Fall gala', '2026-11-14', '19:30', 'Main hall');
select invite_to_planner((select id from planner_plans), 't@x.org', 'editor');
select invite_to_planner((select id from planner_plans), 'v@x.org', 'viewer');
insert into planner_cues (id, plan_id, position, section, title, duration_sec, script, color)
  select '10000000-0000-0000-0000-000000000001', id, 1024, 'Opening', 'Welcome', 300, 'Good evening, everyone.', 'blue' from planner_plans;
insert into planner_cues (id, plan_id, position, section, title, duration_sec)
  select '10000000-0000-0000-0000-000000000002', id, 2048, 'Awards', 'First award', 600 from planner_plans;
insert into planner_cues (id, plan_id, position, section, title, duration_sec, skip)
  select '10000000-0000-0000-0000-000000000003', id, 3072, 'Awards', 'Spare video', 120, true from planner_plans;
update planner_plans set time_zone = 'America/New_York', end_by = '21:00', columns = '[{"id":"cam","name":"Camera"}]';
select pg_temp.check((select time_zone from planner_plans) = 'America/New_York', 'owner sets the time zone, end by and columns');
select pg_temp.refused($$update planner_plans set share_token = gen_random_uuid()$$, 'nobody sets the public link directly');
select pg_temp.refused($$update planner_cues set color = 'pink'$$, 'cue colors are from the list');
-- U locks the Opening section (no editors named: only the owner).
insert into planner_sections (plan_id, section) select id, 'Opening' from planner_plans;
reset role;

-- T (editor): locked section is read-only for them; the rest is not.
select pg_temp.as_user('c');
set role authenticated;
update planner_cues set title = 'Hello' where section = 'Opening';
select pg_temp.check((select title from planner_cues where section = 'Opening') = 'Welcome', 'editor cannot change a locked section');
update planner_cues set title = 'Award one' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select title from planner_cues where id = '10000000-0000-0000-0000-000000000002') = 'Award one', 'editor changes other sections');
select pg_temp.refused($$update planner_cues set section = 'Opening' where id = '10000000-0000-0000-0000-000000000002'$$,
  'editor cannot move a cue into a locked section');
select pg_temp.refused($$insert into planner_sections (plan_id, section) select id, 'Awards' from planner_plans$$, 'only the owner locks sections');
reset role;
select pg_temp.as_user('b');
set role authenticated;
update planner_sections set editors = array['00000000-0000-0000-0000-00000000000c'::uuid];
reset role;
select pg_temp.as_user('c');
set role authenticated;
update planner_cues set title = 'Welcome!' where section = 'Opening';
select pg_temp.check((select title from planner_cues where section = 'Opening') = 'Welcome!', 'an editor named on the lock changes the section');
reset role;

-- Show day.
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.refused($$select planner_live_go((select id from planner_plans), 'start', '10000000-0000-0000-0000-000000000001')$$,
  'a viewer cannot call the show');
reset role;
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.check((planner_live_go((select id from planner_plans), 'start', '10000000-0000-0000-0000-000000000001') ->> 'state') = 'running',
  'editor starts the show');
select pg_temp.refused($$select planner_live_go((select id from planner_plans), 'go', gen_random_uuid())$$, 'only cues on the plan go live');
select planner_live_go((select id from planner_plans), 'pause');
select pg_temp.check((select state from planner_live) = 'paused', 'pause');
select planner_live_go((select id from planner_plans), 'resume');
select planner_live_go((select id from planner_plans), 'adjust', null, 60);
select pg_temp.check((select cue_started_at > now() from planner_live), 'adjust gives the cue more time');
select planner_live_go((select id from planner_plans), 'message', null, 0, '  Wrap up  ', true);
select pg_temp.check((select message = 'Wrap up' and message_on and message_flash from planner_live), 'message to the stage');
select planner_live_go((select id from planner_plans), 'go', '10000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from planner_live_log where ended_at is not null) = 1
  and (select count(*) from planner_live_log where ended_at is null) = 1, 'going to the next cue logs the one before');
select pg_temp.check((select updated_by_name from planner_live) = 'Tal', 'the show is stamped with who called it');
select planner_live_go((select id from planner_plans), 'end');
select pg_temp.check((select count(*) from planner_live_log where ended_at is null) = 0, 'ending the show closes the log');
select planner_live_go((select id from planner_plans), 'rehearse', '10000000-0000-0000-0000-000000000001');
select pg_temp.check((select mode from planner_live) = 'rehearsal' and (select count(distinct run_id) from planner_live_log) = 2, 'a rehearsal is a new run');
reset role;
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from planner_live) = 1 and (select count(*) from planner_live_log) = 3, 'viewer follows the show');
reset role;
select pg_temp.as_user('e');
set role authenticated;
select pg_temp.check((select count(*) from planner_live) = 0 and (select count(*) from planner_live_log) = 0, 'stranger sees no show');
reset role;

-- Lists.
select pg_temp.as_user('b');
set role authenticated;
insert into planner_items (plan_id, kind, title, role, phone, email, call_time) select id, 'crew', 'Dana', 'Camera 1', '555-0100', 'd@x.org', '15:00' from planner_plans;
insert into planner_items (plan_id, kind, title, amount) select id, 'budget', 'Lights rental', 1200 from planner_plans;
insert into planner_items (plan_id, kind, title, person_id, cue_id) select id, 'task', 'Test the mic', '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001' from planner_plans;
insert into planner_items (plan_id, kind, title, person_id) select id, 'task', 'Print scripts', '00000000-0000-0000-0000-00000000000c' from planner_plans;
select pg_temp.refused($$insert into planner_items (plan_id, kind, title, person_id) select id, 'task', 'No', '00000000-0000-0000-0000-00000000000e' from planner_plans$$,
  'tasks only go to people on the plan');
select pg_temp.refused($$insert into planner_items (plan_id, kind, title) select id, 'snacks', 'No' from planner_plans$$, 'only known lists');
reset role;
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from planner_items where kind = 'budget') = 0, 'viewer does not see the budget');
select pg_temp.check((select count(*) from planner_items where kind = 'crew') = 1, 'viewer sees the crew');
select pg_temp.refused($$insert into planner_items (plan_id, kind, title) select id, 'gear', 'Tripod' from planner_plans$$, 'viewer cannot add to lists');
select pg_temp.check((select count(*) from planner_notifications where kind = 'task' and body = 'Test the mic') = 1, 'the task''s person is told');
select planner_task_done((select id from planner_items where title = 'Test the mic'), true);
select pg_temp.check((select done from planner_items where title = 'Test the mic'), 'the task''s person ticks it off');
select pg_temp.refused($$select planner_task_done((select id from planner_items where title = 'Print scripts'), true)$$,
  'a viewer cannot tick off someone else''s task');
reset role;
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.check((select count(*) from planner_items where kind = 'budget') = 1, 'editor sees the budget');
update planner_items set actual = 1100 where kind = 'budget';
select pg_temp.check((select updated_by_name from planner_items where kind = 'budget') = 'Tal', 'items are stamped');
reset role;

-- Mentions.
select pg_temp.as_user('c');
set role authenticated;
insert into planner_comments (plan_id, cue_id, text, mentions)
  select id, '10000000-0000-0000-0000-000000000002', '@Vic check the lights', array['00000000-0000-0000-0000-00000000000d'::uuid, '00000000-0000-0000-0000-00000000000e'::uuid]
  from planner_plans;
insert into planner_messages (plan_id, body, mentions) select id, '@Uri doors at 6', array['00000000-0000-0000-0000-00000000000b'::uuid] from planner_plans;
reset role;
select pg_temp.check((select count(*) from planner_notifications where kind = 'mention' and user_id = '00000000-0000-0000-0000-00000000000e') = 0,
  'people not on the plan are not told');
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from planner_notifications) = 2, 'viewer sees their own notifications (a task and a mention)');
update planner_notifications set read_at = now();
select pg_temp.check((select count(*) from planner_notifications where read_at is null) = 0, 'marks them read');
select pg_temp.refused($$update planner_notifications set body = 'x'$$, 'cannot rewrite a notification');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((select count(*) from planner_notifications) = 1 and (select from_name from planner_notifications) = 'Tal', 'owner told of the chat mention');
reset role;

-- Files.
select pg_temp.as_user('c');
set role authenticated;
insert into planner_files (id, plan_id, name, size, path)
  select '20000000-0000-0000-0000-000000000001', id, 'stage plot.pdf', 1000, id || '/20000000-0000-0000-0000-000000000001/stage plot.pdf' from planner_plans;
select pg_temp.check((select uploaded_by_name from planner_files) = 'Tal', 'editor adds a file');
select pg_temp.refused($$insert into planner_files (id, plan_id, name, size, path) select gen_random_uuid(), id, 'a', 10, 'elsewhere/a' from planner_plans$$,
  'files are stored under their plan');
select pg_temp.refused($$insert into planner_files (id, plan_id, name, size, path) select '20000000-0000-0000-0000-000000000009', id, 'big', 26214401, id || '/20000000-0000-0000-0000-000000000009/big' from planner_plans$$, 'at most 25 MB a file');
insert into storage.objects (bucket_id, name) select 'planner-files', path from planner_files;
select pg_temp.refused($$insert into storage.objects (bucket_id, name) select 'planner-files', id || '/' || gen_random_uuid() || '/sneaky.bin' from planner_plans$$,
  'nothing is stored without its file row');
reset role;
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.check((select count(*) from storage.objects) = 1, 'viewer reads the plan''s files');
select pg_temp.refused($$insert into planner_files (id, plan_id, name, size, path) select '20000000-0000-0000-0000-000000000002', id, 'b', 1, id || '/20000000-0000-0000-0000-000000000002/b' from planner_plans$$,
  'viewer cannot add files');
reset role;
select pg_temp.as_user('e');
set role authenticated;
select pg_temp.check((select count(*) from storage.objects) = 0 and (select count(*) from planner_files) = 0, 'stranger sees no files');
reset role;

-- Versions.
select pg_temp.as_user('d');
set role authenticated;
select pg_temp.refused($$select planner_save_version((select id from planner_plans), 'Mine')$$, 'viewer cannot save versions');
reset role;
select pg_temp.as_user('c');
set role authenticated;
select planner_save_version((select id from planner_plans), 'Before the run-through');
update planner_cues set title = 'Changed award' where id = '10000000-0000-0000-0000-000000000002';
delete from planner_cues where id = '10000000-0000-0000-0000-000000000003';
insert into planner_cues (plan_id, position, title) select id, 9000, 'Added later' from planner_plans;
reset role;
select pg_temp.as_user('c');
set role authenticated;
-- With a locked section, only the owner restores.
select pg_temp.refused($$select planner_restore_version((select id from planner_versions where name = 'Before the run-through'))$$,
  'with locked sections only the owner restores');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select planner_restore_version((select id from planner_versions where name = 'Before the run-through'));
select pg_temp.check((select title from planner_cues where id = '10000000-0000-0000-0000-000000000002') = 'Award one', 'restore brings back the words');
select pg_temp.check((select count(*) from planner_cues) = 3 and not exists (select 1 from planner_cues where title = 'Added later'), 'restore brings back the cues');
select pg_temp.check((select count(*) from planner_comments) = 1, 'comments on cues still there stay');
select pg_temp.check(exists (select 1 from planner_versions where name like 'Before restoring%'), 'a restore can be undone');
reset role;
-- After a quiet half hour, the next change keeps the plan as it was first.
update planner_versions set created_at = now() - interval '1 hour';
update planner_cues set updated_at = now() - interval '1 hour';
alter table planner_cues disable trigger planner_cue_stamp;
update planner_cues set updated_at = now() - interval '1 hour';
alter table planner_cues enable trigger planner_cue_stamp;
select pg_temp.as_user('c');
set role authenticated;
update planner_cues set title = 'Award 1' where id = '10000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.check((select snapshot -> 'cues' -> 1 ->> 'title' from planner_versions where name = 'Before changes' order by created_at desc limit 1) = 'Award one',
  'an automatic version is kept from before a round of edits');

-- Copies and templates.
select pg_temp.as_user('b');
set role authenticated;
select planner_copy_plan((select id from planner_plans where name = 'Fall gala'), 'Spring gala', false, '2027-04-10');
select pg_temp.check((select count(*) from planner_cues c join planner_plans p on p.id = c.plan_id where p.name = 'Spring gala') = 3, 'copy has the cues');
select pg_temp.check((select count(*) from planner_cues where id = '10000000-0000-0000-0000-000000000001') = 1, 'the original keeps its cues');
select pg_temp.check((select count(*) from planner_items i join planner_plans p on p.id = i.plan_id where p.name = 'Spring gala' and i.kind = 'task' and not i.done) = 2,
  'copy has the tasks, not done');
select pg_temp.check((select bool_and(i.cue_id is null or exists (select 1 from planner_cues c where c.id = i.cue_id and c.plan_id = i.plan_id))
  from planner_items i join planner_plans p on p.id = i.plan_id where p.name = 'Spring gala'), 'tasks follow their cue into the copy');
select planner_copy_plan((select id from planner_plans where name = 'Fall gala'), 'Gala template', true);
select pg_temp.check((select is_template and event_date is null from planner_plans where name = 'Gala template'), 'saved as a template');
reset role;
select pg_temp.as_user('e');
set role authenticated;
select pg_temp.refused($$select planner_copy_plan((select plan_id from public.planner_cues limit 1), 'Mine')$$, 'stranger cannot copy');
select pg_temp.refused($$select planner_copy_plan('10000000-0000-0000-0000-000000000001', 'Mine')$$, 'stranger cannot copy a plan by id');
reset role;

-- Public link.
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.refused($$select planner_share((select id from planner_plans where name = 'Fall gala'), true)$$, 'only the owner makes a public link');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select planner_share((select id from planner_plans where name = 'Fall gala'), true, 'agenda');
create temporary table tok as select share_token t from planner_plans where name = 'Fall gala';
grant select on tok to anon;
reset role;
set role anon;
select pg_temp.check((select planner_public((select t from tok)) -> 'plan' ->> 'name') = 'Fall gala', 'anyone with the link reads the plan');
select pg_temp.check((select planner_public((select t from tok)) -> 'cues' -> 0 ->> 'script') is null, 'the agenda has no scripts');
select pg_temp.check((select jsonb_array_length(planner_public((select t from tok)) -> 'crew')) = 0, 'the agenda has no crew');
select pg_temp.check((select planner_public(gen_random_uuid())) is null, 'a wrong link shows nothing');
select pg_temp.check((select planner_public((select t from tok)) -> 'live' ->> 'mode') = 'rehearsal', 'the link follows the show');
select pg_temp.check(planner_ical((select t from tok))::text like '%SUMMARY:Fall gala%' and planner_ical((select t from tok))::text like '%TZID=America/New_York:20261114T193000%',
  'the plan''s calendar feed');
select pg_temp.refused($$select count(*) from planner_plans$$, 'signed out: no tables');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select planner_share((select id from planner_plans where name = 'Fall gala'), true, 'crew');
reset role;
set role anon;
select pg_temp.check((select planner_public((select t from tok)) -> 'cues' -> 0 ->> 'script') = 'Good evening, everyone.', 'the crew view has scripts');
select pg_temp.check((select planner_public((select t from tok)) -> 'crew' -> 0 ->> 'role') = 'Camera 1', 'the crew view has the crew');
select pg_temp.check((select planner_public((select t from tok))::text) not like '%555-0100%' and (select planner_public((select t from tok))::text) not like '%Lights rental%',
  'never phone numbers or the budget');
reset role;
select pg_temp.as_user('b');
set role authenticated;
select planner_share((select id from planner_plans where name = 'Fall gala'), false);
reset role;
set role anon;
select pg_temp.check((select planner_public((select t from tok))) is null, 'turned off, the link shows nothing');
reset role;

-- Personal calendar feed.
select pg_temp.as_user('c');
set role authenticated;
create temporary table feed as select planner_my_feed() t;
grant select on feed to anon;
select pg_temp.check((select planner_my_feed()) = (select t from feed), 'the same feed link each time');
reset role;
set role anon;
select pg_temp.check(planner_ical_me((select t from feed))::text like '%SUMMARY:Fall gala%', 'your feed has the plans you are on');
select pg_temp.check(planner_ical_me((select t from feed))::text not like '%Gala template%', 'not templates');
select pg_temp.check(planner_ical_me(gen_random_uuid())::text not like '%VEVENT%', 'a wrong feed link shows nothing');
reset role;

-- Deleting a plan deletes everything with it.
select pg_temp.as_user('b');
set role authenticated;
delete from planner_plans;
reset role;
select pg_temp.check((select count(*) from planner_items) + (select count(*) from planner_live) + (select count(*) from planner_versions)
  + (select count(*) from planner_files) + (select count(*) from planner_notifications) = 0, 'everything goes with the plan');
