-- =============================================================================
-- A job goes live when its start date arrives, not when someone remembers
--
-- Tom, 22 Aug: the pre-start list should be closeable a week or two out — that
-- is the point of it — but finishing the list and the job going live are two
-- different events. The workflow doc says the same: "all items ticked. Start
-- date arrives -> stage 3."
--
-- Three parts:
--   1. 'system' may make the pre_start -> in_progress move (the sweep).
--   2. wo_autostart_sweep() starts every job whose date has come and whose list
--      is true. Runs from the same 6pm cron as the rest.
--   3. wo_start_now() for "they got on site today" — it moves the START DATE to
--      today as well, so the silent-site catch is not measuring against a date
--      that is now wrong.
--
-- The whole transition table is re-seeded here so there is one canonical list;
-- lib/workorder/stages.ts mirrors THIS file, and its drift test reads it.
-- =============================================================================

insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',      array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff']),
  ('in_progress',     'qa',              'all surfaces done — QA is scheduled', array['system','staff','contractor']),
  ('in_progress',     'completion_prep', 'all surfaces done — no QA due',       array['system','staff','contractor']),
  ('qa',              'completion_prep', 'QA passed',                           array['staff']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('completion_prep', 'walkthrough',     'evidence pack delivered',             array['system','staff','contractor']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer'])
on conflict (from_stage, to_stage) do update
  set label = excluded.label, actors = excluded.actors;

-- ---- 2. the morning a job is due ------------------------------------------
create or replace function public.wo_autostart_sweep()
returns integer language plpgsql security definer set search_path = public as $$
declare v_row record; v_started integer := 0; v_today date;
begin
  if not (public.is_staff() or public.wo_is_system()) then return -1; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;

  for v_row in
    select w.id from public.work_orders w
     where w.stage = 'pre_start'
       and w.start_date is not null
       and w.start_date <= v_today
  loop
    -- The gate still decides. A job whose list is not true simply waits, and
    -- shows amber on the console with colours or the list named as the blocker.
    if public.wo_gate_blocked(v_row.id, 'pre_start', 'in_progress') is null then
      perform public.wo_set_stage(v_row.id, 'in_progress', 'system',
        jsonb_build_object('via', 'start_date_arrived', 'date', v_today));
      v_started := v_started + 1;
    end if;
  end loop;

  return v_started;
end $$;
grant execute on function public.wo_autostart_sweep() to authenticated, service_role;

-- ---- 3. "they got on site today" -------------------------------------------
-- Starting early moves the start date with it. Otherwise the silent-site catch
-- would measure against a date that is no longer true, and the calendar would
-- show the job starting on a day it did not.
create or replace function public.wo_start_now(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_today date; v_gate text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage <> 'pre_start' then return 'error:not_pre_start'; end if;

  v_gate := public.wo_gate_blocked(p_work_order_id, 'pre_start', 'in_progress');
  if v_gate is not null then return 'error:gate:' || v_gate; end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if v_wo.start_date is null or v_wo.start_date > v_today then
    update public.work_orders set start_date = v_today where id = p_work_order_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'start_date_moved', auth.uid(), 'staff',
              jsonb_build_object('from', v_wo.start_date, 'to', v_today, 'why', 'started early'));
  end if;

  return public.wo_set_stage(p_work_order_id, 'in_progress', 'staff',
                             jsonb_build_object('via', 'started_early'));
end $$;
grant execute on function public.wo_start_now(uuid) to authenticated;

select from_stage, to_stage, actors from public.wo_stage_transitions
 where from_stage = 'pre_start' and to_stage = 'in_progress';
