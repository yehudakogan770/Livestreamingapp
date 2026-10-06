-- Lumora update 6: security (two-step sign-in, tighter rules, limits) and
-- Planner teammates.
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it replaces its own functions and rules with the
--   same ones, and only adds what is not there yet).
--   It needs setup.sql and updates 1–5 to have been run first (if update 4 or
--   5 is missing it stops at the first check and says so; nothing is changed).
--   Update 3 (problem reports) is optional: its part here is skipped without it.
--   (Already included at the end of setup.sql for new projects.)
--
-- BEFORE YOU RUN IT (the Lumora team's own account)
--   After this, "People and approvals" (approving, blocking, choosing apps,
--   problem reports, resetting someone's two-step sign-in) works only for a
--   Lumora team account that signed in WITH two-step sign-in. Lumora asks you
--   to set it up the first time you open People and approvals (or do it in
--   Settings → My account → Two-step sign-in). You need an authenticator app
--   on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).
--   In the Supabase dashboard, check that TOTP is on: Authentication →
--   Sign In / Providers (or "Multi-Factor") → TOTP (App Authenticator) →
--   Enabled. See docs/security-checklist.md for every dashboard setting.
--
-- WHAT IT DOES
--   Two-step sign-in (an authenticator app's 6-digit code, Supabase MFA):
--   - An account that has turned it on must give the code before anything of
--     theirs can be read or changed (projects, plans, comments, reports): a
--     stolen password alone is not enough. Their own profile can still be read
--     with the password alone, so the app can ask for the code.
--   - Lumora team actions (approve, block, apps, problem reports, reset
--     someone's two-step sign-in) need a session signed in WITH the code.
--   - admin_reset_two_step(person): the Lumora team turns off someone's
--     two-step sign-in (they lost their phone). If Supabase refuses it, the
--     app says so; then do it in the dashboard (see docs/security-checklist.md).
--   Limits (so one account can't flood the free database):
--   - problem reports: approved accounts only; 30 an hour, 10 pictures a day;
--   - Studio projects: 30 new ones an hour, 300 in all, 20 MB each, 120 saves
--     kept an hour; Planner: 50 new plans an hour, 500 in all, 2000 cues a
--     plan; comments: 300 an hour; invitations: 50 a day for each plan owner.
--   Smaller fixes: a blocked account can no longer delete its old projects or
--   comments; names from sign-up are at most 80 characters; signed-out
--   visitors (anon) can't call any of Lumora's functions.
--   Planner teammates:
--   - Teammates invited to a plan only need a signed-in account (any
--     account, not approved, not set up for Lumora): they see, edit (if they
--     may) and comment on the plans they are on, and nothing else. They can't
--     make plans, and can't open Lumora or Lumora Studio.
--   - Making a plan still needs an approved account that may use Lumora.
--   - Inviting an email without an account keeps the invitation; it is added
--     when that person makes an account and signs in to the Planner (their
--     email confirmed). The owner sees waiting invitations and can cancel them.
--   - Accounts made from the Planner are marked planner_only, so People and
--     approvals keeps them apart from people waiting to use Lumora or Studio
--     (until they sign in to Lumora or Studio and so ask for access).
--
-- WHAT IT ADDS
--   Columns:   profiles.planner_only
--   Tables:    rate_events (private), planner_invites
--   Functions: session_aal2, mfa_ok, account_ok, rate_check, admin_reset_two_step,
--              admin_two_step_people, claim_planner_invites, request_app_access,
--              and limit triggers (lumora_limits_*)
--   Changes:   is_admin (needs two-step), is_approved, can_use_studio,
--              can_use_lumora (need the code when two-step is on), set_my_name,
--              new_profile, planner_role, my_planner_plans, invite_to_planner,
--              and the delete rules above.

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

-- Is the person asking on the Lumora team? Only when signed in with the code.
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.session_aal2()
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
