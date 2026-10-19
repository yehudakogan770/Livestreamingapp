-- Lumora update 3: problem reports (error reports and "Report a problem").
--
-- WHAT IT DOES
--   Gives Lumora and Lumora Studio a place to send problems:
--   - error reports: an error nobody caught, or a crash of the program. Sent
--     ONLY if the person said yes to "Send anonymous error reports to help fix
--     problems?" (asked once after signing in; off unless they agree; changed
--     any time in Lumora's Settings menu or Lumora Studio's Help menu);
--   - Help → "Report a problem…": what the person wrote, and (if they left
--     them in) a picture of the window and the app's last 50 log lines.
--   The Lumora team reads them in Lumora: Settings → People and approvals →
--   "Problems reported" (grouped by problem, with counts and versions), and
--   marks them resolved there.
--
-- WHAT IS NEVER IN A REPORT
--   The show, the project or anything in them. Before a report leaves the
--   computer, the app takes out folders (a path becomes just its file name, so
--   no user names), emails, stream keys and stream addresses, passwords,
--   tokens and network addresses (app/src/reports/scrub.ts). A picture is
--   only there if the person added it themselves in "Report a problem".
--
-- HOW TO RUN IT
--   Run once: Supabase → SQL Editor → New query → paste all of this → Run.
--   It is safe to run again (it only adds what is not there yet).
--   It needs setup.sql to have been run first (profiles and is_admin()).
--
-- WHAT IT ADDS
--   Table:     problem_reports
--   Function:  problem_report_limit (a trigger: at most 30 reports an hour,
--              and 10 with a picture a day, from one account, so a broken
--              computer can't flood the table)
--
-- WHO MAY DO WHAT (row level security)
--   - Any approved account may ADD reports, as itself only (user_id is
--     always the person sending), never already "resolved".
--   - Only the Lumora team (profiles.is_admin, the same people who approve
--     accounts) may READ reports, and mark them resolved or open again.
--   - Nobody can change what a report says; only the team can delete.
--   - People who are not signed in (anon) can do nothing at all.

create table if not exists public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Who sent it (kept so the team can follow up; null if the account is deleted).
  user_id uuid default auth.uid() references auth.users on delete set null,
  -- error: caught automatically; crash: the program itself stopped; report: "Report a problem".
  kind text not null check (kind in ('error', 'crash', 'report')),
  app text not null check (app in ('lumora', 'studio')),
  version text not null default '' check (length(version) <= 40),
  -- In general terms, e.g. "Windows NT 10.0; Win64; x64 · Edg/131".
  os text not null default '' check (length(os) <= 200),
  message text not null default '' check (length(message) <= 2000),
  stack text not null default '' check (length(stack) <= 20000),
  -- The app's last 50 log lines (cleaned), if any.
  logs text not null default '' check (length(logs) <= 40000),
  -- What the person wrote ("Report a problem" only).
  description text check (length(description) <= 8000),
  -- A picture of the window as a JPEG data: address ("Report a problem" only, at most about 600 KB).
  screenshot text check (length(screenshot) <= 800000),
  -- The same problem from different computers has the same fingerprint (for grouping).
  fingerprint text not null default '' check (length(fingerprint) <= 300),
  has_screenshot boolean generated always as (screenshot is not null) stored,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users on delete set null
);

create index if not exists problem_reports_created on public.problem_reports (created_at desc);
create index if not exists problem_reports_fingerprint on public.problem_reports (fingerprint);
create index if not exists problem_reports_user_time on public.problem_reports (user_id, created_at desc);

alter table public.problem_reports enable row level security;

-- Approved accounts add reports, as themselves, never already resolved.
drop policy if exists "signed in people send reports" on public.problem_reports;
create policy "signed in people send reports" on public.problem_reports
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved() and resolved = false and resolved_at is null and resolved_by is null);

-- Only the Lumora team reads them.
drop policy if exists "team reads reports" on public.problem_reports;
create policy "team reads reports" on public.problem_reports
  for select to authenticated
  using (public.is_admin());

-- Only the Lumora team marks them resolved (or open again).
drop policy if exists "team resolves reports" on public.problem_reports;
create policy "team resolves reports" on public.problem_reports
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Only the Lumora team deletes them.
drop policy if exists "team deletes reports" on public.problem_reports;
create policy "team deletes reports" on public.problem_reports
  for delete to authenticated
  using (public.is_admin());

-- Table rights: people may insert (the columns the app sends), the team may
-- change only "resolved". Nobody signed out may do anything.
revoke all on public.problem_reports from anon, authenticated;
grant insert (kind, app, version, os, message, stack, logs, description, screenshot, fingerprint) on public.problem_reports to authenticated;
grant select, delete on public.problem_reports to authenticated;
grant update (resolved) on public.problem_reports to authenticated;

-- Fills in who sent it, and when and by whom it was resolved; and keeps any
-- one account to 30 reports an hour and 10 pictures a day (the app sends far
-- fewer: it waits, batches, and sends the same problem once an hour).
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

drop trigger if exists problem_report_limit on public.problem_reports;
create trigger problem_report_limit before insert or update on public.problem_reports
  for each row execute function public.problem_report_limit();

-- The Lumora team's on/off switch for problem reports (update 9), if there.
do $$
begin
  if to_regprocedure('public.feature_guard()') is not null then
    execute 'drop trigger if exists lumora_feature on public.problem_reports';
    execute 'create trigger lumora_feature before insert on public.problem_reports
      for each row execute function public.feature_guard(''problem_reports'')';
  end if;
end
$$;
