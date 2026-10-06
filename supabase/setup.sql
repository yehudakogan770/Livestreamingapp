-- Lumora sign-in: run this once in your Supabase project
-- (Supabase → SQL Editor → New query → paste all of this → Run).
--
-- It also sets up Lumora Studio's team projects (the same as
-- update-2-editor-collab.sql), which apps each account may use (the same as
-- update-4-app-access.sql) and Lumora Planner (at the end; the same as
-- update-5-planner.sql) and the security update (two-step sign-in, limits
-- and Planner teammates; at the end, the same as update-6-security.sql).
-- Afterwards, run update-3-reports.sql too (error reports and "Report a
-- problem").
--
-- Every account gets a profile. New accounts wait for approval. The very first
-- account made is the Lumora team's: approved, and able to approve others.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text not null default '',
  approved boolean not null default false,
  blocked boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Is the person asking on the Lumora team?
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select is_admin and not blocked from public.profiles where id = auth.uid()), false)
$$;

-- People see their own profile; the Lumora team sees everyone.
drop policy if exists "see own or team sees all" on public.profiles;
create policy "see own or team sees all" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Only the Lumora team can approve or block (nobody can approve themselves).
drop policy if exists "team approves" on public.profiles;
create policy "team approves" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- A new account gets its profile (the first one ever: the Lumora team).
create or replace function public.new_profile() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, name, approved, is_admin)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''), first, first);
  return new;
end
$$;

drop trigger if exists on_new_account on auth.users;
create trigger on_new_account after insert on auth.users
  for each row execute function public.new_profile();

-- Only the columns the team may change.
revoke update on public.profiles from authenticated, anon;
grant update (approved, blocked) on public.profiles to authenticated;
grant select on public.profiles to authenticated;

-- People can change their own name (and nothing else about their account).
create or replace function public.set_my_name(new_name text) returns void
  language sql security definer set search_path = public
as $$
  update public.profiles set name = left(trim(new_name), 80) where id = auth.uid()
$$;
revoke execute on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;

-- ---- Lumora Studio team projects (the same as update-2-editor-collab.sql) ----

-- Is the person asking approved (and not blocked)?
create or replace function public.is_approved() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select approved and not blocked from public.profiles where id = auth.uid()), false)
$$;

-- The shared projects: the whole edit as JSON (media files stay on each computer).
create table if not exists public.editor_projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default '',
  version integer not null default 1,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  updated_by_name text not null default ''
);

-- Who else is on each project, and whether they may change it.
create table if not exists public.editor_project_members (
  project_id uuid not null references public.editor_projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Earlier saves (saves close together by one person are kept as one).
create table if not exists public.editor_versions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.editor_projects on delete cascade,
  version integer not null,
  name text not null default '',
  doc jsonb not null,
  saved_by uuid references auth.users on delete set null,
  saved_by_name text not null default '',
  saved_at timestamptz not null default now(),
  note text not null default ''
);
create index if not exists editor_versions_project on public.editor_versions (project_id, version desc);

-- Who is editing each sequence (until expires_at, renewed every 20 seconds).
create table if not exists public.editor_locks (
  project_id uuid not null references public.editor_projects on delete cascade,
  seq_id text not null,
  holder uuid not null references auth.users on delete cascade,
  holder_name text not null default '',
  expires_at timestamptz not null,
  requested_by uuid references auth.users on delete set null,
  requested_name text not null default '',
  primary key (project_id, seq_id)
);

