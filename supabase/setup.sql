-- Lumora sign-in: run this once in your Supabase project
-- (Supabase → SQL Editor → New query → paste all of this → Run).
--
-- It also sets up Lumora Studio's team projects (the same as
-- update-2-editor-collab.sql), which apps each account may use (the same as
-- update-4-app-access.sql) and Lumora Planner (at the end; the same as
-- update-5-planner.sql) and the security update (two-step sign-in, limits
-- and Planner teammates; at the end, the same as update-6-security.sql)
-- and Planner chat and schedules (at the end; the same as update-8-planner.sql)
-- and the sign-in settings and features the Lumora team controls from the
-- apps (at the end; the same as update-9-sign-in-settings.sql) and the
-- Planner's show day and production tools (at the end; the same as
-- update-10-planner-pro.sql).
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

-- ---- Planner chat and schedules (the same as update-8-planner.sql) ----
-- See update-8-planner.sql for what it does.

do $$
begin
  if to_regclass('public.planner_plans') is null then
    raise exception 'Run update-5-planner.sql first (it adds the Planner), then run this again.';
  end if;
  if to_regprocedure('public.account_ok()') is null or to_regprocedure('public.rate_check(text, integer, interval)') is null then
    raise exception 'Run update-6-security.sql first (it adds account_ok and rate_check), then run this again.';
  end if;
end
$$;

-- ---- Chat ----

create table if not exists public.planner_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  author uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists planner_messages_plan on public.planner_messages (plan_id, created_at);
alter table public.planner_messages enable row level security;

drop policy if exists "planner members read messages" on public.planner_messages;
create policy "planner members read messages" on public.planner_messages
  for select using (public.planner_role(plan_id) is not null and public.account_ok());
drop policy if exists "planner members send messages" on public.planner_messages;
create policy "planner members send messages" on public.planner_messages
  for insert with check (author = auth.uid() and public.planner_role(plan_id) is not null and public.account_ok());
drop policy if exists "planner author or owner deletes message" on public.planner_messages;
create policy "planner author or owner deletes message" on public.planner_messages
  for delete using ((author = auth.uid() and public.planner_role(plan_id) is not null) or public.planner_role(plan_id) = 'owner');

-- A message is stamped with its author, their name and the time; at most
-- 30 a minute from one account.
create or replace function public.planner_message_guard() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.rate_check('planner_message', 30, interval '1 minute');
  new.author := auth.uid();
  new.author_name := left(coalesce(public.my_display_name(), ''), 80);
  new.created_at := now();
  new.body := trim(new.body);
  return new;
end
$$;
drop trigger if exists planner_message_guard on public.planner_messages;
create trigger planner_message_guard before insert on public.planner_messages
  for each row execute function public.planner_message_guard();

revoke all on public.planner_messages from anon, authenticated;
grant select, insert, delete on public.planner_messages to authenticated;

-- ---- Schedules ----

create table if not exists public.planner_schedule (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  day date,
  starts time,
  ends time,
  title text not null default '' check (char_length(title) <= 120),
  location text not null default '' check (char_length(location) <= 120),
  who text not null default '' check (char_length(who) <= 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  sort double precision not null default 0,
  updated_at timestamptz not null default now(),
  updated_by_name text not null default ''
);
create index if not exists planner_schedule_plan on public.planner_schedule (plan_id, day, starts, sort);
alter table public.planner_schedule enable row level security;

drop policy if exists "planner members see schedule" on public.planner_schedule;
create policy "planner members see schedule" on public.planner_schedule
  for select using (public.planner_role(plan_id) is not null and public.account_ok());
drop policy if exists "planner editors add schedule" on public.planner_schedule;
create policy "planner editors add schedule" on public.planner_schedule
  for insert with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors change schedule" on public.planner_schedule;
create policy "planner editors change schedule" on public.planner_schedule
  for update using (public.planner_role(plan_id) in ('owner', 'editor')) with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors delete schedule" on public.planner_schedule;
create policy "planner editors delete schedule" on public.planner_schedule
  for delete using (public.planner_role(plan_id) in ('owner', 'editor'));

-- A block stays on its plan, is stamped with when and by whom, and a plan
-- has at most 500 of them.
create or replace function public.planner_schedule_stamp() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.planner_schedule where plan_id = new.plan_id) >= 500 then
      raise exception 'A plan can have at most 500 schedule blocks.';
    end if;
    perform public.rate_check('planner_schedule', 600, interval '1 hour');
  elsif new.plan_id <> old.plan_id then
    raise exception 'A schedule block cannot be moved to another plan.';
  end if;
  new.updated_at := now();
  new.updated_by_name := left(coalesce(public.my_display_name(), ''), 80);
  return new;
end
$$;
drop trigger if exists planner_schedule_stamp on public.planner_schedule;
create trigger planner_schedule_stamp before insert or update on public.planner_schedule
  for each row execute function public.planner_schedule_stamp();

revoke all on public.planner_schedule from anon, authenticated;
grant select, insert, update, delete on public.planner_schedule to authenticated;

-- Trigger functions are not for calling.
revoke execute on function public.planner_message_guard() from public, anon, authenticated;
revoke execute on function public.planner_schedule_stamp() from public, anon, authenticated;

-- Live updates: messages and schedule changes show up for everyone at once.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['planner_messages', 'planner_schedule'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
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

-- ---- Sign-in settings and features (the same as update-9-sign-in-settings.sql) ----
-- See update-9-sign-in-settings.sql for what it does.

do $$
begin
  if to_regprocedure('public.account_ok()') is null or to_regprocedure('public.rate_check(text, integer, interval)') is null
     or to_regclass('public.planner_invites') is null then
    raise exception 'Run update-6-security.sql first (it adds account_ok, rate_check and planner_invites), then run this again.';
  end if;
end
$$;

-- ---- The settings (one row) ----

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  -- New accounts: 'manual' (wait for the team) or 'auto' (approved at once).
  approval text not null default 'manual' check (approval in ('manual', 'auto')),
  -- The apps automatically approved accounts get.
  auto_lumora boolean not null default true,
  auto_studio boolean not null default true,
  -- Automatic approval only for these email domains (empty: every email).
  auto_domains text[] not null default '{}',
  -- 'open' (anyone can make an account) or 'closed' (invited emails only).
  signups text not null default 'open' check (signups in ('open', 'closed')),
  -- Two-step sign-in: 'optional', required for the Lumora 'team', or for 'everyone'.
  two_step text not null default 'optional' check (two_step in ('optional', 'team', 'everyone')),
  -- Days the apps keep working without checking in.
  offline_days integer not null default 7 check (offline_days in (1, 3, 7, 14, 30)),
  -- Who makes new plans: approved 'lumora' accounts, or 'anyone' with an account.
  planner_makers text not null default 'lumora' check (planner_makers in ('lumora', 'anyone')),
  -- Shown on the waiting and no-access screens ('' : the usual words).
  waiting_message text not null default '' check (char_length(waiting_message) <= 500),
  -- Switches: {"captions": false, ...} (missing: on).
  features jsonb not null default '{}'::jsonb,
  -- Why an app is paused: {"planner": "Paused for maintenance until 6 PM"}.
  pause_messages jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  updated_by uuid references auth.users on delete set null,
  updated_by_name text not null default ''
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
-- Read through sign_in_rules() (everyone: the parts the apps need) and
-- admin_app_settings() (the Lumora team: all of it); changed only through
-- save_app_settings() (the Lumora team).
drop policy if exists "team reads settings" on public.app_settings;
create policy "team reads settings" on public.app_settings for select using (public.is_admin());
revoke all on public.app_settings from anon, authenticated;

-- Who changed what, and when.
create table if not exists public.app_settings_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  by_user uuid references auth.users on delete set null,
  by_name text not null default '',
  setting text not null,
  -- For a change to one person (their features, an invitation).
  person uuid references auth.users on delete set null,
  person_email text not null default '',
  old_value jsonb,
  new_value jsonb
);
create index if not exists app_settings_log_at on public.app_settings_log (at desc);
alter table public.app_settings_log enable row level security;
drop policy if exists "team reads settings log" on public.app_settings_log;
create policy "team reads settings log" on public.app_settings_log for select using (public.is_admin());
revoke all on public.app_settings_log from anon, authenticated;
grant select on public.app_settings_log to authenticated;

