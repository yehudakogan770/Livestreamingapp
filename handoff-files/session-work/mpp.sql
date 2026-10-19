
-- ---- Plan list with time zones ----

-- The plans you own or are on, now with each plan's time zone and "end by"
-- time (so the calendar shows them at the right hour).
drop function if exists public.my_planner_plans();
create function public.my_planner_plans()
  returns table (id uuid, name text, event_date date, venue text, start_time text, role text, owner_name text,
                 cue_count integer, updated_at timestamptz, updated_by_name text, time_zone text, end_by text)
  language sql security definer stable set search_path = public
as $$
  select p.id, p.name, p.event_date, p.venue, p.start_time, public.planner_role(p.id), coalesce(nullif(o.name, ''), o.email, ''),
    (select count(*)::integer from public.planner_cues c where c.plan_id = p.id), p.updated_at, p.updated_by_name,
    p.time_zone, p.end_by
  from public.planner_plans p
  left join public.profiles o on o.id = p.owner
  where public.account_ok() and (p.owner = auth.uid() or exists
    (select 1 from public.planner_members m where m.plan_id = p.id and m.user_id = auth.uid()))
    and public.planner_role(p.id) is not null
  order by p.event_date desc nulls last, p.updated_at desc
$$;
revoke execute on function public.my_planner_plans() from public, anon;
grant execute on function public.my_planner_plans() to authenticated;
