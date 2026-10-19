\set ON_ERROR_STOP 1
-- people: admin (first, approved), dana approved, sam approved, pat pending
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'admin@x.org', '{"name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000d', 'dana@x.org', '{"name":"Dana"}'),
 ('00000000-0000-0000-0000-00000000000e', 'sam@x.org', '{"name":"Sam"}'),
 ('00000000-0000-0000-0000-00000000000f', 'pat@x.org', '{"name":"Pat"}');
update public.profiles set approved = true where email in ('dana@x.org', 'sam@x.org');

set role authenticated;
-- Dana shares a project.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select public.share_editor_project('Film', '{"kind":"lumora-edit","version":2,"sequences":[{"id":"s1"}]}') as pid \gset
select :'pid' is not null as shared;
select public.invite_to_editor_project(:'pid', 'SAM@x.org', 'editor');
\set ON_ERROR_STOP 0
select public.invite_to_editor_project(:'pid', 'pat@x.org', 'viewer'); -- pending: refused
\set ON_ERROR_STOP 1
select public.invite_to_editor_project(:'pid', 'admin@x.org', 'viewer');
select name, role from public.editor_project_people(:'pid') order by name;
-- Dana saves v1 -> v2; again soon: history is one row
select public.save_editor_project(:'pid', 1, '{"a":1}', 'Film') as v2;
select public.save_editor_project(:'pid', 2, '{"a":2}', 'Film') as v3;
select public.save_editor_project(:'pid', 2, '{"a":9}', 'Film') is null as stale_base_refused;
select version, note from public.editor_versions where project_id = :'pid' order by version;
-- Dana takes the lock on s1
select public.take_editor_lock(:'pid', 's1') ->> 'holder_name' as holder;

-- Sam (editor): sees the project, cannot take s1, asks for it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select name, role, version from public.my_editor_projects();
select public.take_editor_lock(:'pid', 's1') ->> 'holder_name' as still_dana;
select public.request_editor_lock(:'pid', 's1');
select count(*) as sam_sees_projects from public.editor_projects;
-- Sam saves with the right base
select public.save_editor_project(:'pid', 3, '{"a":3}', 'Film') as v4;
\set ON_ERROR_STOP 0
update public.editor_projects set name = 'hack' where id = :'pid'; -- no direct writes
select public.invite_to_editor_project(:'pid', 'pat@x.org', 'editor'); -- only owner
\set ON_ERROR_STOP 1
select name from public.editor_projects where id = :'pid';
-- Sam comments; author name is filled in by the server
insert into public.editor_comments (project_id, seq_id, frame, text, author_name) values (:'pid', 's1', 30, 'Too dark', 'Spoofed') returning author_name;

-- Dana hands s1 over to Sam
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select requested_name from public.editor_locks;
select public.hand_over_editor_lock(:'pid', 's1');
select holder_name from public.editor_locks;
-- Dana resolves Sam's comment but cannot change its words
update public.editor_comments set resolved = true where project_id = :'pid';
\set ON_ERROR_STOP 0
update public.editor_comments set text = 'changed' where project_id = :'pid';
\set ON_ERROR_STOP 1
select text, resolved from public.editor_comments;

-- Admin (viewer): reads, may not save or lock
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select count(*) as viewer_sees from public.editor_projects;
\set ON_ERROR_STOP 0
select public.save_editor_project(:'pid', 4, '{}', 'x');
select public.take_editor_lock(:'pid', 's1');
\set ON_ERROR_STOP 1
insert into public.editor_comments (project_id, seq_id, frame, text) values (:'pid', 's1', 60, 'Viewer note') returning author_name;

-- Pat (pending, not a member) sees nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
select count(*) as pat_projects from public.editor_projects;
select count(*) as pat_comments from public.editor_comments;
select count(*) as pat_list from public.my_editor_projects();
\set ON_ERROR_STOP 0
select public.open_editor_project(:'pid');
\set ON_ERROR_STOP 1

-- Lock expiry: an ended lock can be taken by someone else
reset role;
update public.editor_locks set expires_at = now() - interval '1 second';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select public.take_editor_lock(:'pid', 's1') ->> 'holder_name' as dana_again;

-- Sam leaves; Dana deletes the project
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
delete from public.editor_project_members where user_id = auth.uid();
select count(*) as sam_after_leaving from public.editor_projects;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
delete from public.editor_projects where id = :'pid';
reset role;
select count(*) as left_projects, (select count(*) from public.editor_versions) as left_versions from public.editor_projects;
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