-- A feature switched on or off for one person (wins over the setting for everyone).
create table if not exists public.feature_overrides (
  user_id uuid not null references auth.users on delete cascade,
  feature text not null,
  enabled boolean not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table public.feature_overrides enable row level security;
drop policy if exists "own or team sees overrides" on public.feature_overrides;
create policy "own or team sees overrides" on public.feature_overrides for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.feature_overrides from anon, authenticated;
grant select on public.feature_overrides to authenticated;

-- Emails the Lumora team invited (approved with these apps once they make an
-- account and confirm the email).
create table if not exists public.app_invites (
  email text primary key check (char_length(email) <= 254),
  lumora boolean not null default true,
  studio boolean not null default false,
  invited_by uuid references auth.users on delete set null,
  invited_by_name text not null default '',
  created_at timestamptz not null default now(),
  check (lumora or studio)
);
alter table public.app_invites enable row level security;
drop policy if exists "team sees invites" on public.app_invites;
create policy "team sees invites" on public.app_invites for select using (public.is_admin());
drop policy if exists "team cancels invites" on public.app_invites;
create policy "team cancels invites" on public.app_invites for delete using (public.is_admin());
revoke all on public.app_invites from anon, authenticated;
grant select, delete on public.app_invites to authenticated;

-- ---- Features ----

-- Every switch: the three apps, then the features.
create or replace function public.feature_keys() returns text[]
  language sql immutable
as $$
  select array['lumora', 'studio', 'planner', 'planner_chat', 'planner_sharing', 'studio_sharing', 'problem_reports',
               'audience_link', 'captions', 'ai_tools', 'stream_deck', 'update_prompt']
$$;

-- Is this switch on for the asker? Their own setting first, then the one for
-- everyone, else on. A paused app stays open for the Lumora team.
create or replace function public.feature_on(p_key text) returns boolean
  language sql security definer stable set search_path = public
as $$
  select case
    when p_key in ('lumora', 'studio', 'planner')
      and coalesce((select is_admin and not blocked from public.profiles where id = auth.uid()), false) then true
    else coalesce(
      (select o.enabled from public.feature_overrides o where o.user_id = auth.uid() and o.feature = p_key),
      (select (s.features ->> p_key)::boolean from public.app_settings s where s.id),
      true)
  end
$$;

-- ---- Two-step sign-in ----

-- Must the asker use two-step sign-in?
create or replace function public.two_step_required() returns boolean
  language sql security definer stable set search_path = public
as $$
  select case coalesce((select two_step from public.app_settings where id), 'optional')
    when 'everyone' then auth.uid() is not null
    when 'team' then coalesce((select is_admin from public.profiles where id = auth.uid()), false)
    else false
  end
$$;

-- Is the asker's session good enough: signed in with the code, or the
-- account has no two-step sign-in turned on and it is not required.
create or replace function public.mfa_ok() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.session_aal2()
    or (not public.two_step_required()
        and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'))
$$;

-- ---- Apps ----

create or replace function public.can_use_studio() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok() and public.feature_on('studio')
    and coalesce((select approved and not blocked and (studio or is_admin) from public.profiles where id = auth.uid()), false)
$$;

-- May the asker make new plans? (The Planner on; an approved Lumora account,
-- or any account when the team allows it.)
create or replace function public.can_make_plans() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.feature_on('planner') and (public.can_use_lumora()
    or (coalesce((select planner_makers from public.app_settings where id), 'lumora') = 'anyone' and public.account_ok()))
$$;

-- The asker's role on a plan (nothing while the Planner is paused).
create or replace function public.planner_role(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  select case
    when not public.account_ok() or not public.feature_on('planner') then null
    when exists (select 1 from public.planner_plans where id = p and owner = auth.uid())
      then case when public.can_make_plans() then 'owner' end
    else (select role from public.planner_members where plan_id = p and user_id = auth.uid())
  end
$$;

drop policy if exists "planner members see plans" on public.planner_plans;
create policy "planner members see plans" on public.planner_plans
  for select using ((owner = auth.uid() and public.can_make_plans()) or public.planner_role(id) is not null);
drop policy if exists "planner make plans" on public.planner_plans;
create policy "planner make plans" on public.planner_plans
  for insert with check (owner = auth.uid() and public.can_make_plans());

-- ---- New accounts ----

-- Approve this account now if an invitation or the automatic approval says
-- so (only once its email is confirmed).
create or replace function public.auto_approve(p_user uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  s public.app_settings;
  inv public.app_invites;
  e text;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or p.approved or p.blocked then
    return;
  end if;
  select lower(u.email) into e from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
  if e is null then
    return;
  end if;
  select * into inv from public.app_invites where email = e;
  if inv.email is not null then
    update public.profiles set approved = true, lumora = inv.lumora, studio = inv.studio, planner_only = false where id = p_user;
    delete from public.app_invites where email = e;
    insert into public.app_settings_log (by_user, by_name, setting, person, person_email, new_value)
    values (p_user, 'Invitation', 'invite_used', p_user, e, jsonb_build_object('lumora', inv.lumora, 'studio', inv.studio));
    return;
  end if;
  -- Made in the Planner: approved when they open Lumora or Studio (request_app_access).
  if p.planner_only then
    return;
  end if;
  select * into s from public.app_settings where id;
  if coalesce(s.approval, 'manual') <> 'auto' or not (s.auto_lumora or s.auto_studio) then
    return;
  end if;
  if cardinality(s.auto_domains) > 0 and not (split_part(e, '@', 2) = any (s.auto_domains)) then
    return;
  end if;
  update public.profiles set approved = true, lumora = s.auto_lumora, studio = s.auto_studio where id = p_user;
  insert into public.app_settings_log (by_user, by_name, setting, person, person_email, new_value)
  values (p_user, 'Automatic approval', 'auto_approved', p_user, e, jsonb_build_object('lumora', s.auto_lumora, 'studio', s.auto_studio));
end
$$;

-- A new account gets its profile. While sign-ups are closed, only invited
-- emails (to Lumora, or to a Planner plan) can make one.
create or replace function public.new_profile() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.profiles);
  e text := lower(coalesce(new.email, ''));
begin
  if not first and coalesce((select signups from public.app_settings where id), 'open') = 'closed'
     and not exists (select 1 from public.app_invites where email = e)
     and not exists (select 1 from public.planner_invites where email = e) then
    raise exception 'New sign-ups are closed. Ask the Lumora team to invite you.';
  end if;
  insert into public.profiles (id, email, name, approved, is_admin, lumora, studio, planner_only)
  values (new.id, new.email, left(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), 80), first, first, first, first,
          not first and coalesce(new.raw_user_meta_data ->> 'planner', '') = 'true');
  perform public.auto_approve(new.id);
  return new;
end
$$;

-- The email was confirmed: an invitation or the automatic approval applies now.
create or replace function public.account_confirmed() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.auto_approve(new.id);
  end if;
  return new;
end
$$;
drop trigger if exists on_account_confirmed on auth.users;
create trigger on_account_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.account_confirmed();

-- Made in the Planner, then signed in to Lumora or Studio: now waiting (or
-- approved at once, when the settings say so).
create or replace function public.request_app_access() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set planner_only = false where id = auth.uid() and planner_only;
  perform public.auto_approve(auth.uid());
end
$$;

-- ---- Switches enforced here (not only in the apps) ----

-- Stops new rows while a feature is off (TG_ARGV[0]: the feature; with
-- TG_ARGV[1] = 'others', only rows for someone other than the asker).
create or replace function public.feature_guard() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_nargs > 1 and tg_argv[1] = 'others' then
    if new.user_id = auth.uid() then
      return new;
    end if;
  end if;
  if auth.uid() is not null and not public.feature_on(tg_argv[0]) then
    raise exception '%', case tg_argv[0]
      when 'studio_sharing' then 'Team sharing and comments in Lumora Studio are turned off by the Lumora team right now.'
      when 'planner_sharing' then 'Sharing plans is turned off by the Lumora team right now.'
      when 'planner_chat' then 'Planner chat is turned off by the Lumora team right now.'
      when 'problem_reports' then 'Problem reports are turned off by the Lumora team right now.'
      else 'This is turned off by the Lumora team right now.' end;
  end if;
  return new;
end
$$;
drop trigger if exists lumora_feature on public.editor_projects;
create trigger lumora_feature before insert on public.editor_projects
  for each row execute function public.feature_guard('studio_sharing');
drop trigger if exists lumora_feature on public.editor_project_members;
create trigger lumora_feature before insert on public.editor_project_members
  for each row execute function public.feature_guard('studio_sharing');
drop trigger if exists lumora_feature on public.editor_comments;
create trigger lumora_feature before insert on public.editor_comments
  for each row execute function public.feature_guard('studio_sharing');
drop trigger if exists lumora_feature on public.planner_invites;
create trigger lumora_feature before insert on public.planner_invites
  for each row execute function public.feature_guard('planner_sharing');
-- (Claiming your own invitation still works.)
drop trigger if exists lumora_feature on public.planner_members;
create trigger lumora_feature before insert on public.planner_members
  for each row execute function public.feature_guard('planner_sharing', 'others');
do $$
begin
  if to_regclass('public.planner_messages') is not null then
    execute 'drop trigger if exists lumora_feature on public.planner_messages';
    execute 'create trigger lumora_feature before insert on public.planner_messages
      for each row execute function public.feature_guard(''planner_chat'')';
  end if;
  if to_regclass('public.problem_reports') is not null then
    execute 'drop trigger if exists lumora_feature on public.problem_reports';
    execute 'create trigger lumora_feature before insert on public.problem_reports
      for each row execute function public.feature_guard(''problem_reports'')';
  end if;
end
$$;

-- ---- For the apps ----

-- The rules the apps need (for the asker; nothing private).
create or replace function public.sign_in_rules() returns jsonb
  language sql security definer stable set search_path = public
as $$
  select jsonb_build_object(
    'signups', coalesce(s.signups, 'open'),
    'two_step', coalesce(s.two_step, 'optional'),
    'two_step_required', public.two_step_required(),
    'offline_days', coalesce(s.offline_days, 7),
    'planner_makers', coalesce(s.planner_makers, 'lumora'),
    'can_make_plans', public.can_make_plans(),
    'waiting_message', coalesce(s.waiting_message, ''),
    'features', (select jsonb_object_agg(k, public.feature_on(k)) from unnest(public.feature_keys()) k),
    'pause_messages', coalesce(s.pause_messages, '{}'::jsonb))
  from (select 1) one
  left join public.app_settings s on s.id
$$;

-- May new accounts be made? (Before signing in: so the apps can hide
-- "Make an account". Invited emails can still make one.)
create or replace function public.sign_ups_open() returns boolean
  language sql security definer stable set search_path = public
as $$
  select coalesce((select signups from public.app_settings where id), 'open') = 'open'
    or not exists (select 1 from public.profiles)
$$;

-- ---- For the Lumora team ----

-- All the settings, the waiting invitations, the per-person switches, and
-- the latest changes (newest first).
create or replace function public.admin_app_settings() returns jsonb
  language plpgsql security definer stable set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team can see these settings.';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.app_settings s where s.id),
    'invites', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.app_invites i), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'feature', o.feature, 'enabled', o.enabled))
                           from public.feature_overrides o), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc, l.id desc)
                     from (select * from public.app_settings_log order by at desc, id desc limit 100) l), '[]'::jsonb));
