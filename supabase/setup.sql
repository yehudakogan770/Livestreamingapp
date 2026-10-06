-- Lumora sign-in: run this once in your Supabase project
-- (Supabase → SQL Editor → New query → paste all of this → Run).
--
-- It also sets up Lumora Studio's team projects (at the end; the same as
-- update-2-editor-collab.sql). Afterwards, run update-3-reports.sql too
-- (error reports and "Report a problem").
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
