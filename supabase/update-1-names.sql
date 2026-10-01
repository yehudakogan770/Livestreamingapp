-- Lumora update 1: lets each person change their own name in the app
-- (Settings → My account). Run once: Supabase → SQL Editor → New query →
-- paste all of this → Run. (Already included in setup.sql for new projects.)

create or replace function public.set_my_name(new_name text) returns void
  language sql security definer set search_path = public
as $$
  update public.profiles set name = left(trim(new_name), 80) where id = auth.uid()
$$;
revoke execute on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;
