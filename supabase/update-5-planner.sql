-- Lumora update 5: Lumora Planner (the team's shared run of show / cue sheet).
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it only adds what is not there yet, and replaces
--   its own functions and rules with the same ones).
--   It needs setup.sql and update-4-app-access.sql to have been run first
--   (the profiles table and its "lumora" column). If update 4 is missing it
--   stops at the first line and says so; nothing is changed.
--   (Already included in setup.sql for new projects.)
--
-- WHAT IT DOES
--   The web Planner (https://yehudakogan770.github.io/Livestreamingapp/planner/)
--   and Lumora's Run of show → "Load from Planner…" use these tables. A plan is
--   one event (name, date, venue, start time, notes) and its ordered cues; the
--   team edits it together before the event and Lumora loads it as cues.
--   - Who can use the Planner: approved accounts (not blocked) that may use
--     Lumora (the "Lumora" tick in People and approvals), and the Lumora team.
--   - Anyone who can use it can make plans; the person who makes a plan owns it.
--   - The owner shares a plan by email: editor (can change it) or viewer
--     (can read it, print it, comment, and load it into Lumora).
--
-- WHAT IT ADDS
--   Tables:    planner_plans, planner_members, planner_cues, planner_comments
--   Functions: can_use_lumora, planner_role, my_planner_plans, planner_people,
--              invite_to_planner (and the triggers that stamp who changed what)
--   Realtime:  all four tables are added to the supabase_realtime publication,
--              so everyone on a plan sees edits and comments as they happen.
--
-- WHO MAY DO WHAT (row level security)
--   Only the owner and members see a plan, its cues, members and comments.
--   The owner and editors change the plan and its cues; viewers only read.
--   Everyone on a plan (viewers too) comments; only the author edits a
--   comment; the author or the owner deletes it. Only the owner invites,
--   changes roles, removes people or deletes the plan; anyone can leave.

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
