-- =============================================================================
-- A quiet site is a reminder, not a blockage
--
-- Tom, 22 Aug: nobody expects a painter to tick every day — three times a week
-- is plenty. The old catch fired after ONE quiet day and wrote blocked_reason,
-- which made the console show the job as blocked and put a red card up every
-- morning. That is nagging, and nagging gets ignored.
--
-- Now: it looks back over `zeroTickDays` (Settings, default 3), writes NO
-- blocked_reason, and will not raise a second reminder inside the same window.
-- =============================================================================

update public.settings
   set value = jsonb_set(value, '{zeroTickDays}', '3'::jsonb, true)
 where key = 'wo_loop';

-- Nothing is blocked by silence any more; clear what the old rule left behind.
update public.work_orders
   set blocked_reason = null
 where blocked_reason = 'No ticks logged yesterday — call the crew';

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
       and w.start_date <= current_date
       -- Quiet for the whole window, not merely yesterday.
       and not exists (
         select 1 from public.wo_events e
          where e.work_order_id = w.id
            and e.type = 'surface_tick'
            and e.created_at >= (current_date - make_interval(days => v_days))
       )
       -- And not already reminded inside this window: one nudge, not a drumbeat.
       and not exists (
         select 1 from public.wo_events f
          where f.work_order_id = w.id
            and f.type = 'quiet_site'
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
grant execute on function public.wo_zero_tick_sweep() to authenticated, service_role;

-- A tick no longer has to clear a blocker, because silence no longer sets one.
drop trigger if exists wo_events_clear_zero_tick on public.wo_events;

select value->'zeroTickDays' as quiet_days,
       (select count(*) from public.work_orders where blocked_reason is not null) as still_blocked
  from public.settings where key = 'wo_loop';