-- Review comments on a frame of a sequence.
create table if not exists public.editor_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.editor_projects on delete cascade,
  seq_id text not null,
  frame integer not null check (frame >= 0),
  author uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null default '',
  text text not null check (char_length(text) between 1 and 2000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists editor_comments_project on public.editor_comments (project_id);

-- The asker's role on a project: 'owner', 'editor', 'viewer', or null.
create or replace function public.editor_role(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  select case
    when not public.is_approved() then null
    when exists (select 1 from public.editor_projects where id = p and owner = auth.uid()) then 'owner'
    else (select role from public.editor_project_members where project_id = p and user_id = auth.uid())
  end
$$;

-- A name to show for the asker.
create or replace function public.my_display_name() returns text
  language sql security definer stable set search_path = public
as $$
  select coalesce(nullif(name, ''), email, '') from public.profiles where id = auth.uid()
$$;

alter table public.editor_projects enable row level security;
alter table public.editor_project_members enable row level security;
alter table public.editor_versions enable row level security;
alter table public.editor_locks enable row level security;
alter table public.editor_comments enable row level security;

-- Projects: owner and members see them; saving goes through save_editor_project.
drop policy if exists "members see projects" on public.editor_projects;
create policy "members see projects" on public.editor_projects
  for select using (public.editor_role(id) is not null);
drop policy if exists "owner deletes project" on public.editor_projects;
create policy "owner deletes project" on public.editor_projects
  for delete using (owner = auth.uid());

-- Members: everyone on the project sees the list; the owner changes roles and
-- removes people; anyone can leave. (Inviting goes through invite_to_editor_project.)
drop policy if exists "members see members" on public.editor_project_members;
create policy "members see members" on public.editor_project_members
  for select using (public.editor_role(project_id) is not null);
drop policy if exists "owner changes roles" on public.editor_project_members;
create policy "owner changes roles" on public.editor_project_members
  for update using (public.editor_role(project_id) = 'owner') with check (public.editor_role(project_id) = 'owner');
drop policy if exists "owner removes or member leaves" on public.editor_project_members;
create policy "owner removes or member leaves" on public.editor_project_members
  for delete using (public.editor_role(project_id) = 'owner' or user_id = auth.uid());

-- Versions and locks: members read; changes go through the functions below.
drop policy if exists "members see versions" on public.editor_versions;
create policy "members see versions" on public.editor_versions
  for select using (public.editor_role(project_id) is not null);
drop policy if exists "members see locks" on public.editor_locks;
create policy "members see locks" on public.editor_locks
  for select using (public.editor_role(project_id) is not null);

-- Comments: every member (viewers too) reads, writes and resolves; only the
-- author changes the words; the author or the owner deletes.
drop policy if exists "members see comments" on public.editor_comments;
create policy "members see comments" on public.editor_comments
  for select using (public.editor_role(project_id) is not null);
drop policy if exists "members comment" on public.editor_comments;
create policy "members comment" on public.editor_comments
  for insert with check (public.editor_role(project_id) is not null and author = auth.uid());
drop policy if exists "members resolve" on public.editor_comments;
create policy "members resolve" on public.editor_comments
  for update using (public.editor_role(project_id) is not null) with check (public.editor_role(project_id) is not null);
drop policy if exists "author or owner deletes comment" on public.editor_comments;
create policy "author or owner deletes comment" on public.editor_comments
  for delete using (author = auth.uid() or public.editor_role(project_id) = 'owner');

-- A comment carries its writer's real name; only the author may change its
-- words (others may only resolve it).
create or replace function public.editor_comment_guard() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author := auth.uid();
    new.author_name := coalesce(public.my_display_name(), '');
    return new;
  end if;
  if new.author <> old.author or new.project_id <> old.project_id or new.seq_id <> old.seq_id then
    raise exception 'This comment cannot be moved.';
  end if;
  if (new.text <> old.text or new.frame <> old.frame) and old.author <> auth.uid() then
    raise exception 'Only the person who wrote a comment can change it.';
  end if;
  return new;
end
$$;
drop trigger if exists editor_comment_guard on public.editor_comments;
create trigger editor_comment_guard before insert or update on public.editor_comments
  for each row execute function public.editor_comment_guard();

-- What people may do straight on the tables (the rest goes through functions).
revoke all on public.editor_projects, public.editor_project_members, public.editor_versions, public.editor_locks, public.editor_comments from anon, authenticated;
grant select, delete on public.editor_projects to authenticated;
grant select, delete on public.editor_project_members to authenticated;
grant update (role) on public.editor_project_members to authenticated;
grant select on public.editor_versions to authenticated;
grant select on public.editor_locks to authenticated;
grant select, insert, delete on public.editor_comments to authenticated;
grant update (text, frame, resolved) on public.editor_comments to authenticated;

-- Share a project: it is put online with you as the owner (version 1).
create or replace function public.share_editor_project(p_name text, p_doc jsonb) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
  who text := public.my_display_name();
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'Only approved Lumora accounts can share projects.';
  end if;
  insert into public.editor_projects (owner, name, doc, updated_by, updated_by_name)
  values (auth.uid(), left(trim(p_name), 120), p_doc, auth.uid(), who)
  returning id into new_id;
  insert into public.editor_versions (project_id, version, name, doc, saved_by, saved_by_name, note)
  values (new_id, 1, left(trim(p_name), 120), p_doc, auth.uid(), who, 'Shared');
  return new_id;
end
$$;

-- Open a project: the latest version and your role in it.
create or replace function public.open_editor_project(p_id uuid) returns jsonb
  language plpgsql security definer stable set search_path = public
as $$
declare
  r text := public.editor_role(p_id);
  result jsonb;
begin
  if r is null then
    raise exception 'This project is not shared with you.';
  end if;
  select jsonb_build_object('id', id, 'name', name, 'version', version, 'doc', doc, 'role', r, 'owner', owner,
    'updated_at', updated_at, 'updated_by_name', updated_by_name)
  into result from public.editor_projects where id = p_id;
  return result;
end
$$;

-- Save: only if nobody else saved since p_base (returns the new version
-- number, or null when someone else saved first). Saves by the same person
-- within 10 minutes share one place in the history unless p_keep is true.
create or replace function public.save_editor_project(p_id uuid, p_base integer, p_doc jsonb, p_name text, p_note text default '', p_keep boolean default false)
  returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  r text := public.editor_role(p_id);
  who text := public.my_display_name();
  v integer;
  last_id bigint;
  last_by uuid;
  last_at timestamptz;
  last_note text;
begin
  if r is null or r = 'viewer' then
    raise exception 'You can view this project but not change it.';
  end if;
  update public.editor_projects
    set doc = p_doc, name = left(trim(p_name), 120), version = version + 1, updated_at = now(), updated_by = auth.uid(), updated_by_name = who
    where id = p_id and version = p_base
    returning version into v;
  if v is null then
    return null;
  end if;
  select id, saved_by, saved_at, note into last_id, last_by, last_at, last_note
    from public.editor_versions where project_id = p_id order by version desc limit 1;
  if not p_keep and coalesce(p_note, '') = '' and last_id is not null and last_by = auth.uid()
     and last_note = '' and last_at > now() - interval '10 minutes' then
    update public.editor_versions set version = v, name = left(trim(p_name), 120), doc = p_doc, saved_at = now() where id = last_id;
  else
    insert into public.editor_versions (project_id, version, name, doc, saved_by, saved_by_name, note)
    values (p_id, v, left(trim(p_name), 120), p_doc, auth.uid(), who, left(coalesce(p_note, ''), 200));
  end if;
  -- Keep the newest 100 versions.
  delete from public.editor_versions where project_id = p_id and id not in
    (select id from public.editor_versions where project_id = p_id order by version desc limit 100);
  return v;
end
$$;

-- The projects you own or are on (without the edit itself, so it is quick).
create or replace function public.my_editor_projects()
  returns table (id uuid, name text, role text, owner_name text, version integer, updated_at timestamptz, updated_by_name text)
  language sql security definer stable set search_path = public
as $$
  select p.id, p.name, public.editor_role(p.id), coalesce(nullif(o.name, ''), o.email, ''), p.version, p.updated_at, p.updated_by_name
  from public.editor_projects p
  left join public.profiles o on o.id = p.owner
  where public.is_approved() and (p.owner = auth.uid() or exists
    (select 1 from public.editor_project_members m where m.project_id = p.id and m.user_id = auth.uid()))
  order by p.updated_at desc
$$;

-- Everyone on a project, with names (for members of that project).
create or replace function public.editor_project_people(p_id uuid)
  returns table (user_id uuid, email text, name text, role text)
  language sql security definer stable set search_path = public
as $$
  select o.id, o.email, o.name, 'owner'
  from public.editor_projects p join public.profiles o on o.id = p.owner
  where p.id = p_id and public.editor_role(p_id) is not null
  union all
  select pr.id, pr.email, pr.name, m.role
  from public.editor_project_members m join public.profiles pr on pr.id = m.user_id
  where m.project_id = p_id and public.editor_role(p_id) is not null
$$;

-- The owner invites someone by email (an approved Lumora account), or changes their role.
create or replace function public.invite_to_editor_project(p_id uuid, p_email text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  person public.profiles;
begin
  if public.editor_role(p_id) is distinct from 'owner' then
    raise exception 'Only the owner of the project can invite people.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'The role must be editor or viewer.';
  end if;
  select * into person from public.profiles where lower(email) = lower(trim(p_email));
  if person.id is null or not person.approved or person.blocked then
    raise exception 'There is no approved Lumora account with that email.';
  end if;
  if person.id = auth.uid() then
    raise exception 'You already own this project.';
  end if;
  insert into public.editor_project_members (project_id, user_id, role) values (p_id, person.id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('user_id', person.id, 'email', person.email, 'name', person.name, 'role', p_role);
end
$$;

-- Edit a sequence: take its lock if it is free, run out, or already yours
-- (this is also the heartbeat). Returns the lock as it now stands.
create or replace function public.take_editor_lock(p_id uuid, p_seq text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  r text := public.editor_role(p_id);
  result jsonb;
begin
  if r is null or r = 'viewer' then
    raise exception 'You can view this project but not change it.';
  end if;
  insert into public.editor_locks as l (project_id, seq_id, holder, holder_name, expires_at)
  values (p_id, p_seq, auth.uid(), public.my_display_name(), now() + interval '60 seconds')
  on conflict (project_id, seq_id) do update
    set holder = excluded.holder, holder_name = excluded.holder_name, expires_at = excluded.expires_at,
        requested_by = case when l.holder = excluded.holder and l.expires_at >= now() then l.requested_by else null end,
        requested_name = case when l.holder = excluded.holder and l.expires_at >= now() then l.requested_name else '' end
    where l.holder = auth.uid() or l.expires_at < now();
  select jsonb_build_object('seq_id', seq_id, 'holder', holder, 'holder_name', holder_name, 'expires_at', expires_at,
    'requested_by', requested_by, 'requested_name', requested_name, 'server_now', now())
  into result from public.editor_locks where project_id = p_id and seq_id = p_seq;
  return result;
end
$$;

-- Stop editing a sequence.
create or replace function public.release_editor_lock(p_id uuid, p_seq text) returns void
  language sql security definer set search_path = public
as $$
  delete from public.editor_locks where project_id = p_id and seq_id = p_seq and holder = auth.uid()
$$;

-- Ask the person editing a sequence to let you edit it.
create or replace function public.request_editor_lock(p_id uuid, p_seq text) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  r text := public.editor_role(p_id);
begin
  if r is null or r = 'viewer' then
    raise exception 'You can view this project but not change it.';
  end if;
  update public.editor_locks set requested_by = auth.uid(), requested_name = public.my_display_name()
  where project_id = p_id and seq_id = p_seq and holder <> auth.uid() and expires_at >= now();
end
$$;

-- Give a sequence to the person who asked for it.
create or replace function public.hand_over_editor_lock(p_id uuid, p_seq text) returns void
  language sql security definer set search_path = public
as $$
  update public.editor_locks
  set holder = requested_by, holder_name = requested_name, expires_at = now() + interval '60 seconds', requested_by = null, requested_name = ''
  where project_id = p_id and seq_id = p_seq and holder = auth.uid() and requested_by is not null
$$;

-- Only signed-in people may call these.
revoke execute on function public.is_approved() from public, anon;
revoke execute on function public.editor_role(uuid) from public, anon;
revoke execute on function public.my_display_name() from public, anon;
revoke execute on function public.share_editor_project(text, jsonb) from public, anon;
revoke execute on function public.open_editor_project(uuid) from public, anon;
revoke execute on function public.save_editor_project(uuid, integer, jsonb, text, text, boolean) from public, anon;
revoke execute on function public.my_editor_projects() from public, anon;
revoke execute on function public.editor_project_people(uuid) from public, anon;
revoke execute on function public.invite_to_editor_project(uuid, text, text) from public, anon;
revoke execute on function public.take_editor_lock(uuid, text) from public, anon;
revoke execute on function public.release_editor_lock(uuid, text) from public, anon;
revoke execute on function public.request_editor_lock(uuid, text) from public, anon;
revoke execute on function public.hand_over_editor_lock(uuid, text) from public, anon;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.editor_role(uuid) to authenticated;
grant execute on function public.my_display_name() to authenticated;
grant execute on function public.share_editor_project(text, jsonb) to authenticated;
grant execute on function public.open_editor_project(uuid) to authenticated;
grant execute on function public.save_editor_project(uuid, integer, jsonb, text, text, boolean) to authenticated;
grant execute on function public.my_editor_projects() to authenticated;
grant execute on function public.editor_project_people(uuid) to authenticated;
grant execute on function public.invite_to_editor_project(uuid, text, text) to authenticated;
grant execute on function public.take_editor_lock(uuid, text) to authenticated;
grant execute on function public.release_editor_lock(uuid, text) to authenticated;
grant execute on function public.request_editor_lock(uuid, text) to authenticated;
grant execute on function public.hand_over_editor_lock(uuid, text) to authenticated;

-- Live updates: locks and comments show up for everyone at once.
-- (Saves are announced on the project's Realtime channel, so the large
-- project rows themselves are not sent through Realtime.)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'editor_locks') then
      alter publication supabase_realtime add table public.editor_locks;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'editor_comments') then
      alter publication supabase_realtime add table public.editor_comments;
    end if;
  end if;
end
$$;

-- ---- Which apps each account may use (the same as update-4-app-access.sql) ----
-- New accounts start with neither app; the Lumora team ticks Lumora and/or
-- Studio in People and approvals. The first account (the team's) gets both.

-- The two switches. Added as "on" so existing accounts keep both apps; new
-- accounts after this start with both off (the team turns them on).
alter table public.profiles add column if not exists lumora boolean not null default true;
alter table public.profiles add column if not exists studio boolean not null default true;
alter table public.profiles alter column lumora set default false;
alter table public.profiles alter column studio set default false;

-- Only the Lumora team may change them (the same policy "team approves" as
-- approved/blocked: updates need is_admin()).
grant update (approved, blocked, lumora, studio) on public.profiles to authenticated;

-- A new account gets its profile: no apps until the team approves it (the
-- first one ever: the Lumora team, with both apps).
create or replace function public.new_profile() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, name, approved, is_admin, lumora, studio)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''), first, first, first, first);
  return new;
end
$$;

-- May the person asking use Lumora Studio? (Approved, not blocked, and Studio
-- turned on; the Lumora team always may.)
create or replace function public.can_use_studio() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select approved and not blocked and (studio or is_admin) from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.can_use_studio() from public, anon;
grant execute on function public.can_use_studio() to authenticated;

-- The asker's role on a project: 'owner', 'editor', 'viewer', or null (also
-- null without Studio access, so every project policy and function needs it).
create or replace function public.editor_role(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  select case
    when not public.can_use_studio() then null
    when exists (select 1 from public.editor_projects where id = p and owner = auth.uid()) then 'owner'
    else (select role from public.editor_project_members where project_id = p and user_id = auth.uid())
  end
$$;

-- Share a project: it is put online with you as the owner (version 1).
create or replace function public.share_editor_project(p_name text, p_doc jsonb) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
  who text := public.my_display_name();
begin
  if auth.uid() is null or not public.can_use_studio() then
    raise exception 'Only approved Lumora Studio accounts can share projects.';
  end if;
  insert into public.editor_projects (owner, name, doc, updated_by, updated_by_name)
  values (auth.uid(), left(trim(p_name), 120), p_doc, auth.uid(), who)
  returning id into new_id;
  insert into public.editor_versions (project_id, version, name, doc, saved_by, saved_by_name, note)
  values (new_id, 1, left(trim(p_name), 120), p_doc, auth.uid(), who, 'Shared');
  return new_id;
end
$$;

-- The projects you own or are on (without the edit itself, so it is quick).
create or replace function public.my_editor_projects()
  returns table (id uuid, name text, role text, owner_name text, version integer, updated_at timestamptz, updated_by_name text)
  language sql security definer stable set search_path = public
as $$
  select p.id, p.name, public.editor_role(p.id), coalesce(nullif(o.name, ''), o.email, ''), p.version, p.updated_at, p.updated_by_name
  from public.editor_projects p
  left join public.profiles o on o.id = p.owner
  where public.can_use_studio() and (p.owner = auth.uid() or exists
    (select 1 from public.editor_project_members m where m.project_id = p.id and m.user_id = auth.uid()))
  order by p.updated_at desc
$$;

-- The owner invites someone by email (an approved account with Lumora Studio
-- turned on), or changes their role.
create or replace function public.invite_to_editor_project(p_id uuid, p_email text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  person public.profiles;
begin
  if public.editor_role(p_id) is distinct from 'owner' then
    raise exception 'Only the owner of the project can invite people.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'The role must be editor or viewer.';
  end if;
  select * into person from public.profiles where lower(email) = lower(trim(p_email));
  if person.id is null or not person.approved or person.blocked then
    raise exception 'There is no approved Lumora account with that email.';
  end if;
  if not (person.studio or person.is_admin) then
    raise exception 'That account isn''t set up for Lumora Studio.';
  end if;
  if person.id = auth.uid() then
    raise exception 'You already own this project.';
  end if;
  insert into public.editor_project_members (project_id, user_id, role) values (p_id, person.id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('user_id', person.id, 'email', person.email, 'name', person.name, 'role', p_role);
end
$$;

-- ---- Lumora Planner (the same as update-5-planner.sql) ----
-- The team's shared run of show: plans, members, cues and comments; see
-- update-5-planner.sql for who may do what.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'lumora') then
    raise exception 'Run update-4-app-access.sql first (it adds profiles.lumora), then run this again.';
  end if;
end
$$;

-- May the person asking use Lumora (and so the Planner)? Approved, not
-- blocked, and Lumora turned on; the Lumora team always may.
create or replace function public.can_use_lumora() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select approved and not blocked and (lumora or is_admin) from public.profiles where id = auth.uid()), false)
$$;

