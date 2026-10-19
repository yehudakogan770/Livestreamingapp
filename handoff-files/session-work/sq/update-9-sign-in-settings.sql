-- Lumora update 9: sign-in settings and features, controlled from the apps.
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it replaces its own functions and rules with the
--   same ones, only adds what is not there yet, and never changes settings
--   you have already chosen).
--   It needs setup.sql and updates 1–8 to have been run first (if update 6
--   is missing it stops at the first check and says so; nothing is changed).
--   (Already included at the end of setup.sql for new projects.)
--
-- WHAT IT DOES
--   The Lumora team changes these in Lumora or Lumora Studio:
--   People and approvals → "Sign-in settings" and "Features". Until you change
--   anything, everything works exactly as before.
--   Sign-in settings:
--   - New accounts: wait for your approval (as before), or are approved
--     automatically with the apps you choose; optionally only for emails from
--     your domains (everyone else waits). An account is approved automatically
--     only once its email is confirmed.
--   - New sign-ups: open (as before), or closed: only emails you invited (in
--     People → "Invite by email", or to a Planner plan) can make an account.
--     Existing accounts are not affected.
--   - Invite by email: the person is approved with the apps you chose as soon
--     as they make their account and confirm their email.
--   - Two-step sign-in: optional (as before), required for the Lumora team,
--     or required for everyone. When required, nothing of theirs opens until
--     they set it up and sign in with the code (the apps walk them through it).
--   - Offline use: how many days the apps keep working without checking in.
--   - Planner: who can make new plans (approved Lumora accounts, as before,
--     or any account).
--   - Waiting message: your own words on the waiting and no-access screens.
--   Features: switch apps (with a message, e.g. "paused for maintenance until
--   6 PM") and features on or off for everyone, or for one person. Turning
--   something off never stops a show that is running: it applies the next
--   time the app starts, or when the feature is not in use.
--   Every change is kept with who made it and when.
--
-- WHAT IT ADDS
--   Tables:    app_settings (one row), app_settings_log, feature_overrides,
--              app_invites
--   Functions: sign_in_rules, sign_ups_open, feature_on, feature_keys,
--              two_step_required, can_make_plans, admin_app_settings,
--              save_app_settings, set_feature_override, invite_to_lumora,
--              and (internal) auto_approve, account_confirmed, feature_guard
--   Changes:   mfa_ok (required two-step), can_use_studio (Studio paused),
--              new_profile (closed sign-ups, invitations, automatic approval),
--              request_app_access, planner_role and the "planner make plans"
--              and "planner members see plans" rules (who makes plans,
--              Planner paused), and switches for Studio sharing and
--              comments, Planner sharing, Planner chat and problem reports.

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