end
$$;

-- Change settings: only the keys given ({"approval": "auto", "features":
-- {"captions": false}, ...}). Each change is logged. Returns all the settings.
create or replace function public.save_app_settings(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  s public.app_settings;
  n public.app_settings;
  who text := left(coalesce(public.my_display_name(), ''), 80);
  k text;
  v jsonb;
  d text;
  domains text[] := '{}';
  sub text;
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team can change these settings.';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Nothing to save.';
  end if;
  perform public.rate_check('app_settings', 120, interval '1 hour');
  select * into s from public.app_settings where id for update;
  if s.id is null then
    insert into public.app_settings (id) values (true) returning * into s;
  end if;
  n := s;
  for k, v in select * from jsonb_each(p) loop
    case k
      when 'approval' then
        if v #>> '{}' not in ('manual', 'auto') then raise exception 'New accounts: choose approval or automatic.'; end if;
        n.approval := v #>> '{}';
      when 'auto_lumora' then n.auto_lumora := coalesce((v #>> '{}')::boolean, false);
      when 'auto_studio' then n.auto_studio := coalesce((v #>> '{}')::boolean, false);
      when 'auto_domains' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 50 then raise exception 'Up to 50 domains.'; end if;
        for d in select lower(trim(leading '@' from trim(x))) from jsonb_array_elements_text(v) x loop
          if d = '' then continue; end if;
          if d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or char_length(d) > 253 then
            raise exception '"%" is not a domain (like mycompany.com).', d;
          end if;
          if not d = any (domains) then domains := domains || d; end if;
        end loop;
        n.auto_domains := domains;
      when 'signups' then
        if v #>> '{}' not in ('open', 'closed') then raise exception 'New sign-ups: choose open or closed.'; end if;
        n.signups := v #>> '{}';
      when 'two_step' then
        if v #>> '{}' not in ('optional', 'team', 'everyone') then raise exception 'Two-step sign-in: choose optional, the team, or everyone.'; end if;
        n.two_step := v #>> '{}';
      when 'offline_days' then
        if v #>> '{}' not in ('1', '3', '7', '14', '30') then raise exception 'Offline use: choose 1, 3, 7, 14 or 30 days.'; end if;
        n.offline_days := (v #>> '{}')::integer;
      when 'planner_makers' then
        if v #>> '{}' not in ('lumora', 'anyone') then raise exception 'Planner: choose Lumora accounts or any account.'; end if;
        n.planner_makers := v #>> '{}';
      when 'waiting_message' then
        if char_length(trim(coalesce(v #>> '{}', ''))) > 500 then raise exception 'The waiting message can be at most 500 characters.'; end if;
        n.waiting_message := trim(coalesce(v #>> '{}', ''));
      when 'features' then
        if jsonb_typeof(v) <> 'object' then raise exception 'Features: on or off for each.'; end if;
        for sub in select jsonb_object_keys(v) loop
          if not sub = any (public.feature_keys()) or jsonb_typeof(v -> sub) <> 'boolean' then
            raise exception 'Unknown feature: %', sub;
          end if;
        end loop;
        n.features := n.features || v;
      when 'pause_messages' then
        if jsonb_typeof(v) <> 'object' then raise exception 'Pause messages: one for each app.'; end if;
        for sub in select jsonb_object_keys(v) loop
          if sub not in ('lumora', 'studio', 'planner') or jsonb_typeof(v -> sub) <> 'string' or char_length(v ->> sub) > 300 then
            raise exception 'A pause message is at most 300 characters, for Lumora, Studio or the Planner.';
          end if;
        end loop;
        n.pause_messages := n.pause_messages || v;
      else
        raise exception 'Unknown setting: %', k;
    end case;
  end loop;
  if n.approval = 'auto' and not (n.auto_lumora or n.auto_studio) then
    raise exception 'Choose at least one app for automatically approved accounts.';
  end if;
  if n.two_step <> 'optional' and n.two_step is distinct from s.two_step
     and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') then
    raise exception 'Turn on two-step sign-in for your own account first (My account → Two-step sign-in), so you are not locked out.';
  end if;
  -- Keep each change: who, when, what it was, what it is now.
  for k in select jsonb_object_keys(to_jsonb(n)) loop
    continue when k in ('id', 'updated_at', 'updated_by', 'updated_by_name');
    if k in ('features', 'pause_messages') then
      for sub in select jsonb_object_keys(to_jsonb(n) -> k) loop
        if (to_jsonb(s) -> k -> sub) is distinct from (to_jsonb(n) -> k -> sub) then
          insert into public.app_settings_log (by_user, by_name, setting, old_value, new_value)
          values (auth.uid(), who, k || '.' || sub, to_jsonb(s) -> k -> sub, to_jsonb(n) -> k -> sub);
        end if;
      end loop;
    elsif (to_jsonb(s) -> k) is distinct from (to_jsonb(n) -> k) then
      insert into public.app_settings_log (by_user, by_name, setting, old_value, new_value)
      values (auth.uid(), who, k, to_jsonb(s) -> k, to_jsonb(n) -> k);
    end if;
  end loop;
  update public.app_settings set
    approval = n.approval, auto_lumora = n.auto_lumora, auto_studio = n.auto_studio, auto_domains = n.auto_domains,
    signups = n.signups, two_step = n.two_step, offline_days = n.offline_days, planner_makers = n.planner_makers,
    waiting_message = n.waiting_message, features = n.features, pause_messages = n.pause_messages,
    updated_at = now(), updated_by = auth.uid(), updated_by_name = who
  where id;
  return public.admin_app_settings();
end
$$;

-- Switch a feature on or off for one person (null: back to the setting for everyone).
create or replace function public.set_feature_override(p_user uuid, p_feature text, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  was boolean;
  e text;
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team can change this.';
  end if;
  if not p_feature = any (public.feature_keys()) then
    raise exception 'Unknown feature: %', p_feature;
  end if;
  select email into e from public.profiles where id = p_user;
  if e is null then
    raise exception 'There is no such account.';
  end if;
  perform public.rate_check('feature_override', 300, interval '1 hour');
  select enabled into was from public.feature_overrides where user_id = p_user and feature = p_feature;
  if p_enabled is null then
    delete from public.feature_overrides where user_id = p_user and feature = p_feature;
  else
    insert into public.feature_overrides (user_id, feature, enabled, set_by) values (p_user, p_feature, p_enabled, auth.uid())
    on conflict (user_id, feature) do update set enabled = excluded.enabled, set_by = excluded.set_by, set_at = now();
  end if;
  if was is distinct from p_enabled then
    insert into public.app_settings_log (by_user, by_name, setting, person, person_email, old_value, new_value)
    values (auth.uid(), left(coalesce(public.my_display_name(), ''), 80), 'person.' || p_feature, p_user, e, to_jsonb(was), to_jsonb(p_enabled));
  end if;
end
$$;

-- Invite an email with the chosen apps. An existing account is approved
-- with them at once; otherwise the invitation waits until that person makes
-- an account and confirms the email. Returns {"email", "pending"}.
create or replace function public.invite_to_lumora(p_email text, p_lumora boolean, p_studio boolean) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  person public.profiles;
  who text := left(coalesce(public.my_display_name(), ''), 80);
begin
  if not public.is_admin() then
    raise exception 'Only the Lumora team can invite people.';
  end if;
  if char_length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address.';
  end if;
  if not (coalesce(p_lumora, false) or coalesce(p_studio, false)) then
    raise exception 'Choose Lumora and/or Studio.';
  end if;
  perform public.rate_check('app_invite', 100, interval '1 day');
  select * into person from public.profiles where lower(email) = e;
  if person.id is not null then
    if person.blocked then
      raise exception 'That account is blocked. Unblock it in People instead.';
    end if;
    update public.profiles set approved = true, planner_only = false,
      lumora = lumora or p_lumora, studio = studio or p_studio where id = person.id;
    insert into public.app_settings_log (by_user, by_name, setting, person, person_email, new_value)
    values (auth.uid(), who, 'invite', person.id, e, jsonb_build_object('lumora', p_lumora, 'studio', p_studio, 'pending', false));
    return jsonb_build_object('email', e, 'pending', false);
  end if;
  insert into public.app_invites (email, lumora, studio, invited_by, invited_by_name) values (e, p_lumora, p_studio, auth.uid(), who)
  on conflict (email) do update set lumora = excluded.lumora, studio = excluded.studio, invited_by = excluded.invited_by,
    invited_by_name = excluded.invited_by_name, created_at = now();
  insert into public.app_settings_log (by_user, by_name, setting, person_email, new_value)
  values (auth.uid(), who, 'invite', e, jsonb_build_object('lumora', p_lumora, 'studio', p_studio, 'pending', true));
  return jsonb_build_object('email', e, 'pending', true);
end
$$;

-- ---- Who may call what ----
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.feature_on(text)', 'public.two_step_required()', 'public.mfa_ok()', 'public.can_use_studio()',
    'public.can_make_plans()', 'public.planner_role(uuid)', 'public.request_app_access()', 'public.sign_in_rules()',
    'public.admin_app_settings()', 'public.save_app_settings(jsonb)', 'public.set_feature_override(uuid, text, boolean)',
    'public.invite_to_lumora(text, boolean, boolean)', 'public.feature_keys()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Before signing in, too.
  revoke execute on function public.sign_ups_open() from public;
  grant execute on function public.sign_ups_open() to anon, authenticated;
  -- Only for use inside Lumora's own functions and triggers.
  foreach f in array array['public.auto_approve(uuid)', 'public.new_profile()', 'public.account_confirmed()', 'public.feature_guard()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
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

-- ---- Planner show day and production tools (the same as update-10-planner-pro.sql) ----
-- See update-10-planner-pro.sql for what it does and who may do what.

do $$
begin
  if to_regclass('public.planner_messages') is null or to_regclass('public.planner_schedule') is null then
    raise exception 'Run update-8-planner.sql first (it adds Planner chat and schedules), then run this again.';
  end if;
  if to_regprocedure('public.feature_on(text)') is null then
    raise exception 'Run update-9-sign-in-settings.sql first (it adds the feature switches), then run this again.';
  end if;
end
$$;

-- ---- Plans and cues: new columns ----

alter table public.planner_plans add column if not exists time_zone text not null default '' check (char_length(time_zone) <= 64);
alter table public.planner_plans add column if not exists end_by text not null default '' check (char_length(end_by) <= 8);
alter table public.planner_plans add column if not exists columns jsonb not null default '[]'::jsonb
  check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) <= 12 and pg_column_size(columns) <= 4000);
alter table public.planner_plans add column if not exists is_template boolean not null default false;
alter table public.planner_plans add column if not exists share_token uuid unique;
alter table public.planner_plans add column if not exists share_scope text not null default 'agenda' check (share_scope in ('agenda', 'crew'));

alter table public.planner_cues add column if not exists script text not null default '' check (char_length(script) <= 20000);
alter table public.planner_cues add column if not exists color text not null default ''
  check (color in ('', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'));
alter table public.planner_cues add column if not exists skip boolean not null default false;
alter table public.planner_cues add column if not exists custom jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8000);

alter table public.planner_comments add column if not exists mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20);
alter table public.planner_messages add column if not exists mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20);

grant update (name, event_date, venue, start_time, notes, time_zone, end_by, columns, is_template) on public.planner_plans to authenticated;

-- ---- Section locks ----

-- A section listed here can be changed only by the owner and the editors named.
create table if not exists public.planner_sections (
  plan_id uuid not null references public.planner_plans on delete cascade,
  section text not null check (char_length(section) between 1 and 60),
  editors uuid[] not null default '{}' check (cardinality(editors) <= 50),
  primary key (plan_id, section)
);
alter table public.planner_sections enable row level security;

drop policy if exists "planner members see section locks" on public.planner_sections;
create policy "planner members see section locks" on public.planner_sections
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner owner locks sections" on public.planner_sections;
create policy "planner owner locks sections" on public.planner_sections
  for all using (public.planner_role(plan_id) = 'owner') with check (public.planner_role(plan_id) = 'owner');
revoke all on public.planner_sections from anon, authenticated;
grant select, insert, update, delete on public.planner_sections to authenticated;

-- May the asker change cues in this section of this plan?
create or replace function public.planner_can_edit(p uuid, sec text) returns boolean
  language sql security definer stable set search_path = public
as $$
  select case public.planner_role(p)
    when 'owner' then true
    when 'editor' then not exists (
      select 1 from public.planner_sections s
      where s.plan_id = p and s.section = coalesce(sec, '') and not (auth.uid() = any (s.editors)))
    else false
  end
$$;

drop policy if exists "planner editors add cues" on public.planner_cues;
create policy "planner editors add cues" on public.planner_cues
  for insert with check (public.planner_can_edit(plan_id, section));
drop policy if exists "planner editors change cues" on public.planner_cues;
create policy "planner editors change cues" on public.planner_cues
  for update using (public.planner_can_edit(plan_id, section)) with check (public.planner_can_edit(plan_id, section));
drop policy if exists "planner editors delete cues" on public.planner_cues;
create policy "planner editors delete cues" on public.planner_cues
  for delete using (public.planner_can_edit(plan_id, section));

-- ---- Show day: live state and timing ----

-- The server's clock (screens line their timers up with it).
create or replace function public.planner_clock() returns timestamptz
  language sql stable
as $$ select now() $$;

create table if not exists public.planner_live (
  plan_id uuid primary key references public.planner_plans on delete cascade,
  run_id uuid not null default gen_random_uuid(),
  mode text not null default 'show' check (mode in ('show', 'rehearsal')),
  state text not null default 'off' check (state in ('off', 'running', 'paused', 'ended')),
  cue_id uuid,
  cue_started_at timestamptz,
  paused_at timestamptz,
  show_started_at timestamptz,
  message text not null default '' check (char_length(message) <= 200),
  message_on boolean not null default false,
  message_flash boolean not null default false,
  source text not null default 'planner' check (source in ('planner', 'lumora')),
  updated_at timestamptz not null default now(),
  updated_by_name text not null default ''
);
alter table public.planner_live enable row level security;
drop policy if exists "planner members see the show" on public.planner_live;
create policy "planner members see the show" on public.planner_live
  for select using (public.planner_role(plan_id) is not null);
revoke all on public.planner_live from anon, authenticated;
grant select on public.planner_live to authenticated;

-- How long each cue really ran, per run (show or rehearsal).
create table if not exists public.planner_live_log (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  run_id uuid not null,
  mode text not null default 'show' check (mode in ('show', 'rehearsal')),
  cue_id uuid not null,
  cue_title text not null default '',
  planned_sec integer,
  started_at timestamptz not null,
  ended_at timestamptz,
  paused_sec integer not null default 0
);
create index if not exists planner_live_log_plan on public.planner_live_log (plan_id, started_at);
alter table public.planner_live_log enable row level security;
drop policy if exists "planner members see timings" on public.planner_live_log;
create policy "planner members see timings" on public.planner_live_log
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner editors clear timings" on public.planner_live_log;
create policy "planner editors clear timings" on public.planner_live_log
  for delete using (public.planner_role(plan_id) in ('owner', 'editor'));
revoke all on public.planner_live_log from anon, authenticated;
grant select, delete on public.planner_live_log to authenticated;

-- Call the show. Actions:
--   'start' / 'rehearse'  begin a show (or a rehearsal) at p_cue
--   'go'                  put p_cue on now (the cue before is logged as done)
--   'pause' / 'resume'    stop and restart the clock of the cue on now
--   'adjust'              give the cue on now p_seconds more (or fewer, negative)
--   'end'                 the show is over
--   'reset'               back to not running
--   'message'             show p_message on the stage timer (p_flash: flashing)
--   'clear'               take the message off
-- p_source: 'lumora' when Lumora calls it (it runs the plan's cues).
create or replace function public.planner_live_go(p uuid, p_action text, p_cue uuid default null, p_seconds integer default 0,
  p_message text default null, p_flash boolean default false, p_source text default 'planner') returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  cur public.planner_live;
  t timestamptz := now();
  who text := left(coalesce(public.my_display_name(), ''), 80);
  c public.planner_cues;
begin
  if public.planner_role(p) not in ('owner', 'editor') or public.planner_role(p) is null then
    raise exception 'Only the owner and editors of the plan can call the show.';
  end if;
  if p_action not in ('start', 'rehearse', 'go', 'pause', 'resume', 'adjust', 'end', 'reset', 'message', 'clear') then
    raise exception 'Unknown show action.';
  end if;
  perform public.rate_check('planner_live', 1200, interval '1 hour');
  insert into public.planner_live (plan_id) values (p) on conflict (plan_id) do nothing;
  select * into cur from public.planner_live where plan_id = p for update;

  if p_action in ('start', 'rehearse', 'go') then
    if p_cue is null then
      raise exception 'Which cue?';
    end if;
    select * into c from public.planner_cues where id = p_cue and plan_id = p;
    if c.id is null then
      raise exception 'That cue is not on this plan.';
    end if;
  end if;

  -- The cue on now ends (for 'go', 'end', 'reset', and starting again).
  if p_action in ('start', 'rehearse', 'go', 'end', 'reset') and cur.state in ('running', 'paused') and cur.cue_id is not null then
    update public.planner_live_log set ended_at = coalesce(cur.paused_at, t)
    where plan_id = p and run_id = cur.run_id and cue_id = cur.cue_id and ended_at is null;
  end if;

  if p_action in ('start', 'rehearse') then
    update public.planner_live set run_id = gen_random_uuid(), mode = case p_action when 'start' then 'show' else 'rehearsal' end,
      state = 'running', cue_id = c.id, cue_started_at = t, paused_at = null, show_started_at = t,
      source = case when p_source = 'lumora' then 'lumora' else 'planner' end
    where plan_id = p returning * into cur;
    -- Keep the timings of the last 20 runs.
    delete from public.planner_live_log l where l.plan_id = p and l.run_id not in (
      select r.run_id from (select run_id, max(started_at) m from public.planner_live_log where plan_id = p group by run_id) r
      order by r.m desc limit 19);
  elsif p_action = 'go' then
    if cur.state not in ('running', 'paused') then
      update public.planner_live set run_id = gen_random_uuid(), mode = 'show', show_started_at = t where plan_id = p returning * into cur;
    end if;
    update public.planner_live set state = 'running', cue_id = c.id, cue_started_at = t, paused_at = null,
      source = case when p_source = 'lumora' then 'lumora' else source end
    where plan_id = p returning * into cur;
  elsif p_action = 'pause' then
    if cur.state = 'running' then
      update public.planner_live set state = 'paused', paused_at = t where plan_id = p returning * into cur;
    end if;
  elsif p_action = 'resume' then
    if cur.state = 'paused' then
      update public.planner_live_log set paused_sec = paused_sec + extract(epoch from t - cur.paused_at)::integer
      where plan_id = p and run_id = cur.run_id and cue_id = cur.cue_id and ended_at is null;
      update public.planner_live set state = 'running', cue_started_at = cue_started_at + (t - paused_at), paused_at = null
      where plan_id = p returning * into cur;
    end if;
  elsif p_action = 'adjust' then
    if cur.state in ('running', 'paused') and p_seconds between -3600 and 3600 then
      update public.planner_live set cue_started_at = cue_started_at + make_interval(secs => p_seconds) where plan_id = p returning * into cur;
    end if;
  elsif p_action = 'end' then
    update public.planner_live set state = 'ended', paused_at = null where plan_id = p returning * into cur;
  elsif p_action = 'reset' then
    update public.planner_live set state = 'off', cue_id = null, cue_started_at = null, paused_at = null, show_started_at = null,
      message = '', message_on = false, message_flash = false
    where plan_id = p returning * into cur;
  elsif p_action = 'message' then
    update public.planner_live set message = left(trim(coalesce(p_message, '')), 200), message_on = trim(coalesce(p_message, '')) <> '',
      message_flash = coalesce(p_flash, false)
    where plan_id = p returning * into cur;
  elsif p_action = 'clear' then
    update public.planner_live set message_on = false, message_flash = false where plan_id = p returning * into cur;
  end if;

  if p_action in ('start', 'rehearse', 'go') then
    insert into public.planner_live_log (plan_id, run_id, mode, cue_id, cue_title, planned_sec, started_at)
    values (p, cur.run_id, cur.mode, c.id, left(c.title, 120), c.duration_sec, t);
  end if;

  update public.planner_live set updated_at = t, updated_by_name = who where plan_id = p returning * into cur;
  return to_jsonb(cur) || jsonb_build_object('server_now', t);
end
$$;

-- ---- Lists: crew, contacts, tasks, gear, budget ----

create table if not exists public.planner_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  kind text not null check (kind in ('crew', 'contact', 'task', 'gear', 'budget')),
  cue_id uuid references public.planner_cues on delete cascade,
  sort double precision not null default 0,
  title text not null default '' check (char_length(title) <= 120),
  role text not null default '' check (char_length(role) <= 80),
  person text not null default '' check (char_length(person) <= 80),
  person_id uuid references auth.users on delete set null,
  phone text not null default '' check (char_length(phone) <= 40),
  email text not null default '' check (char_length(email) <= 120),
  call_time text not null default '' check (char_length(call_time) <= 8),
  day date,
  qty integer check (qty is null or qty between 0 and 100000),
  amount numeric(12, 2) check (amount is null or abs(amount) < 1e10),
  actual numeric(12, 2) check (actual is null or abs(actual) < 1e10),
  status text not null default '' check (char_length(status) <= 30),
  done boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by_name text not null default ''
);
create index if not exists planner_items_plan on public.planner_items (plan_id, kind, sort);
alter table public.planner_items enable row level security;

-- Everyone on the plan sees the lists; the budget only the owner and editors.
drop policy if exists "planner members see lists" on public.planner_items;
create policy "planner members see lists" on public.planner_items
  for select using (case when kind = 'budget' then public.planner_role(plan_id) in ('owner', 'editor')
                         else public.planner_role(plan_id) is not null end);
drop policy if exists "planner editors add to lists" on public.planner_items;
create policy "planner editors add to lists" on public.planner_items
  for insert with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors change lists" on public.planner_items;
create policy "planner editors change lists" on public.planner_items
  for update using (public.planner_role(plan_id) in ('owner', 'editor')) with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors delete from lists" on public.planner_items;
create policy "planner editors delete from lists" on public.planner_items
  for delete using (public.planner_role(plan_id) in ('owner', 'editor'));
revoke all on public.planner_items from anon, authenticated;
grant select, insert, update, delete on public.planner_items to authenticated;

-- An item stays on its plan (and its cue on that plan), is stamped, and a plan
-- has at most 2000; giving a task to someone tells them.
create or replace function public.planner_item_stamp() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.planner_items where plan_id = new.plan_id) >= 2000 then
      raise exception 'A plan can have at most 2000 list items.';
    end if;
    perform public.rate_check('planner_item', 1500, interval '1 hour');
  elsif new.plan_id <> old.plan_id or new.kind <> old.kind then
    raise exception 'A list item cannot be moved to another plan or list.';
  end if;
  if new.cue_id is not null and not exists (select 1 from public.planner_cues where id = new.cue_id and plan_id = new.plan_id) then
    raise exception 'That cue is not on this plan.';
  end if;
  if new.person_id is not null and new.person_id is distinct from (case when tg_op = 'UPDATE' then old.person_id end) then
    if not (exists (select 1 from public.planner_plans where id = new.plan_id and owner = new.person_id)
            or exists (select 1 from public.planner_members where plan_id = new.plan_id and user_id = new.person_id)) then
      raise exception 'That person is not on this plan.';
    end if;
    if new.kind = 'task' and new.person_id <> auth.uid() then
      insert into public.planner_notifications (user_id, plan_id, kind, cue_id, from_name, body)
      values (new.person_id, new.plan_id, 'task', new.cue_id, left(coalesce(public.my_display_name(), ''), 80), left(new.title, 300));
    end if;
  end if;
  new.updated_at := now();
  new.updated_by_name := left(coalesce(public.my_display_name(), ''), 80);
  return new;
end
$$;

-- A task's person (or the owner or an editor) ticks it off.
create or replace function public.planner_task_done(p_id uuid, p_done boolean) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  it public.planner_items;
begin
  select * into it from public.planner_items where id = p_id and kind = 'task';
  if it.id is null or public.planner_role(it.plan_id) is null then
    raise exception 'That task is not on a plan you are on.';
  end if;
  if not (public.planner_role(it.plan_id) in ('owner', 'editor') or it.person_id = auth.uid()) then
    raise exception 'Only the person the task is for, or an editor, can tick it off.';
  end if;
  update public.planner_items set done = coalesce(p_done, false) where id = p_id;
end
$$;

-- ---- Notifications ----

create table if not exists public.planner_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_id uuid not null references public.planner_plans on delete cascade,
  kind text not null check (kind in ('mention', 'task')),
  cue_id uuid,
  from_name text not null default '',
  body text not null default '' check (char_length(body) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists planner_notifications_user on public.planner_notifications (user_id, created_at desc);
alter table public.planner_notifications enable row level security;
drop policy if exists "people see their notifications" on public.planner_notifications;
create policy "people see their notifications" on public.planner_notifications
  for select using (user_id = auth.uid());
drop policy if exists "people mark their notifications read" on public.planner_notifications;
create policy "people mark their notifications read" on public.planner_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "people clear their notifications" on public.planner_notifications;
create policy "people clear their notifications" on public.planner_notifications
  for delete using (user_id = auth.uid());
revoke all on public.planner_notifications from anon, authenticated;
grant select, delete on public.planner_notifications to authenticated;
grant update (read_at) on public.planner_notifications to authenticated;

drop trigger if exists planner_item_stamp on public.planner_items;
create trigger planner_item_stamp before insert or update on public.planner_items
  for each row execute function public.planner_item_stamp();

-- "@name" in a comment or chat message: the people named (on the plan, not
-- the writer) are told. At most 30 a minute from one account.
create or replace function public.planner_mention() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  r jsonb := to_jsonb(new);
  body text := coalesce(r ->> 'text', r ->> 'body', '');
  cue uuid := (r ->> 'cue_id')::uuid;
begin
  if cardinality(new.mentions) = 0 then
    return null;
  end if;
  perform public.rate_check('planner_mention', 30, interval '1 minute');
  insert into public.planner_notifications (user_id, plan_id, kind, cue_id, from_name, body)
  select distinct u, new.plan_id, 'mention', cue, left(coalesce(public.my_display_name(), ''), 80), left(body, 300)
  from unnest(new.mentions) u
  where u <> auth.uid()
    and (exists (select 1 from public.planner_plans where id = new.plan_id and owner = u)
         or exists (select 1 from public.planner_members where plan_id = new.plan_id and user_id = u));
  return null;
end
$$;
drop trigger if exists planner_mention on public.planner_comments;
create trigger planner_mention after insert on public.planner_comments
  for each row execute function public.planner_mention();
drop trigger if exists planner_mention on public.planner_messages;
create trigger planner_mention after insert on public.planner_messages
  for each row execute function public.planner_mention();

-- ---- Files ----

create table if not exists public.planner_files (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  cue_id uuid references public.planner_cues on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  size bigint not null check (size between 0 and 26214400),
  mime text not null default '' check (char_length(mime) <= 120),
  path text not null unique check (char_length(path) <= 300),
  created_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid() references auth.users on delete set null,
  uploaded_by_name text not null default ''
);
create index if not exists planner_files_plan on public.planner_files (plan_id, created_at);
alter table public.planner_files enable row level security;
drop policy if exists "planner members see files" on public.planner_files;
create policy "planner members see files" on public.planner_files
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner editors add files" on public.planner_files;
create policy "planner editors add files" on public.planner_files
  for insert with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors change files" on public.planner_files;
create policy "planner editors change files" on public.planner_files
  for update using (public.planner_role(plan_id) in ('owner', 'editor')) with check (public.planner_role(plan_id) in ('owner', 'editor'));
drop policy if exists "planner editors delete files" on public.planner_files;
create policy "planner editors delete files" on public.planner_files
  for delete using (public.planner_role(plan_id) in ('owner', 'editor'));
revoke all on public.planner_files from anon, authenticated;
grant select, insert, delete on public.planner_files to authenticated;
grant update (cue_id, name) on public.planner_files to authenticated;

-- A file's place in storage is "<plan id>/<file id>/<name>"; at most 200 files
-- and 250 MB a plan.
create or replace function public.planner_file_stamp() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.planner_files where plan_id = new.plan_id) >= 200 then
      raise exception 'A plan can have at most 200 files.';
    end if;
    if (select coalesce(sum(size), 0) from public.planner_files where plan_id = new.plan_id) + new.size > 262144000 then
      raise exception 'This plan''s files are full (250 MB). Delete some first.';
    end if;
    perform public.rate_check('planner_file', 200, interval '1 hour');
    if new.path !~ ('^' || new.plan_id::text || '/' || new.id::text || '/[^/]{1,200}$') then
      raise exception 'A file must be stored under its plan.';
    end if;
    new.created_at := now();
    new.uploaded_by := auth.uid();
    new.uploaded_by_name := left(coalesce(public.my_display_name(), ''), 80);
  elsif new.plan_id <> old.plan_id or new.path <> old.path or new.size <> old.size then
    raise exception 'A file cannot be moved to another plan.';
  end if;
  if new.cue_id is not null and not exists (select 1 from public.planner_cues where id = new.cue_id and plan_id = new.plan_id) then
    raise exception 'That cue is not on this plan.';
  end if;
  return new;
end
$$;
drop trigger if exists planner_file_stamp on public.planner_files;
create trigger planner_file_stamp before insert or update on public.planner_files
  for each row execute function public.planner_file_stamp();

-- The asker's role on the plan a stored file belongs to (from its path), or null.
create or replace function public.planner_file_role(object_name text) returns text
  language sql security definer stable set search_path = public
as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then public.planner_role(split_part(object_name, '/', 1)::uuid) end
$$;

-- Storage: a private bucket; only people on the plan read its files; only the
-- owner and editors store one, and only after its row above was added.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('planner-files', 'planner-files', false, 26214400)
    on conflict (id) do update set public = false, file_size_limit = 26214400;
    execute 'drop policy if exists "planner members read files" on storage.objects';
    execute $p$create policy "planner members read files" on storage.objects
      for select to authenticated using (bucket_id = 'planner-files' and public.planner_file_role(name) is not null)$p$;
    execute 'drop policy if exists "planner editors store files" on storage.objects';
    execute $p$create policy "planner editors store files" on storage.objects
      for insert to authenticated with check (bucket_id = 'planner-files' and public.planner_file_role(name) in ('owner', 'editor')
        and exists (select 1 from public.planner_files f where f.path = storage.objects.name))$p$;
    execute 'drop policy if exists "planner editors delete stored files" on storage.objects';
    execute $p$create policy "planner editors delete stored files" on storage.objects
      for delete to authenticated using (bucket_id = 'planner-files' and public.planner_file_role(name) in ('owner', 'editor'))$p$;
  else
    raise notice 'No Supabase Storage here: the planner-files bucket was not made.';
  end if;
end
$$;

-- ---- Versions ----

create table if not exists public.planner_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planner_plans on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  auto boolean not null default false,
  cue_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by_name text not null default '',
  snapshot jsonb not null
);
create index if not exists planner_versions_plan on public.planner_versions (plan_id, created_at desc);
alter table public.planner_versions enable row level security;
drop policy if exists "planner members see versions" on public.planner_versions;
create policy "planner members see versions" on public.planner_versions
  for select using (public.planner_role(plan_id) is not null);
drop policy if exists "planner owner deletes versions" on public.planner_versions;
create policy "planner owner deletes versions" on public.planner_versions
  for delete using (public.planner_role(plan_id) = 'owner');
revoke all on public.planner_versions from anon, authenticated;
grant select, delete on public.planner_versions to authenticated;

-- The plan as it is now: its details, cues and schedule.
create or replace function public.planner_snapshot(p uuid) returns jsonb
  language sql security definer stable set search_path = public
as $$
  select jsonb_build_object(
    'plan', (select jsonb_build_object('name', name, 'event_date', event_date, 'venue', venue, 'start_time', start_time, 'notes', notes,
                                       'time_zone', time_zone, 'end_by', end_by, 'columns', columns)
             from public.planner_plans where id = p),
    'cues', coalesce((select jsonb_agg(to_jsonb(c) - 'updated_by' - 'updated_at' - 'updated_by_name' order by c.position)
                      from public.planner_cues c where c.plan_id = p), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(to_jsonb(s) - 'updated_at' - 'updated_by_name' order by s.day, s.starts, s.sort)
                          from public.planner_schedule s where s.plan_id = p), '[]'::jsonb))
$$;
revoke execute on function public.planner_snapshot(uuid) from public, anon, authenticated;

-- Keep a version (p_auto: saved by the Planner, not by hand). 100 a plan at
-- most: the oldest automatic ones go first.
create or replace function public.planner_keep_version(p uuid, p_name text, p_auto boolean) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  v uuid;
  snap jsonb := public.planner_snapshot(p);
begin
  insert into public.planner_versions (plan_id, name, auto, cue_count, created_by_name, snapshot)
  values (p, left(trim(coalesce(p_name, '')), 120), p_auto, jsonb_array_length(snap -> 'cues'),
          left(coalesce(public.my_display_name(), ''), 80), snap)
  returning id into v;
  delete from public.planner_versions where id in (
    select id from public.planner_versions where plan_id = p
    order by (not auto), created_at desc offset 100);
  return v;
end
$$;
revoke execute on function public.planner_keep_version(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.planner_save_version(p uuid, p_name text) returns uuid
  language plpgsql security definer set search_path = public
as $$
begin
  if public.planner_role(p) not in ('owner', 'editor') or public.planner_role(p) is null then
    raise exception 'Only the owner and editors can save a version.';
  end if;
  perform public.rate_check('planner_version', 60, interval '1 hour');
  return public.planner_keep_version(p, coalesce(nullif(trim(p_name), ''), 'Saved version'), false);
end
$$;

-- Before the first change after a quiet half hour, the plan as it was is kept
-- (so there is always a version from before each round of editing).
create or replace function public.planner_auto_version() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  p uuid := coalesce(case when tg_op = 'DELETE' then old.plan_id else new.plan_id end, old.plan_id);
begin
  if current_setting('lumora.restoring', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- (Not while the plan itself is being deleted.)
  if exists (select 1 from public.planner_plans where id = p)
     and exists (select 1 from public.planner_cues where plan_id = p)
     and not exists (select 1 from public.planner_versions where plan_id = p and created_at > now() - interval '30 minutes')
     and not exists (select 1 from public.planner_cues where plan_id = p and updated_at > now() - interval '30 minutes') then
    perform public.planner_keep_version(p, 'Before changes', true);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
drop trigger if exists planner_auto_version on public.planner_cues;
create trigger planner_auto_version before insert or update or delete on public.planner_cues
  for each row execute function public.planner_auto_version();

-- Put a version back: the plan's details, cues and schedule as they were
-- (comments stay on cues that are still there). The plan as it is now is kept
-- as a version first, so a restore can be undone.
create or replace function public.planner_restore_version(v uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  ver public.planner_versions;
  s jsonb;
begin
  select * into ver from public.planner_versions where id = v;
  if ver.id is null or public.planner_role(ver.plan_id) is null then
    raise exception 'That version is not on a plan you are on.';
  end if;
  if public.planner_role(ver.plan_id) not in ('owner', 'editor') then
    raise exception 'Only the owner and editors can restore a version.';
  end if;
  if public.planner_role(ver.plan_id) <> 'owner' and exists (select 1 from public.planner_sections where plan_id = ver.plan_id) then
    raise exception 'This plan has locked sections: only its owner can restore a version.';
  end if;
  perform public.rate_check('planner_version', 60, interval '1 hour');
  perform public.planner_keep_version(ver.plan_id, 'Before restoring “' || coalesce(nullif(ver.name, ''), 'a version') || '”', true);
  perform set_config('lumora.restoring', 'on', true);
  s := ver.snapshot;
  update public.planner_plans set name = coalesce(s #>> '{plan,name}', name), event_date = (s #>> '{plan,event_date}')::date,
    venue = coalesce(s #>> '{plan,venue}', ''), start_time = coalesce(s #>> '{plan,start_time}', ''), notes = coalesce(s #>> '{plan,notes}', ''),
    time_zone = coalesce(s #>> '{plan,time_zone}', ''), end_by = coalesce(s #>> '{plan,end_by}', ''),
    columns = coalesce(s #> '{plan,columns}', '[]'::jsonb)
  where id = ver.plan_id;
  delete from public.planner_cues where plan_id = ver.plan_id
    and id not in (select (e ->> 'id')::uuid from jsonb_array_elements(s -> 'cues') e);
  insert into public.planner_cues (id, plan_id, position, section, title, segment, who, notes, start_time, duration_sec,
                                   input_hint, overlay_hint, transition_hint, script, color, skip, custom)
  select r.id, ver.plan_id, r.position, coalesce(r.section, ''), coalesce(r.title, ''), coalesce(r.segment, 'custom'), coalesce(r.who, ''),
    coalesce(r.notes, ''), coalesce(r.start_time, ''), r.duration_sec, coalesce(r.input_hint, ''), coalesce(r.overlay_hint, ''),
    coalesce(r.transition_hint, ''), coalesce(r.script, ''), coalesce(r.color, ''), coalesce(r.skip, false), coalesce(r.custom, '{}'::jsonb)
  from jsonb_populate_recordset(null::public.planner_cues, s -> 'cues') r
  on conflict (id) do update set position = excluded.position, section = excluded.section, title = excluded.title, segment = excluded.segment,
    who = excluded.who, notes = excluded.notes, start_time = excluded.start_time, duration_sec = excluded.duration_sec,
    input_hint = excluded.input_hint, overlay_hint = excluded.overlay_hint, transition_hint = excluded.transition_hint,
    script = excluded.script, color = excluded.color, skip = excluded.skip, custom = excluded.custom;
  delete from public.planner_schedule where plan_id = ver.plan_id
    and id not in (select (e ->> 'id')::uuid from jsonb_array_elements(s -> 'schedule') e);
  insert into public.planner_schedule (id, plan_id, day, starts, ends, title, location, who, notes, sort)
  select r.id, ver.plan_id, r.day, r.starts, r.ends, coalesce(r.title, ''), coalesce(r.location, ''), coalesce(r.who, ''), coalesce(r.notes, ''),
    coalesce(r.sort, 0)
  from jsonb_populate_recordset(null::public.planner_schedule, s -> 'schedule') r
  on conflict (id) do update set day = excluded.day, starts = excluded.starts, ends = excluded.ends, title = excluded.title,
    location = excluded.location, who = excluded.who, notes = excluded.notes, sort = excluded.sort;
  perform set_config('lumora.restoring', 'off', true);
end
$$;

-- ---- Templates and copies ----

-- A copy of a plan (or a template), owned by the asker: its details, cues,
-- schedule and lists (tasks not done; no files, comments, chat or people).
-- With a new date, schedule days and task due dates move with it.
create or replace function public.planner_copy_plan(src uuid, p_name text, p_template boolean default false, p_date date default null)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  old public.planner_plans;
  n uuid;
  shift integer := 0;
begin
  if public.planner_role(src) is null then
    raise exception 'That plan is not shared with you.';
  end if;
  if not public.can_make_plans() then
    raise exception 'Your account can''t make plans.';
  end if;
  perform public.rate_check('planner_copy', 30, interval '1 hour');
  select * into old from public.planner_plans where id = src;
  if p_date is not null and old.event_date is not null then
    shift := p_date - old.event_date;
  end if;
  insert into public.planner_plans (owner, name, event_date, venue, start_time, notes, time_zone, end_by, columns, is_template)
  values (auth.uid(), left(coalesce(nullif(trim(p_name), ''), old.name), 120), coalesce(p_date, case when p_template then null else old.event_date end),
          old.venue, old.start_time, old.notes, old.time_zone, old.end_by, old.columns, coalesce(p_template, false))
  returning id into n;
  -- New cue ids (made from the old id and the new plan's), the same order; tasks on a cue follow it.
  perform set_config('lumora.restoring', 'on', true);
  insert into public.planner_cues (id, plan_id, position, section, title, segment, who, notes, start_time, duration_sec,
                                   input_hint, overlay_hint, transition_hint, script, color, skip, custom)
  select md5(c.id::text || n::text)::uuid, n, c.position, c.section, c.title, c.segment, c.who, c.notes, c.start_time, c.duration_sec,
    c.input_hint, c.overlay_hint, c.transition_hint, c.script, c.color, c.skip, c.custom
  from public.planner_cues c where c.plan_id = src;
  perform set_config('lumora.restoring', 'off', true);
  insert into public.planner_schedule (plan_id, day, starts, ends, title, location, who, notes, sort)
  select n, case when s.day is null then null when p_template then null else s.day + shift end, s.starts, s.ends, s.title, s.location, s.who, s.notes, s.sort
  from public.planner_schedule s where s.plan_id = src;
  insert into public.planner_items (plan_id, kind, cue_id, sort, title, role, person, phone, email, call_time, day, qty, amount, actual, status, done, notes)
  select n, i.kind, case when i.cue_id is not null then md5(i.cue_id::text || n::text)::uuid end, i.sort, i.title, i.role, i.person, i.phone, i.email, i.call_time,
    case when i.day is null or p_template then null else i.day + shift end, i.qty, i.amount,
    case when i.kind = 'budget' then null else i.actual end, case when i.kind = 'gear' then '' else i.status end, false, i.notes
  from public.planner_items i
  where i.plan_id = src and (i.kind <> 'budget' or public.planner_role(src) in ('owner', 'editor'));
  return n;
end
$$;

-- ---- Public link ----

-- The owner turns the public link on (a new, unguessable link each time) or
-- off, and chooses what it shows.
create or replace function public.planner_share(p uuid, p_on boolean, p_scope text default 'agenda') returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  t uuid;
begin
  if public.planner_role(p) is distinct from 'owner' then
    raise exception 'Only the owner of the plan can make a public link.';
  end if;
  if p_on and not public.feature_on('planner_sharing') then
    raise exception 'Sharing plans is turned off by the Lumora team right now.';
  end if;
  if p_scope not in ('agenda', 'crew') then
    raise exception 'The link shows the agenda or the crew view.';
  end if;
  update public.planner_plans set share_token = case when p_on then coalesce(share_token, gen_random_uuid()) end, share_scope = p_scope
  where id = p returning share_token into t;
  return t;
end
$$;

-- What the public link shows (null when the link is off, or the Planner or
-- sharing is paused). No phone numbers, emails, budget, files, comments or chat.
create or replace function public.planner_public(token uuid) returns jsonb
  language sql security definer stable set search_path = public
as $$
  select case when p.id is null or not public.feature_on('planner') or not public.feature_on('planner_sharing') then null else
    jsonb_build_object(
      'scope', p.share_scope,
      'server_now', now(),
      'plan', jsonb_build_object('id', p.id, 'name', p.name, 'event_date', p.event_date, 'venue', p.venue, 'start_time', p.start_time,
                                 'time_zone', p.time_zone, 'end_by', p.end_by,
                                 'notes', case when p.share_scope = 'crew' then p.notes else '' end,
                                 'columns', case when p.share_scope = 'crew' then p.columns else '[]'::jsonb end),
      'cues', coalesce((select jsonb_agg(case when p.share_scope = 'crew'
                          then jsonb_build_object('id', c.id, 'position', c.position, 'section', c.section, 'title', c.title, 'segment', c.segment,
                                                  'who', c.who, 'notes', c.notes, 'start_time', c.start_time, 'duration_sec', c.duration_sec,
                                                  'input_hint', c.input_hint, 'overlay_hint', c.overlay_hint, 'transition_hint', c.transition_hint,
                                                  'script', c.script, 'color', c.color, 'skip', c.skip, 'custom', c.custom)
                          else jsonb_build_object('id', c.id, 'position', c.position, 'section', c.section, 'title', c.title, 'segment', c.segment,
                                                  'start_time', c.start_time, 'duration_sec', c.duration_sec, 'color', c.color, 'skip', c.skip) end
                          order by c.position)
                        from public.planner_cues c where c.plan_id = p.id), '[]'::jsonb),
      'schedule', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'starts', s.starts, 'ends', s.ends, 'title', s.title,
                                                                'location', s.location, 'who', s.who,
                                                                'notes', case when p.share_scope = 'crew' then s.notes else '' end)
                                             order by s.day, s.starts, s.sort)
                            from public.planner_schedule s where s.plan_id = p.id), '[]'::jsonb),
      'crew', case when p.share_scope = 'crew' then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'role', i.role,
                                                                                'call_time', i.call_time, 'day', i.day) order by i.sort)
                                                               from public.planner_items i where i.plan_id = p.id and i.kind = 'crew'), '[]'::jsonb)
                   else '[]'::jsonb end,
      'live', (select to_jsonb(l) - 'updated_by_name' from public.planner_live l where l.plan_id = p.id))
  end
  from (select 1) one left join public.planner_plans p on p.share_token = token
$$;

-- ---- Calendar feeds (iCal) ----

-- The domain makes PostgREST answer as text/calendar (calendar apps
-- subscribe to it: .../rest/v1/rpc/planner_ical?token=...&apikey=...).
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'text/calendar') then
    create domain public."text/calendar" as text;
  end if;
end
$$;

create or replace function public.planner_ics_text(s text) returns text
  language sql immutable
as $$ select replace(replace(replace(replace(coalesce(s, ''), E'\\', E'\\\\'), ';', E'\\;'), ',', E'\\,'), E'\n', E'\\n') $$;

-- One plan's calendar entries: the event itself (start to planned end) and its schedule blocks.
create or replace function public.planner_ics_events(p uuid) returns text
  language sql security definer stable set search_path = public
as $$
  with pl as (select * from public.planner_plans where id = p),
  total as (select coalesce(sum(duration_sec) filter (where not skip), 0) secs from public.planner_cues where plan_id = p),
  stamp as (select to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"') z)
  select coalesce((
    select string_agg(e, '')
    from (
      select 'BEGIN:VEVENT' || E'\r\n' || 'UID:plan-' || pl.id || '@lumora-planner' || E'\r\n' || 'DTSTAMP:' || stamp.z || E'\r\n' ||
        case when pl.start_time ~ '^\d{2}:\d{2}' then
          'DTSTART' || case when pl.time_zone <> '' then ';TZID=' || pl.time_zone else '' end || ':' ||
            to_char(pl.event_date, 'YYYYMMDD') || 'T' || replace(left(pl.start_time, 5), ':', '') || '00' || E'\r\n' ||
          'DURATION:PT' || greatest(total.secs / 60, 30) || 'M' || E'\r\n'
        else 'DTSTART;VALUE=DATE:' || to_char(pl.event_date, 'YYYYMMDD') || E'\r\n' end ||
        'SUMMARY:' || public.planner_ics_text(coalesce(nullif(pl.name, ''), 'Untitled plan')) || E'\r\n' ||
        case when pl.venue <> '' then 'LOCATION:' || public.planner_ics_text(pl.venue) || E'\r\n' else '' end ||
        'END:VEVENT' || E'\r\n' e
      from pl, total, stamp where pl.event_date is not null
      union all
      select 'BEGIN:VEVENT' || E'\r\n' || 'UID:block-' || s.id || '@lumora-planner' || E'\r\n' || 'DTSTAMP:' || stamp.z || E'\r\n' ||
        case when s.starts is not null then
          'DTSTART' || case when pl.time_zone <> '' then ';TZID=' || pl.time_zone else '' end || ':' ||
            to_char(s.day, 'YYYYMMDD') || 'T' || to_char(s.starts, 'HH24MISS') || E'\r\n' ||
          case when s.ends is not null and s.ends > s.starts then
            'DTEND' || case when pl.time_zone <> '' then ';TZID=' || pl.time_zone else '' end || ':' ||
              to_char(s.day, 'YYYYMMDD') || 'T' || to_char(s.ends, 'HH24MISS') || E'\r\n' else '' end
        else 'DTSTART;VALUE=DATE:' || to_char(s.day, 'YYYYMMDD') || E'\r\n' end ||
        'SUMMARY:' || public.planner_ics_text(coalesce(nullif(s.title, ''), 'Untitled block') || ' · ' || coalesce(nullif(pl.name, ''), 'Untitled plan')) || E'\r\n' ||
        case when s.location <> '' then 'LOCATION:' || public.planner_ics_text(s.location) || E'\r\n' else '' end ||
        case when s.who <> '' then 'DESCRIPTION:' || public.planner_ics_text('Who: ' || s.who) || E'\r\n' else '' end ||
        'END:VEVENT' || E'\r\n'
      from public.planner_schedule s, pl, stamp where s.plan_id = p and s.day is not null
    ) x), '')
$$;
revoke execute on function public.planner_ics_events(uuid) from public, anon, authenticated;

create or replace function public.planner_ics_wrap(name text, body text) returns text
  language sql immutable
as $$
  select 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//Lumora//Planner//EN' || E'\r\n' ||
    'CALSCALE:GREGORIAN' || E'\r\n' || 'X-WR-CALNAME:' || public.planner_ics_text(name) || E'\r\n' || body || 'END:VCALENDAR' || E'\r\n'
$$;

-- A plan's feed, by its public link.
create or replace function public.planner_ical(token uuid) returns public."text/calendar"
  language sql security definer stable set search_path = public
as $$
  select public.planner_ics_wrap(coalesce(nullif(p.name, ''), 'Lumora Planner'),
    case when p.id is not null and public.feature_on('planner') and public.feature_on('planner_sharing') then public.planner_ics_events(p.id) else '' end)
  from (select 1) one left join public.planner_plans p on p.share_token = token
$$;

-- Your own feed of every plan you are on (not templates), by a private link.
create table if not exists public.planner_feeds (
  user_id uuid primary key references auth.users on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.planner_feeds enable row level security;
drop policy if exists "people see their feed" on public.planner_feeds;
create policy "people see their feed" on public.planner_feeds for select using (user_id = auth.uid());
revoke all on public.planner_feeds from anon, authenticated;
grant select on public.planner_feeds to authenticated;

-- Your feed's link token (made the first time; p_new: a new one, so the old link stops working).
create or replace function public.planner_my_feed(p_new boolean default false) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  t uuid;
begin
  if not public.account_ok() or not public.feature_on('planner') then
    raise exception 'Please sign in again.';
  end if;
  insert into public.planner_feeds (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  if p_new then
    update public.planner_feeds set token = gen_random_uuid(), created_at = now() where user_id = auth.uid();
  end if;
  select token into t from public.planner_feeds where user_id = auth.uid();
  return t;
end
$$;

create or replace function public.planner_ical_me(token uuid) returns public."text/calendar"
  language sql security definer stable set search_path = public
as $$
  select public.planner_ics_wrap('Lumora Planner', coalesce((
    select string_agg(public.planner_ics_events(p.id), '' order by p.event_date)
    from public.planner_feeds f
    join public.profiles pr on pr.id = f.user_id and not pr.blocked
    join public.planner_plans p on not p.is_template and (p.owner = f.user_id or exists
      (select 1 from public.planner_members m where m.plan_id = p.id and m.user_id = f.user_id))
    where f.token = planner_ical_me.token and public.feature_on('planner')), ''))
$$;

-- ---- Who may call what ----

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.planner_can_edit(uuid, text)',
    'public.planner_live_go(uuid, text, uuid, integer, text, boolean, text)',
    'public.planner_task_done(uuid, boolean)',
    'public.planner_save_version(uuid, text)',
    'public.planner_restore_version(uuid)',
    'public.planner_copy_plan(uuid, text, boolean, date)',
    'public.planner_share(uuid, boolean, text)',
    'public.planner_my_feed(boolean)',
    'public.planner_file_role(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Without signing in, too (the public link, calendar feeds, the clock).
  foreach f in array array['public.planner_public(uuid)', 'public.planner_ical(uuid)', 'public.planner_ical_me(uuid)', 'public.planner_clock()'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  -- Only for use inside the Planner's own functions and triggers.
  foreach f in array array['public.planner_item_stamp()', 'public.planner_mention()', 'public.planner_file_stamp()',
                           'public.planner_auto_version()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

-- Live updates.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['planner_live', 'planner_items', 'planner_files', 'planner_notifications', 'planner_sections'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