-- A name to show for the asker (also made by update 2).
create or replace function public.my_display_name() returns text
  language sql security definer stable set search_path = public
as $$
  select coalesce(nullif(name, ''), email, '') from public.profiles where id = auth.uid()
$$;

-- One plan: an event.
create table if not exists public.planner_plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  event_date date,
  venue text not null default '' check (char_length(venue) <= 120),
  start_time text not null default '' check (char_length(start_time) <= 8),
  notes text not null default '' check (char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text not null default ''
);

-- Who else is on each plan, and whether they may change it.
create table if not exists public.planner_members (
  plan_id uuid not null references public.planner_plans on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index if not exists planner_members_user on public.planner_members (user_id);

-- The cues of a plan, in order of position. Each row is changed on its own
-- (last write wins, by updated_at), so two people can edit different cues at once.
create table if not exists public.planner_cues (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  position double precision not null default 0,
  section text not null default '' check (char_length(section) <= 60),
  title text not null default '' check (char_length(title) <= 120),
  segment text not null default 'custom'
    check (segment in ('camera', 'video', 'slide', 'title', 'lyrics', 'countdown', 'speaker', 'break', 'custom')),
  who text not null default '' check (char_length(who) <= 80),
  notes text not null default '' check (char_length(notes) <= 4000),
  start_time text not null default '' check (char_length(start_time) <= 8),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 86400),
  input_hint text not null default '' check (char_length(input_hint) <= 80),
  overlay_hint text not null default '' check (char_length(overlay_hint) <= 80),
  transition_hint text not null default '' check (char_length(transition_hint) <= 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  updated_by_name text not null default ''
);
create index if not exists planner_cues_plan on public.planner_cues (plan_id, position);

-- Comments on a cue.
create table if not exists public.planner_comments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  cue_id uuid not null references public.planner_cues on delete cascade,
  author uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null default '',
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists planner_comments_plan on public.planner_comments (plan_id);

-- The asker's role on a plan: 'owner', 'editor', 'viewer', or null (also null
-- without Lumora access, so every policy below needs it).
create or replace function public.planner_role(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  select case
    when not public.can_use_lumora() then null
    when exists (select 1 from public.planner_plans where id = p and owner = auth.uid()) then 'owner'
    else (select role from public.planner_members where plan_id = p and user_id = auth.uid())
  end
$$;

alter table public.planner_plans enable row level security;
alter table public.planner_members enable row level security;
alter table public.planner_cues enable row level security;
alter table public.planner_comments enable row level security;

-- Plans: owner and members see them (the owner check is on the row itself, so
-- a new plan can be read back as it is made); anyone with Lumora access makes one
-- (as its owner); owner and editors change it; only the owner deletes it.
drop policy if exists "planner members see plans" on public.planner_plans;
create policy "planner members see plans" on public.planner_plans
  for select using ((owner = auth.uid() and public.can_use_lumora()) or public.planner_role(id) is not null);
drop policy if exists "planner make plans" on public.planner_plans;
create policy "planner make plans" on public.planner_plans
  for insert with check (owner = auth.uid() and public.can_use_lumora());
drop policy if exists "planner editors change plans" on public.planner_plans;
create policy "planner editors change plans" on public.planner_plans
  for update using (public.planner_role(id) in ('owner', 'editor')) with check (public.planner_role(id) in ('owner', 'editor'));
drop policy if exists "planner owner deletes plans" on public.planner_plans;
create policy "planner owner deletes plans" on public.planner_plans
  for delete using (public.planner_role(id) = 'owner');

-- Members: everyone on the plan sees the list; the owner changes roles and
-- removes people; anyone can leave. (Inviting goes through invite_to_planner.)
drop policy if exists "planner members see members" on public.planner_members;
create policy "planner members see members" on public.planner_members
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner owner changes roles" on public.planner_members;
create policy "planner owner changes roles" on public.planner_members
  for update using (public.planner_role(plan_id) = 'owner') with check (public.planner_role(plan_id) = 'owner');
drop policy if exists "planner owner removes or member leaves" on public.planner_members;
create policy "planner owner removes or member leaves" on public.planner_members
  for delete using (public.planner_role(plan_id) = 'owner' or user_id = auth.uid());

-- Cues: everyone on the plan reads them; the owner and editors change them.
drop policy if exists "planner members see cues" on public.planner_cues;
create policy "planner members see cues" on public.planner_cues
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner editors add cues" on public.planner_cues;
create policy "planner editors add cues" on public.planner_cues
  for insert with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors change cues" on public.planner_cues;
create policy "planner editors change cues" on public.planner_cues
  for update using (public.planner_role(plan_id) in ('owner', 'editor')) with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors delete cues" on public.planner_cues;
create policy "planner editors delete cues" on public.planner_cues
  for delete using (public.planner_role(plan_id) in ('owner', 'editor'));

-- Comments: everyone on the plan (viewers too) reads and writes them; only
-- the author changes the words; the author or the owner deletes.
drop policy if exists "planner members see comments" on public.planner_comments;
create policy "planner members see comments" on public.planner_comments
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner members comment" on public.planner_comments;
create policy "planner members comment" on public.planner_comments
  for insert with check (public.planner_role(plan_id) is not null and author = auth.uid());
drop policy if exists "planner author edits comment" on public.planner_comments;
create policy "planner author edits comment" on public.planner_comments
  for update using (author = auth.uid() and public.planner_role(plan_id) is not null) with check (author = auth.uid());
drop policy if exists "planner author or owner deletes comment" on public.planner_comments;
create policy "planner author or owner deletes comment" on public.planner_comments
  for delete using (author = auth.uid() or public.planner_role(plan_id) = 'owner');

-- A plan keeps its owner; every change is stamped with when and by whom.
create or replace function public.planner_plan_stamp() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner := auth.uid();
    new.created_at := now();
  elsif new.owner <> old.owner then
    raise exception 'A plan cannot be given to someone else.';
  end if;
  new.updated_at := now();
  new.updated_by_name := coalesce(public.my_display_name(), '');
  return new;
end
$$;
drop trigger if exists planner_plan_stamp on public.planner_plans;
create trigger planner_plan_stamp before insert or update on public.planner_plans
  for each row execute function public.planner_plan_stamp();

-- A cue stays on its plan and is stamped with when and by whom it changed
-- (the server's clock decides "last write wins").
create or replace function public.planner_cue_stamp() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.plan_id <> old.plan_id or new.id <> old.id) then
    raise exception 'A cue cannot be moved to another plan.';
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(public.my_display_name(), '');
  return new;
end
$$;
drop trigger if exists planner_cue_stamp on public.planner_cues;
create trigger planner_cue_stamp before insert or update on public.planner_cues
  for each row execute function public.planner_cue_stamp();

-- Changing a cue marks its plan as changed (for the list of plans).
create or replace function public.planner_cue_touch() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  update public.planner_plans set updated_at = now(), updated_by_name = coalesce(public.my_display_name(), '')
  where id = coalesce(new.plan_id, old.plan_id);
  return null;
end
$$;
drop trigger if exists planner_cue_touch on public.planner_cues;
create trigger planner_cue_touch after insert or update or delete on public.planner_cues
  for each row execute function public.planner_cue_touch();

-- A comment carries its writer's real name and stays on its cue.
create or replace function public.planner_comment_guard() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.planner_cues where id = new.cue_id and plan_id = new.plan_id) then
      raise exception 'That cue is not on this plan.';
    end if;
    new.author := auth.uid();
    new.author_name := coalesce(public.my_display_name(), '');
    new.created_at := now();
    return new;
  end if;
  if new.author <> old.author or new.plan_id <> old.plan_id or new.cue_id <> old.cue_id then
    raise exception 'This comment cannot be moved.';
  end if;
  return new;
