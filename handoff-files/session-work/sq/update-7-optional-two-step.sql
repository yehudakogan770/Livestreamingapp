-- Lumora update 7: two-step sign-in is optional for the Lumora team too.
-- Team actions need the code only when that account has two-step turned on.
-- Safe to run more than once. Run after update 6.

create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public
as $$
  select public.mfa_ok()
    and coalesce((select is_admin and not blocked from public.profiles where id = auth.uid()), false)
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
