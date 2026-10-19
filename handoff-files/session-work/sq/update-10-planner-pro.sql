-- Lumora update 10: Planner show day and production tools.
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it only adds what is not there yet, and replaces
--   its own functions and rules with the same ones).
--   It needs setup.sql and updates 4, 5, 6, 8 and 9 to have been run first (if
--   one is missing it stops at the first check and says so; nothing is changed).
--   (Already included at the end of setup.sql for new projects.)
--
-- WHAT IT DOES
--   Show day: one person calls the show from the Planner (or Lumora, when it
--   runs a plan's cues); everyone on the plan, and crew with the public link,
--   sees what is on now and next, with each cue's time left and how far the
--   show runs over or under. Rehearsals are timed the same way and kept, so
--   the plan's lengths can be set from them. Messages go to the stage timer.
--   Cues get a script (for the prompter), a color, custom columns, and can be
--   left out of the timing ("floated").
--   Plans get a time zone, an "end by" time, templates, versions (saved by
--   hand and automatically), a public read-only link (agenda or crew), and
--   calendar feeds (iCal).
--   Lists per plan: crew (call sheet), contacts, tasks (per plan or per cue),
--   gear and budget. Files per plan or per cue (Supabase Storage, private).
--   Mentions (@name) in comments and chat, and tasks given to someone, show up
--   in that person's notifications.
--   Sections can be locked to some editors.
--
-- WHAT IT ADDS
--   Columns:   planner_plans.time_zone, end_by, columns, is_template,
--              share_token, share_scope; planner_cues.script, color, skip,
--              custom; planner_comments.mentions; planner_messages.mentions
--   Tables:    planner_live, planner_live_log, planner_items, planner_files,
--              planner_versions, planner_notifications, planner_sections,
--              planner_feeds
--   Functions: planner_clock, planner_live_go, planner_can_edit,
--              planner_save_version, planner_restore_version, planner_copy_plan,
--              planner_share, planner_public, planner_ical, planner_my_feed,
--              planner_ical_me, planner_task_done, planner_file_role (and the
--              triggers that stamp, limit and notify)
--   Storage:   a private bucket "planner-files" (25 MB a file, 250 MB a plan)
--   Realtime:  planner_live, planner_items, planner_files,
--              planner_notifications and planner_sections.
--
-- WHO MAY DO WHAT (row level security)
--   Everyone on a plan sees its show state, lists (except the budget, which
--   only the owner and editors see), files and versions. The owner and editors
--   call the show, change lists, add and delete files, and save and restore
--   versions. A task's person (or an editor) ticks it off. Only the owner
--   locks sections, makes the public link and turns it off. Each person sees
--   only their own notifications.
--   The public link shows the plan without signing in: "agenda" shows the
--   cue titles, sections and times; "crew" also shows who, notes, scripts and
--   the crew's names, positions and call times (never phone numbers, emails,
--   the budget, files, comments or chat).

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