end
$$;
drop trigger if exists planner_comment_guard on public.planner_comments;
create trigger planner_comment_guard before insert or update on public.planner_comments
  for each row execute function public.planner_comment_guard();

-- What people may do straight on the tables.
revoke all on public.planner_plans, public.planner_members, public.planner_cues, public.planner_comments from anon, authenticated;
grant select, insert, delete on public.planner_plans to authenticated;
grant update (name, event_date, venue, start_time, notes) on public.planner_plans to authenticated;
grant select, delete on public.planner_members to authenticated;
grant update (role) on public.planner_members to authenticated;
-- (Cues are saved with an upsert, which names every column; the trigger above
-- keeps a cue on its plan and stamps updated_at and who.)
grant select, insert, update, delete on public.planner_cues to authenticated;
grant select, insert, delete on public.planner_comments to authenticated;
grant update (text) on public.planner_comments to authenticated;

-- The plans you own or are on, newest first (with how many cues each has).
create or replace function public.my_planner_plans()
  returns table (id uuid, name text, event_date date, venue text, start_time text, role text, owner_name text,
                 cue_count integer, updated_at timestamptz, updated_by_name text)
  language sql security definer stable set search_path = public
as $$
  select p.id, p.name, p.event_date, p.venue, p.start_time, public.planner_role(p.id), coalesce(nullif(o.name, ''), o.email, ''),
    (select count(*)::integer from public.planner_cues c where c.plan_id = p.id), p.updated_at, p.updated_by_name
  from public.planner_plans p
  left join public.profiles o on o.id = p.owner
  where public.can_use_lumora() and (p.owner = auth.uid() or exists
    (select 1 from public.planner_members m where m.plan_id = p.id and m.user_id = auth.uid()))
  order by p.event_date desc nulls last, p.updated_at desc
