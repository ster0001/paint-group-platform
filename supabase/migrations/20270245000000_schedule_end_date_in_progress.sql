-- =============================================================================
-- Scheduler: change the END date of a job that is already under way (Tom, 8 Oct 2026)
--
-- "In scheduler: update the system so we can update the end date for an
-- in-progress job." On the PC Command board an in-progress block could not be
-- dragged (the start must not move once the painter has started) and the
-- block's sheet had no way to change the last day — so the office had no way
-- to say "this job now runs to Thursday".
--
-- The new board control calls the function that already owns the finish date,
-- `wo_contractor_set_finish_date` (staff are allowed; it moves the accepted
-- booking's end AND work_orders.end_date, re-books the final walkthrough on
-- the new day carrying its time, and logs `finish_date_changed`). No change to
-- it here. This file closes the two holes around it:
--
--   1. move_booking (20260902 body + two changes):
--      · an ACCEPTED booking whose job has started (stage past pre_start)
--        refuses a different START date — 'error:started'. Same start + a new
--        end is still allowed. The board never drags a started job; this is
--        the server saying the same thing.
--      · an accepted booking's END now reaches the work order too. Before,
--        only start_date was copied (the booking→work-order trigger listens to
--        `state` only), so a dragged booking left work_orders.end_date on the
--        old day — and the job pages, the console and the painter's Google
--        Calendar all read work_orders.end_date. The end date is what later
--        work (defect texts, quality-check dates) keys off, so it has to be
--        one value in both places.
--   2. reassign_dates (20270154 body + one guard): an employee's START cannot
--      move once the job has started AND their own first day has passed —
--      'error:started'. Their end can. A painter joining a running job later
--      (future start) can still have both days moved.
--
-- Converges on a re-run: create or replace only, no data change.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. move_booking --------------------------------------------------------
create or replace function public.move_booking(
  p_offer_id uuid, p_start date, p_end date default null, p_expected_state text default 'accepted'
) returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_rows integer; v_stage public.wo_stage;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;

  -- NEW: a started job keeps its start. Read before the write so the refusal
  -- leaves the row untouched.
  select * into v_o from public.booking_offers where id = p_offer_id;
  if not found then return 'error:not_found'; end if;
  if v_o.state = 'accepted' and v_o.state::text = p_expected_state then
    select stage into v_stage from public.work_orders where id = v_o.work_order_id;
    if v_stage is not null and v_stage not in ('offered', 'pre_start')
       and p_start is distinct from v_o.start_date then
      return 'error:started';
    end if;
  end if;
  if p_end is not null and p_end < p_start then return 'error:bad_dates'; end if;

  update public.booking_offers
     set start_date = p_start, end_date = p_end
   where id = p_offer_id and state::text = p_expected_state
     and state in ('offered', 'proposed', 'accepted');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select * into v_o from public.booking_offers where id = p_offer_id;
    if not found then return 'error:not_found'; end if;
    return 'conflict:' || v_o.state;
  end if;

  select * into v_o from public.booking_offers where id = p_offer_id;
  -- Only a booked job pins its dates onto the work order — BOTH ends (NEW: end_date).
  if v_o.state = 'accepted' then
    update public.work_orders set start_date = p_start, end_date = p_end where id = v_o.work_order_id;
  end if;
  return 'ok:moved';
end $$;
revoke all on function public.move_booking(uuid, date, date, text) from public, anon;
grant execute on function public.move_booking(uuid, date, date, text) to authenticated;

-- ---- 2. reassign_dates ------------------------------------------------------
create or replace function public.reassign_dates(
  p_assignment_id uuid, p_start date, p_end date, p_override_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_assignments%rowtype; v_conflict text; v_s date; v_e date; v_stage public.wo_stage;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;
  if coalesce(p_end, p_start) < p_start then return 'error:bad_dates'; end if;

  select * into v_a from public.wo_assignments where id = p_assignment_id for update;
  if not found then return 'error:not_found'; end if;
  if v_a.status = 'released' then return 'error:released'; end if;
  if v_a.start_date = p_start and v_a.end_date = coalesce(p_end, p_start) then return 'ok:unchanged'; end if;

  -- NEW: once the job is under way and this painter's first day has passed,
  -- their start is history. The end can still move.
  select stage into v_stage from public.work_orders where id = v_a.work_order_id;
  if v_stage is not null and v_stage not in ('offered', 'pre_start')
     and p_start <> v_a.start_date
     and v_a.start_date <= (now() at time zone 'Australia/Melbourne')::date then
    return 'error:started';
  end if;

  v_conflict := public.wo_assignment_conflict(v_a.contractor_id, p_start, coalesce(p_end, p_start), p_assignment_id);
  if v_conflict is not null and coalesce(p_override_reason, '') = '' then return v_conflict; end if;

  update public.wo_assignments
     set start_date = p_start, end_date = coalesce(p_end, p_start),
         status = 'assigned', accepted_at = null,
         override_reason = case when v_conflict is not null then coalesce(p_override_reason, '') else override_reason end
   where id = p_assignment_id;

  select min(start_date), max(end_date) into v_s, v_e
    from public.wo_assignments where work_order_id = v_a.work_order_id and status <> 'released';
  update public.work_orders set start_date = v_s, end_date = v_e where id = v_a.work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'assignment_dates_changed', auth.uid(), 'staff',
          jsonb_build_object('assignment_id', p_assignment_id, 'contractor_id', v_a.contractor_id,
                             'from', jsonb_build_object('start_date', v_a.start_date, 'end_date', v_a.end_date),
                             'to', jsonb_build_object('start_date', p_start, 'end_date', coalesce(p_end, p_start)),
                             'override', v_conflict, 'override_reason',
                             case when v_conflict is not null then p_override_reason else null end));
  return 'ok:moved';
end $$;
revoke all on function public.reassign_dates(uuid, date, date, text) from public, anon;
grant execute on function public.reassign_dates(uuid, date, date, text) to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select p.prosrc like '%error:started%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'move_booking') as move_guards_start, true as _expect_move_guard,
  (select p.prosrc like '%set start_date = p_start, end_date = p_end where id = v_o.work_order_id%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'move_booking') as move_writes_wo_end, true as _expect_wo_end,
  (select p.prosrc like '%error:started%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reassign_dates') as reassign_guards_start, true as _expect_reassign_guard,
  has_function_privilege('authenticated', 'public.move_booking(uuid, date, date, text)', 'execute') as move_grant, true as _expect_move_grant,
  has_function_privilege('authenticated', 'public.reassign_dates(uuid, date, date, text)', 'execute') as reassign_grant, true as _expect_reassign_grant,
  has_function_privilege('authenticated', 'public.wo_contractor_set_finish_date(uuid, date)', 'execute') as finish_grant, true as _expect_finish_grant;

insert into public._prod_migrations(name) values ('20270245000000_schedule_end_date_in_progress.sql') on conflict (name) do nothing;
