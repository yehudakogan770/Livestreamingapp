-- Lumora update 4: choose which apps each account may use (Lumora, Lumora Studio, or both).
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it only adds what is not there yet, and never
--   changes the apps you have already chosen for someone).
--   It needs setup.sql (and update-2-editor-collab.sql) to have been run first.
--   (Already included in setup.sql for new projects.)
--
-- WHAT IT DOES
--   One account works for both apps, and the Lumora team chooses which ones:
--   Lumora → Settings → People and approvals → tick "Lumora" and/or "Studio".
--   - Accounts that already exist keep BOTH apps (nothing changes for them).
--   - New accounts start with NEITHER app; they still wait for approval, and
--     the team ticks at least one app when approving them.
--   - The very first account (the Lumora team's) gets both, as before.
--   - The Lumora team (is_admin) can always use both apps.
--   - Nobody can use either app until they are approved (unchanged).
--
-- WHAT IT ADDS
--   Columns:   profiles.lumora, profiles.studio (true: may use that app)
--   Function:  can_use_studio (approved, not blocked, and Studio turned on)
--   Changes:   new_profile (new accounts start with no apps), and Lumora
--              Studio's team projects now need Studio access (editor_role,
--              share_editor_project, my_editor_projects,
--              invite_to_editor_project). Problem reports are unchanged.

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