$$;

-- Everyone on a plan, with names (for people on that plan).
create or replace function public.planner_people(p_id uuid)
  returns table (user_id uuid, email text, name text, role text)
  language sql security definer stable set search_path = public
as $$
  select o.id, o.email, o.name, 'owner'
  from public.planner_plans p join public.profiles o on o.id = p.owner
  where p.id = p_id and public.planner_role(p_id) is not null
  union all
  select pr.id, pr.email, pr.name, m.role
  from public.planner_members m join public.profiles pr on pr.id = m.user_id
  where m.plan_id = p_id and public.planner_role(p_id) is not null
$$;

-- The owner shares a plan by email (an approved account that may use
-- Lumora), or changes that person's role.
create or replace function public.invite_to_planner(p_id uuid, p_email text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  person public.profiles;
begin
  if public.planner_role(p_id) is distinct from 'owner' then
    raise exception 'Only the owner of the plan can share it.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'The role must be editor or viewer.';
  end if;
  select * into person from public.profiles where lower(email) = lower(trim(p_email));
  if person.id is null or not person.approved or person.blocked then
    raise exception 'There is no approved Lumora account with that email.';
  end if;
  if not (person.lumora or person.is_admin) then
    raise exception 'That account isn''t set up for Lumora.';
  end if;
  if person.id = auth.uid() then
    raise exception 'You already own this plan.';
  end if;
  insert into public.planner_members (plan_id, user_id, role) values (p_id, person.id, p_role)
  on conflict (plan_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('user_id', person.id, 'email', person.email, 'name', person.name, 'role', p_role);
end
$$;

-- Only signed-in people may call these.
revoke execute on function public.can_use_lumora() from public, anon;
revoke execute on function public.my_display_name() from public, anon;
revoke execute on function public.planner_role(uuid) from public, anon;
revoke execute on function public.my_planner_plans() from public, anon;
revoke execute on function public.planner_people(uuid) from public, anon;
revoke execute on function public.invite_to_planner(uuid, text, text) from public, anon;
grant execute on function public.can_use_lumora() to authenticated;
grant execute on function public.my_display_name() to authenticated;
grant execute on function public.planner_role(uuid) to authenticated;
grant execute on function public.my_planner_plans() to authenticated;
grant execute on function public.planner_people(uuid) to authenticated;
grant execute on function public.invite_to_planner(uuid, text, text) to authenticated;

-- Live updates: edits, comments and sharing show up for everyone at once.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['planner_plans', 'planner_members', 'planner_cues', 'planner_comments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

-- ---- Security: two-step sign-in, limits, Planner teammates (the same as update-6-security.sql) ----
-- See update-6-security.sql for what it does and what the Lumora team's own
-- account needs (two-step sign-in for People and approvals).

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'lumora') then
    raise exception 'Run update-4-app-access.sql first (it adds profiles.lumora), then run this again.';
  end if;
  if to_regclass('public.planner_plans') is null then
    raise exception 'Run update-5-planner.sql first (it adds the Planner), then run this again.';
  end if;
end
$$;

-- ---- Two-step sign-in ----

-- Did the asker sign in with their second step (the code)?
create or replace function public.session_aal2() returns boolean
  language sql stable set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Is the asker's session good enough: signed in with the code, or the
-- account has no two-step sign-in turned on.
create or replace function public.mfa_ok() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.session_aal2()
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;

-- Is the person asking on the Lumora team? With the code if two-step is on.
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok()
    and coalesce((select is_admin and not blocked from public.profiles where id = auth.uid()), false)
$$;

-- Approved (and not blocked), with the code if two-step is on.
create or replace function public.is_approved() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok() and coalesce((select approved and not blocked from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_use_studio() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok()
    and coalesce((select approved and not blocked and (studio or is_admin) from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_use_lumora() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok()
    and coalesce((select approved and not blocked and (lumora or is_admin) from public.profiles where id = auth.uid()), false)
$$;

-- Any signed-in account that is not blocked (Planner teammates), with the
-- code if two-step is on.
create or replace function public.account_ok() returns boolean
  language sql security definer stable set search_path = public
as $$
  select auth.uid() is not null and public.mfa_ok()
    and coalesce((select not blocked from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.set_my_name(new_name text) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if not public.account_ok() then
    raise exception 'Please sign in again (with your code, if you use two-step sign-in).';
  end if;
  update public.profiles set name = left(trim(new_name), 80) where id = auth.uid();
end
$$;

-- The Lumora team turns off someone's two-step sign-in (they lost their
-- phone). Returns how many authenticators were removed.
create or replace function public.admin_reset_two_step(p_user uuid) returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team, signed in with two-step sign-in, can do this.';
  end if;
  if p_user = auth.uid() then
    raise exception 'To change your own two-step sign-in, use My account.';
  end if;
  perform public.rate_check('reset_two_step', 20, interval '1 hour');
  begin
    delete from auth.mfa_factors where user_id = p_user;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    raise exception 'The account server does not allow this from here. Reset it in the Supabase dashboard: Authentication → Users → the person → remove their MFA factors.';
  end;
  return n;
end
$$;

-- Who has two-step sign-in on (for People and approvals).
create or replace function public.admin_two_step_people() returns setof uuid
  language plpgsql security definer stable set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team, signed in with two-step sign-in, can see this.';
  end if;
  return query select distinct f.user_id from auth.mfa_factors f where f.status = 'verified';
end
$$;

-- ---- Limits ----

-- What each account did recently (only for counting; nobody can read it).
create table if not exists public.rate_events (
  user_id uuid not null,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_user_action on public.rate_events (user_id, action, at desc);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- At most p_max of p_action in p_per for the asker (counts this one).
create or replace function public.rate_check(p_action text, p_max integer, p_per interval) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  if (select count(*) from public.rate_events where user_id = auth.uid() and action = p_action and at > now() - p_per) >= p_max then
    raise exception 'Too many at once from this account. Please wait a while and try again.';
  end if;
  insert into public.rate_events (user_id, action) values (auth.uid(), p_action);
  -- Now and then, forget the old ones.
  if random() < 0.02 then
    delete from public.rate_events where at < now() - interval '2 days';
  end if;
end
$$;

-- Studio projects: how many, how big, how often.
create or replace function public.lumora_limits_editor_projects() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if octet_length(new.doc::text) > 20000000 then
    raise exception 'This project is too big to share (over 20 MB).';
  end if;
  if tg_op = 'INSERT' then
    perform public.rate_check('share_project', 30, interval '1 hour');
    if (select count(*) from public.editor_projects where owner = new.owner) >= 300 then
      raise exception 'This account already shares 300 projects. Delete some first.';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists lumora_limits on public.editor_projects;
create trigger lumora_limits before insert or update of doc on public.editor_projects
  for each row execute function public.lumora_limits_editor_projects();

create or replace function public.lumora_limits_editor_versions() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.rate_check('project_version', 120, interval '1 hour');
  return new;
end
$$;
drop trigger if exists lumora_limits on public.editor_versions;
create trigger lumora_limits before insert on public.editor_versions
  for each row execute function public.lumora_limits_editor_versions();

-- Comments (Studio and Planner).
create or replace function public.lumora_limits_comments() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.rate_check('comment', 300, interval '1 hour');
  return new;
end
$$;
drop trigger if exists lumora_limits on public.editor_comments;
create trigger lumora_limits before insert on public.editor_comments
  for each row execute function public.lumora_limits_comments();
drop trigger if exists lumora_limits on public.planner_comments;
create trigger lumora_limits before insert on public.planner_comments
  for each row execute function public.lumora_limits_comments();

-- Plans: how many and how often; cues: how many on one plan.
create or replace function public.lumora_limits_planner_plans() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.rate_check('new_plan', 50, interval '1 hour');
  if (select count(*) from public.planner_plans where owner = auth.uid()) >= 500 then
    raise exception 'This account already has 500 plans. Delete some first.';
  end if;
  return new;
end
$$;
drop trigger if exists lumora_limits on public.planner_plans;
create trigger lumora_limits before insert on public.planner_plans
  for each row execute function public.lumora_limits_planner_plans();

create or replace function public.lumora_limits_planner_cues() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  -- (Saving changed cues also arrives here, as an upsert: only new ones count.)
  if not exists (select 1 from public.planner_cues where id = new.id)
     and (select count(*) from public.planner_cues where plan_id = new.plan_id) >= 2000 then
    raise exception 'A plan can have at most 2000 cues.';
  end if;
  return new;
end
$$;
drop trigger if exists lumora_limits on public.planner_cues;
create trigger lumora_limits before insert on public.planner_cues
  for each row execute function public.lumora_limits_planner_cues();

-- Names from sign-up: at most 80 characters (as when changed in the app).
-- Accounts made from the Planner are marked, so the Lumora team can tell
-- them from people waiting to use Lumora or Studio.
alter table public.profiles add column if not exists planner_only boolean not null default false;

create or replace function public.new_profile() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, name, approved, is_admin, lumora, studio, planner_only)
  values (new.id, new.email, left(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), 80), first, first, first, first,
          not first and coalesce(new.raw_user_meta_data ->> 'planner', '') = 'true');
  return new;
end
$$;

-- Someone made their account in the Planner, then signed in to Lumora or
-- Studio: they now ask for access, so they show up as waiting.
create or replace function public.request_app_access() returns void
  language sql security definer set search_path = public
as $$
  update public.profiles set planner_only = false where id = auth.uid() and planner_only
$$;

-- ---- Tighter rules ----

-- A blocked (or not approved) owner can't delete projects any more.
drop policy if exists "owner deletes project" on public.editor_projects;
create policy "owner deletes project" on public.editor_projects
  for delete using (owner = auth.uid() and public.can_use_studio());

-- Comments: deleting needs access to the project or plan, too.
drop policy if exists "author or owner deletes comment" on public.editor_comments;
create policy "author or owner deletes comment" on public.editor_comments
  for delete using ((author = auth.uid() and public.editor_role(project_id) is not null) or public.editor_role(project_id) = 'owner');

-- ---- Planner teammates ----

-- The asker's role on a plan: 'owner' (the owner, who must be able to use
-- Lumora), 'editor' or 'viewer' (any signed-in account on the plan), or null.
create or replace function public.planner_role(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  select case
    when not public.account_ok() then null
    when exists (select 1 from public.planner_plans where id = p and owner = auth.uid())
      then case when public.can_use_lumora() then 'owner' end
    else (select role from public.planner_members where plan_id = p and user_id = auth.uid())
  end
$$;

drop policy if exists "planner author or owner deletes comment" on public.planner_comments;
create policy "planner author or owner deletes comment" on public.planner_comments
  for delete using ((author = auth.uid() and public.planner_role(plan_id) is not null) or public.planner_role(plan_id) = 'owner');

-- The plans you own or are on.
create or replace function public.my_planner_plans()
  returns table (id uuid, name text, event_date date, venue text, start_time text, role text, owner_name text,
                 cue_count integer, updated_at timestamptz, updated_by_name text)
  language sql security definer stable set search_path = public
as $$
  select p.id, p.name, p.event_date, p.venue, p.start_time, public.planner_role(p.id), coalesce(nullif(o.name, ''), o.email, ''),
    (select count(*)::integer from public.planner_cues c where c.plan_id = p.id), p.updated_at, p.updated_by_name
  from public.planner_plans p
  left join public.profiles o on o.id = p.owner
  where public.account_ok() and (p.owner = auth.uid() or exists
    (select 1 from public.planner_members m where m.plan_id = p.id and m.user_id = auth.uid()))
    and public.planner_role(p.id) is not null
  order by p.event_date desc nulls last, p.updated_at desc
$$;

-- Invitations to people who have no account yet.
create table if not exists public.planner_invites (
  plan_id uuid not null references public.planner_plans on delete cascade,
  email text not null check (char_length(email) <= 254),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (plan_id, email)
);
alter table public.planner_invites enable row level security;
drop policy if exists "planner owner sees invites" on public.planner_invites;
create policy "planner owner sees invites" on public.planner_invites
  for select using (public.planner_role(plan_id) = 'owner');
drop policy if exists "planner owner cancels invites" on public.planner_invites;
create policy "planner owner cancels invites" on public.planner_invites
  for delete using (public.planner_role(plan_id) = 'owner');
revoke all on public.planner_invites from anon, authenticated;
grant select, delete on public.planner_invites to authenticated;

-- The owner shares a plan by email (any account; or an invitation kept
-- until that person makes one), or changes that person's role.
create or replace function public.invite_to_planner(p_id uuid, p_email text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  person public.profiles;
  e text := lower(trim(coalesce(p_email, '')));
begin
  if public.planner_role(p_id) is distinct from 'owner' then
    raise exception 'Only the owner of the plan can share it.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'The role must be editor or viewer.';
  end if;
  if char_length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address.';
  end if;
  perform public.rate_check('planner_invite', 50, interval '1 day');
  select * into person from public.profiles where lower(email) = e;
  if person.id = auth.uid() then
    raise exception 'You already own this plan.';
  end if;
  if person.id is not null then
    if person.blocked then
      raise exception 'That account can''t be added to plans.';
    end if;
    insert into public.planner_members (plan_id, user_id, role) values (p_id, person.id, p_role)
    on conflict (plan_id, user_id) do update set role = excluded.role;
    delete from public.planner_invites where plan_id = p_id and email = e;
    return jsonb_build_object('user_id', person.id, 'email', person.email, 'name', person.name, 'role', p_role, 'pending', false);
  end if;
  insert into public.planner_invites (plan_id, email, role, invited_by) values (p_id, e, p_role, auth.uid())
  on conflict (plan_id, email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();
  return jsonb_build_object('email', e, 'role', p_role, 'pending', true);
end
$$;

-- After signing in to the Planner: invitations to your (confirmed) email
-- become plans you are on. Returns how many.
create or replace function public.claim_planner_invites() returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  e text;
  n integer := 0;
begin
  if not public.account_ok() then
    return 0;
  end if;
  select lower(u.email) into e from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if e is null or e <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    return 0;
  end if;
  with claimed as (
    delete from public.planner_invites i where i.email = e returning i.plan_id, i.role
  )
  insert into public.planner_members (plan_id, user_id, role)
  select c.plan_id, auth.uid(), c.role from claimed c
  where not exists (select 1 from public.planner_plans p where p.id = c.plan_id and p.owner = auth.uid())
  on conflict (plan_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end
$$;

-- ---- Problem reports (update 3), if there ----
do $$
begin
  if to_regclass('public.problem_reports') is null then
    return;
  end if;
  execute 'drop policy if exists "signed in people send reports" on public.problem_reports';
  execute $p$create policy "signed in people send reports" on public.problem_reports
    for insert to authenticated
    with check (user_id = auth.uid() and public.is_approved() and resolved = false and resolved_at is null and resolved_by is null)$p$;
end
$$;

create or replace function public.problem_report_limit() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    if (select count(*) from public.problem_reports
        where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'Too many problem reports from this account in the last hour.';
    end if;
    if new.screenshot is not null and (select count(*) from public.problem_reports
        where user_id = auth.uid() and has_screenshot and created_at > now() - interval '1 day') >= 10 then
      raise exception 'Too many pictures in problem reports from this account today.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.resolved and not old.resolved then
      new.resolved_at := now();
      new.resolved_by := auth.uid();
    elsif not new.resolved then
      new.resolved_at := null;
      new.resolved_by := null;
    end if;
  end if;
  return new;
end
$$;

-- ---- Who may call what ----
-- Functions are callable by everyone unless taken away: signed-out visitors
-- (anon) get none of Lumora's, signed-in people only the ones the apps use.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_admin()', 'public.is_approved()', 'public.can_use_studio()', 'public.can_use_lumora()',
    'public.session_aal2()', 'public.mfa_ok()', 'public.account_ok()', 'public.set_my_name(text)',
    'public.admin_reset_two_step(uuid)', 'public.admin_two_step_people()', 'public.request_app_access()',
    'public.planner_role(uuid)', 'public.my_planner_plans()', 'public.invite_to_planner(uuid, text, text)',
    'public.claim_planner_invites()', 'public.my_display_name()', 'public.editor_role(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Only for use inside Lumora's own functions and triggers.
  foreach f in array array[
    'public.rate_check(text, integer, interval)', 'public.new_profile()', 'public.problem_report_limit()',
    'public.lumora_limits_editor_projects()', 'public.lumora_limits_editor_versions()', 'public.lumora_limits_comments()',
    'public.lumora_limits_planner_plans()', 'public.lumora_limits_planner_cues()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end
$$;

-- Live updates: the Planner's owner sees invitations change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planner_invites') then
    alter publication supabase_realtime add table public.planner_invites;
  end if;
end
$$;

-- ---- Check: every table has row level security ----
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise warning 'Table public.% has no row level security: anyone with the app key may read it. Turn it on.', t;
  end loop;
end
$$;
