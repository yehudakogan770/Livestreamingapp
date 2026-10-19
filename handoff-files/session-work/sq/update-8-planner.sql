-- Lumora update 8: Planner chat and schedules.
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it only adds what is not there yet, and replaces
--   its own functions and rules with the same ones).
--   It needs setup.sql and updates 4, 5 and 6 to have been run first (if one
--   is missing it stops at the first check and says so; nothing is changed).
--   (Already included at the end of setup.sql for new projects.)
--
-- WHAT IT DOES
--   Chat: each plan has a chat for everyone on it (owner, editors, viewers).
--   - Everyone on the plan reads and writes messages (at most 2000
--     characters; at most 30 a minute from one account).
--   - The author deletes their own message; the plan's owner deletes any.
--   - Messages show up for everyone at once (Realtime).
--   Schedules: the people side of a plan. Time blocks (crew call, load-in,
--   sound check, doors, show, strike…) with a day, start and end time,
--   title, location, who and notes. A plan can span several days.
--   - Everyone on the plan reads them; the owner and editors change them
--     (at most 500 blocks a plan).
--
-- WHAT IT ADDS
--   Tables:    planner_messages, planner_schedule
--   Functions: planner_message_guard, planner_schedule_stamp,
--              lumora_limits_planner_messages, lumora_limits_planner_schedule
--   Realtime:  both tables are added to the supabase_realtime publication.

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
