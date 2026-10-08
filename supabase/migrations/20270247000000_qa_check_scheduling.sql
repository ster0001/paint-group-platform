-- =============================================================================
-- Quality checks get a date AND a time, sit before the final walkthrough, follow
-- it when it moves, and are scheduled at booking (Tom, 8 Oct 2026):
--
--   "When a quality check is required on a job there needs to be an option to
--    schedule it in Felipe's calendar, before the final walk through. If the
--    contractor is new, and their first 3 jobs need quality checking, this
--    should be done at the point of booking the job. There also needs to be the
--    option to add additional job check-ins in the PC Command, the quality check
--    being the main check at the end of the job before the walk through. If the
--    final walk through date is adjusted, the quality check date needs to be
--    adjusted accordingly."
--
-- THE RULE (one place — wo_qa_place_open_checks; TS twin lib/workorder/qaSchedule.ts):
--   the main check (kind 'final', open, not a re-check) sits on the WORKING DAY
--   BEFORE the final walkthrough (Mon–Fri, Settings → public holidays skipped),
--   at the time it already had, else 09:00 Melbourne.
--
-- WHEN IT RUNS:
--   · booking — an offer turning 'accepted' runs the EXISTING cadence
--     (wo_schedule_qa: new painter's first jobs via wo_contractor_is_new, the
--     office flag, the status colours — not a second rule) and then places
--     whatever check that left open. With no final booked yet the job's booked
--     last day stands in for it (the date wo_book_walkthrough defaults to).
--   · the final moves — a trigger on wo_walkthroughs, so EVERY door that books
--     or moves the final (wo_book_walkthrough, wo_contractor_set_finish_date,
--     a reschedule approval) moves the check once, without touching any of them.
--   · a final CANCELLED and not rebooked — the check is LEFT where it is (Felipe
--     keeps his appointment) and PC Command flags it (a derived card, nothing
--     stored). Moving a check onto a date nobody has agreed would be a guess.
--
-- Staff schedule or move a check by hand with wo_qa_set_schedule, and add a
-- dated job check-in with wo_add_qa_check (kind 'mid', now with a time); both
-- refuse a time that is not before the booked final, or a day already gone.
-- Felipe's calendar invite is sent by the app (lib/workorder/qaCheckInvite.ts)
-- and recorded as a 'qa_check_invite' wo_event — nothing here sends mail.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the time of day ------------------------------------------------------
alter table public.wo_qa_checks add column if not exists scheduled_time time;

-- The PC card reads open dated checks by day.
create index if not exists wo_qa_checks_open_due_idx
  on public.wo_qa_checks (scheduled_for) where result is null and scheduled_for is not null;

-- ---- 2. the working day before a date ---------------------------------------
-- Monday to Friday, and not one of Settings → Booking rules → public holidays.
-- Helper for the definer functions below: no grant (20270201 default privileges).
create or replace function public.wo_working_day_before(p_date date)
returns date language plpgsql stable security definer set search_path = public as $$
declare v_holidays jsonb; v_day date := p_date;
begin
  select coalesce(value->'publicHolidays', '[]'::jsonb) into v_holidays
    from public.settings where key = 'visit_booking_rules';
  v_holidays := coalesce(v_holidays, '[]'::jsonb);
  for i in 1..60 loop
    v_day := v_day - 1;
    if extract(isodow from v_day) <= 5 and not (v_holidays ? to_char(v_day, 'YYYY-MM-DD')) then
      return v_day;
    end if;
  end loop;
  return p_date - 1;
end $$;
revoke all on function public.wo_working_day_before(date) from public, anon, authenticated;

-- ---- 3. is this a time a check can be booked for? ----------------------------
-- null = fine; 'past' = the day has gone (Melbourne); 'after_final' = not before
-- the booked final walkthrough. A final with no time agreed means an earlier DAY.
create or replace function public.wo_qa_when_problem(p_work_order_id uuid, p_date date, p_time time)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_final date; v_final_time time;
begin
  if p_date < (now() at time zone 'Australia/Melbourne')::date then return 'past'; end if;
  select scheduled_date, scheduled_time into v_final, v_final_time
    from public.wo_walkthroughs
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked'
   order by created_at desc limit 1;
  if v_final is null then return null; end if;
  if p_date > v_final then return 'after_final'; end if;
  if p_date = v_final and (v_final_time is null or p_time is null or p_time >= v_final_time) then
    return 'after_final';
  end if;
  return null;
