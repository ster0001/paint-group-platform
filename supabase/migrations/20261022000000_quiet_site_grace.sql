-- A job that started this morning has not been quiet for three days
--
-- The first version flagged on `start_date <= current_date`, so a job starting
-- today was reminded about before anyone could have picked up a brush. The
-- window has to have actually elapsed: a job is quiet only once it has been
-- running for at least that many days without a tick.
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
