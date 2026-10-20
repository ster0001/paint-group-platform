-- 20270281 · 12 Demo Street never has a quality check: the walk-through is Module 9
--
-- Tom, 20 Oct 2026: the walk-through did not come up on the practice job after the
-- last tick. Cause: wo_schedule_qa books a final quality check for a new painter
-- (qa_mode first_jobs) or every job (every_job) at accept, the practice job included.
-- The finish then routed the job to the qa stage to wait for the office, and once a
-- check is passed the office signs the job off and the painter runs no walk-through
-- at all. The walk-through is the point of Module 9, so the practice job is exempt:
--   1. wo_schedule_qa returns ok:0 for a demo work order (the one scheduling rule,
--      re-created from 20270228 with one early return added).
--   2. Every check already booked on a practice job is deleted. A practice job that
--      is already at the qa stage has nothing to route it on; Reset demo is the way
--      back for those (the banner button), as the help says.
-- Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. the scheduling rule --------------------------------------------------------------
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_mode text; v_colour text; v_trigger text; v_closed integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;
  if coalesce(v_wo.qa_waived, false) then return 'ok:0'; end if;
  -- The practice job (induction brief): the painter runs the walk-through in Module 9,
  -- so no check is ever booked on it, whatever the mode or colour of the painter.
  if coalesce(v_wo.is_demo, false) then return 'ok:0'; end if;

  select coalesce(qa_mode, 'first_jobs') into v_mode from public.contractors where id = v_wo.contractor_id;
  if v_mode = 'none' and not coalesce(v_wo.qa_required, false) then return 'ok:0'; end if;

  select colour into v_colour from public.painter_status where painter_id = v_wo.contractor_id;
  v_colour := coalesce(v_colour, 'new');

  if coalesce(v_wo.qa_required, false) then v_trigger := 'required';
  elsif v_mode = 'every_job' then v_trigger := 'required';
  elsif v_colour in ('orange', 'red') then v_trigger := 'orange_every';
  elsif v_colour = 'yellow' then
    -- One job in three: the closed jobs so far, counted from the launch.
    select count(*) into v_closed from public.work_orders
     where contractor_id = v_wo.contractor_id and stage = 'closed';
    if v_closed % 3 = 0 then v_trigger := 'yellow_cadence'; else return 'ok:0'; end if;
  elsif v_colour = 'new' and public.wo_contractor_is_new(v_wo.contractor_id) then v_trigger := 'new_painter';
  else
    return 'ok:0';   -- Green (R13: spot checks only), or New past its first jobs
  end if;

  for v_kind in
    select jsonb_array_elements_text(public.wo_loop_setting(array['qaCadence','checks']))
  loop
    if not exists (select 1 from public.wo_qa_checks where work_order_id = p_work_order_id and kind = v_kind) then
      insert into public.wo_qa_checks (work_order_id, kind, scheduled_for, trigger)
        values (p_work_order_id, v_kind, case when v_kind = 'day_one' then v_wo.start_date else null end, v_trigger);
      v_made := v_made + 1;
    end if;
  end loop;
  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_schedule_qa(uuid) to authenticated, service_role;

-- ---- 2. the checks already booked on practice jobs ----------------------------------------
delete from public.wo_qa_checks
 where work_order_id in (select id from public.work_orders where is_demo);

-- ---- 3. read-back -------------------------------------------------------------------------
select
  (select count(*) from public.wo_qa_checks q join public.work_orders w on w.id = q.work_order_id where w.is_demo) as demo_checks, 0 as _expect_demo_checks,
  (select position('is_demo' in pg_get_functiondef('public.wo_schedule_qa(uuid)'::regprocedure)) > 0) as rule_has_demo_guard, true as _expect_rule_has_demo_guard,
  has_function_privilege('authenticated', 'public.wo_schedule_qa(uuid)', 'execute') as schedule_callable, true as _expect_schedule_callable,
  (select count(*) from public.work_orders where is_demo and stage = 'qa') as demo_jobs_at_qa_stage_to_reset;

insert into public._prod_migrations(name) values ('20270281000000_demo_no_quality_check.sql') on conflict (name) do nothing;