end $$;
revoke all on function public.wo_qa_when_problem(uuid, date, time) from public, anon, authenticated;

-- ---- 4. THE rule: place the open main check before the final ----------------
-- p_via: 'booking' (an offer accepted — may fall back to the booked last day),
-- 'final_booked' (the final was booked or moved). Returns how many checks moved.
create or replace function public.wo_qa_place_open_checks(p_work_order_id uuid, p_via text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_anchor date; v_date date; v_moved integer := 0; r record;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found or v_wo.stage = 'closed' or coalesce(v_wo.qa_waived, false) then return 0; end if;

  select scheduled_date into v_anchor
    from public.wo_walkthroughs
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked'
   order by created_at desc limit 1;
  if v_anchor is null and p_via = 'booking' then
    select bo.end_date into v_anchor
      from public.booking_offers bo
     where bo.work_order_id = p_work_order_id and bo.state = 'accepted'
     order by bo.accepted_at desc nulls last limit 1;
    v_anchor := coalesce(v_anchor, v_wo.end_date);
  end if;
  if v_anchor is null then return 0; end if;
  v_date := public.wo_working_day_before(v_anchor);

  for r in
    select id, scheduled_for, scheduled_time from public.wo_qa_checks
     where work_order_id = p_work_order_id and kind = 'final' and result is null and retry_of is null
  loop
    if r.scheduled_for is not distinct from v_date and r.scheduled_time is not null then continue; end if;
    update public.wo_qa_checks
       set scheduled_for = v_date, scheduled_time = coalesce(r.scheduled_time, time '09:00')
     where id = r.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'qa_check_scheduled', auth.uid(), 'system',
              jsonb_build_object('check_id', r.id, 'date', v_date,
                                 'time', to_char(coalesce(r.scheduled_time, time '09:00'), 'HH24:MI'),
                                 'from', r.scheduled_for, 'via', p_via, 'final_date', v_anchor));
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end $$;
revoke all on function public.wo_qa_place_open_checks(uuid, text) from public, anon, authenticated;

-- ---- 5. the final moves → the check follows ---------------------------------
-- Every door that books or moves the final writes a new 'booked' row (or edits
-- one); this one trigger sees them all. A cancellation alone moves nothing.
create or replace function public.wo_walkthroughs_qa_follows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'final' or new.status <> 'booked' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.scheduled_date is not distinct from old.scheduled_date and old.status = 'booked' then return new; end if;
  end if;
  perform public.wo_qa_place_open_checks(new.work_order_id, 'final_booked');
  return new;
end $$;
revoke all on function public.wo_walkthroughs_qa_follows() from public, anon, authenticated;

drop trigger if exists t_wo_walkthroughs_qa_follows on public.wo_walkthroughs;
create trigger t_wo_walkthroughs_qa_follows
  after insert or update of scheduled_date, status on public.wo_walkthroughs
  for each row execute function public.wo_walkthroughs_qa_follows();

-- ---- 6. booking → the cadence runs and the check is placed -------------------
-- Fires after booking_offers_stage_sync (trigger order is by name), so the job
-- is already at pre_start. wo_schedule_qa answers to the accepting painter, the
-- office, or the system — the three callers of an accept.
create or replace function public.booking_offers_qa_at_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'accepted' and old.state is distinct from 'accepted' then
    perform public.wo_schedule_qa(new.work_order_id);
    perform public.wo_qa_place_open_checks(new.work_order_id, 'booking');
  end if;
  return new;
end $$;
revoke all on function public.booking_offers_qa_at_booking() from public, anon, authenticated;

drop trigger if exists t_booking_offers_qa_at_booking on public.booking_offers;
create trigger t_booking_offers_qa_at_booking
  after update of state on public.booking_offers
  for each row execute function public.booking_offers_qa_at_booking();

