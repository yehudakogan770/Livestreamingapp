-- Lumora sign-in: run this once in your Supabase project
-- (Supabase → SQL Editor → New query → paste all of this → Run).
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
