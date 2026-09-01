-- A quiet site needs someone who was supposed to be on it.
--
-- wo_zero_tick_sweep flagged every tickless in_progress job, including jobs
-- with NO contractor assigned — where silence is the expected state, not a
-- warning. On the 3a-8 volume dataset (2,000 contractor-less in_progress
-- jobs) one sweep run minted 2,000 quiet_site events and flooded the console
-- queue; on production the same shape appears whenever a job sits in
-- in_progress without an assigned contractor. Rule now matches the sweep's
-- QA backstop: no contractor, no quiet-site flag.
--
-- Body copied verbatim from 20261022000000_quiet_site_grace.sql, plus the
-- one contractor_id predicate. The cleanup below removes flags this rule
-- would never have raised.

create or replace function public.wo_zero_tick_sweep()
returns integer language plpgsql security definer set search_path = public as $$
declare v_row record; v_count integer := 0; v_days integer;
begin
  if not (public.is_staff() or public.wo_is_system()) then return -1; end if;

  v_days := greatest(coalesce((public.wo_loop_setting(array['zeroTickDays']))::text::integer, 3), 1);

  for v_row in
    select w.id, w.wo_ref
      from public.work_orders w
     where w.stage = 'in_progress'
       -- Nobody assigned means nobody expected on site — not a quiet site.
       and w.contractor_id is not null
       and w.start_date is not null
       -- The job has been running long enough for silence to mean something.
       and w.start_date <= (current_date - make_interval(days => v_days))
       and not exists (
         select 1 from public.wo_events e
          where e.work_order_id = w.id and e.type = 'surface_tick'
            and e.created_at >= (current_date - make_interval(days => v_days))
       )
       and not exists (
         select 1 from public.wo_events f
          where f.work_order_id = w.id and f.type = 'quiet_site'
            and f.created_at >= (current_date - make_interval(days => v_days))
       )
  loop
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_row.id, 'quiet_site', 'system',
              jsonb_build_object('date', current_date, 'wo_ref', v_row.wo_ref, 'days', v_days));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- Flags already raised on contractor-less jobs, which this rule would never
-- have written. On production this is expected to touch few or no rows.
delete from public.wo_events e
 using public.work_orders w
 where e.work_order_id = w.id
   and e.type = 'quiet_site'
   and w.contractor_id is null;

-- Read-back: the guard is in the live body, and no contractor-less flags remain.
select
  (select prosrc like '%contractor_id is not null%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_zero_tick_sweep') as guard_present,
  (select count(*) from public.wo_events e
     join public.work_orders w on w.id = e.work_order_id
    where e.type = 'quiet_site' and w.contractor_id is null) as strays_left;