-- ---- 7. staff schedule / move / clear a check by hand -----------------------
create or replace function public.wo_qa_set_schedule(p_check_id uuid, p_date date, p_time time default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_c public.wo_qa_checks%rowtype; v_stage public.wo_stage; v_problem text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_c from public.wo_qa_checks where id = p_check_id;
  if not found then return 'error:not_found'; end if;
  if v_c.result is not null then return 'error:already_recorded'; end if;
  select stage into v_stage from public.work_orders where id = v_c.work_order_id;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if p_date is not null then
    if p_time is null then return 'error:no_time'; end if;
    v_problem := public.wo_qa_when_problem(v_c.work_order_id, p_date, p_time);
    if v_problem is not null then return 'error:' || v_problem; end if;
  end if;

  update public.wo_qa_checks
     set scheduled_for = p_date, scheduled_time = case when p_date is null then null else p_time end
   where id = p_check_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_c.work_order_id, 'qa_check_scheduled', auth.uid(), 'staff',
            jsonb_build_object('check_id', p_check_id, 'date', p_date,
                               'time', to_char(p_time, 'HH24:MI'), 'from', v_c.scheduled_for, 'via', 'staff'));
  return 'ok:' || coalesce(p_date::text, 'cleared');
end $$;
revoke execute on function public.wo_qa_set_schedule(uuid, date, time) from public, anon;
grant execute on function public.wo_qa_set_schedule(uuid, date, time) to authenticated;

-- ---- 8. an extra job check-in: dated, timed, before the final ----------------
-- 20270228's body with a time and the same "before the final" refusal. A spot
-- check may still go in undated (the office dates it later).
drop function if exists public.wo_add_qa_check(uuid, date, text);
create or replace function public.wo_add_qa_check(
  p_work_order_id uuid, p_date date default null, p_kind text default 'mid', p_time time default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_id uuid; v_problem text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('mid', 'spot') then return 'error:bad_kind'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage in ('closed') then return 'error:closed'; end if;
  if p_date is not null then
    v_problem := public.wo_qa_when_problem(p_work_order_id, p_date, p_time);
    if v_problem is not null then return 'error:' || v_problem; end if;
  end if;

  update public.work_orders set qa_waived = false where id = p_work_order_id and qa_waived;

  insert into public.wo_qa_checks (work_order_id, kind, scheduled_for, scheduled_time, trigger)
    values (p_work_order_id, p_kind, p_date, case when p_date is null then null else p_time end, p_kind)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_check_added', auth.uid(), 'staff',
            jsonb_build_object('check_id', v_id, 'kind', p_kind, 'date', p_date, 'time', to_char(p_time, 'HH24:MI')));
  return 'ok:' || v_id;
end $$;
revoke execute on function public.wo_add_qa_check(uuid, date, text, time) from public, anon;
grant execute on function public.wo_add_qa_check(uuid, date, text, time) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_qa_checks' and column_name = 'scheduled_time') as time_col, 1 as _expect_time_col,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'wo_qa_checks_open_due_idx') as due_idx, 1 as _expect_due_idx,
  (select count(*) from pg_trigger where tgname in ('t_wo_walkthroughs_qa_follows', 't_booking_offers_qa_at_booking') and not tgisinternal) as triggers, 2 as _expect_triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_add_qa_check') as add_check_fns, 1 as _expect_one_add_check,
  has_function_privilege('authenticated', 'public.wo_add_qa_check(uuid, date, text, time)', 'execute') as add_check_grant, true as _expect_add_check_grant,
  has_function_privilege('authenticated', 'public.wo_qa_set_schedule(uuid, date, time)', 'execute') as set_schedule_grant, true as _expect_set_schedule_grant,
  has_function_privilege('anon', 'public.wo_qa_set_schedule(uuid, date, time)', 'execute') as anon_set_schedule, false as _expect_anon_set_schedule,
  has_function_privilege('authenticated', 'public.wo_qa_place_open_checks(uuid, text)', 'execute') as place_is_internal, false as _expect_place_internal,
  public.wo_working_day_before(date '2026-10-12') as monday_minus_one, date '2026-10-09' as _expect_friday;

insert into public._prod_migrations(name) values ('20270247000000_qa_check_scheduling.sql') on conflict (name) do nothing;
