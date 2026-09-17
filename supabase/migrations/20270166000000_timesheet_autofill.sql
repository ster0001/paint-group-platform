-- =============================================================================
-- Employed painters — Session 7b (Tom, 17 Sep): days clock themselves.
--
-- "The painters won't remember to clock in every day. It needs to auto clock
--  their time on the job based on 07:30–15:30, unless the job is signed off
--  earlier, or they have multiple jobs scheduled the same day. If they do
--  overtime, they can log this."
--
-- 1. settings.timesheets — the standard day (start, finish, break), editable.
-- 2. timesheet_autofill(day): for every employee assignment covering a
--    weekday, with no entry yet for that painter on that day, ONE job that
--    day, and no sick / approved leave over it — insert a submitted entry
--    07:30 → 15:30 (or the sign-off time when the job closed earlier that
--    day), source 'auto'. The evening sweep calls it for the last 7 days;
--    idempotent — an existing entry for the day means nothing is added.
-- 3. timesheet_extra(): the painter's overtime — a span on top of the day,
--    never overlapping what is already there. Source 'painter', submitted.
-- 4. leave_record_for(): the office marks sick / leave / RDO on a painter's
--    behalf (from the board). Leave and RDO count at once (the office said
--    so); sick raises Reassign on any booked day, as the painter's own would.
-- =============================================================================

-- ---- 1. the standard day ---------------------------------------------------------
insert into public.settings (key, value)
values ('timesheets', '{"dayStart": "07:30", "dayFinish": "15:30", "breakMinutes": 30}'::jsonb)
on conflict (key) do nothing;

-- 'auto' joins painter | pc; a note for the painter's overtime.
alter table public.timesheet_entries drop constraint if exists timesheet_entries_source_check;
alter table public.timesheet_entries
  add constraint timesheet_entries_source_check check (source in ('painter', 'pc', 'auto'));
alter table public.timesheet_entries add column if not exists note text not null default '';

-- The standard day as three values; defaults when the row is missing or odd.
create or replace function public.timesheet_day_setting()
returns table (day_start time, day_finish time, break_minutes integer)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select (value->>'dayStart')::time from public.settings where key = 'timesheets'), '07:30'::time),
    coalesce((select (value->>'dayFinish')::time from public.settings where key = 'timesheets'), '15:30'::time),
    coalesce((select (value->>'breakMinutes')::integer from public.settings where key = 'timesheets'), 30)
$$;
grant execute on function public.timesheet_day_setting() to authenticated;

-- ---- 2. the autofill ---------------------------------------------------------------
create or replace function public.timesheet_autofill(p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_day date; v_n integer := 0; v_skipped integer := 0; d record; a record;
        v_start timestamptz; v_finish timestamptz; v_signed timestamptz;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  v_day := coalesce(p_day, (now() at time zone 'Australia/Melbourne')::date);
  -- Never a day that has not finished yet: the standard finish must be past.
  select * into d from public.timesheet_day_setting();
  if (v_day::timestamp + d.day_finish) at time zone 'Australia/Melbourne' > now() then return 'error:day_not_over'; end if;
  -- Weekends are not standard days; the office records one if it was worked.
  if extract(isodow from v_day) >= 6 then return 'ok:0:weekend'; end if;

  for a in
    -- (no min() over uuid in Postgres — the first of the array is the one job when count = 1)
    select x.contractor_id, (array_agg(x.work_order_id))[1] as work_order_id, count(*) as jobs
      from public.wo_assignments x
      join public.contractors c on c.id = x.contractor_id
     where x.status <> 'released' and c.employment_type = 'employee'
       and x.start_date <= v_day and x.end_date >= v_day
     group by x.contractor_id
  loop
    -- Two jobs on the day: the office (or the painter) says which hours went where.
    if a.jobs > 1 then v_skipped := v_skipped + 1; continue; end if;
    -- Already clocked, recorded or filled for the day.
    if exists (select 1 from public.timesheet_entries t where t.contractor_id = a.contractor_id and t.work_date = v_day) then continue; end if;
    -- Sick, or approved leave / RDO, or the office blocked the day.
    if exists (select 1 from public.contractor_unavailability u
                where u.contractor_id = a.contractor_id and u.declined_at is null
                  and u.start_date <= v_day and u.end_date >= v_day
                  and (u.kind in ('other', 'sick') or u.approved_at is not null)) then continue; end if;

    v_start  := (v_day::timestamp + d.day_start)  at time zone 'Australia/Melbourne';
    v_finish := (v_day::timestamp + d.day_finish) at time zone 'Australia/Melbourne';
    -- Signed off earlier that day: the day ends at the signature.
    select s.signed_at into v_signed from public.wo_signoff s where s.work_order_id = a.work_order_id;
    if v_signed is not null and v_signed < v_finish and v_signed > v_start then v_finish := v_signed; end if;
    -- Closed before the day began: nothing was worked.
    if v_signed is not null and v_signed <= v_start then continue; end if;
    if public.timesheet_hours(v_start, v_finish, d.break_minutes) <= 0 then continue; end if;

    insert into public.timesheet_entries (contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status)
    values (a.contractor_id, a.work_order_id, v_day, v_start, v_finish, d.break_minutes, 'auto', 'submitted');
    v_n := v_n + 1;
  end loop;
  return 'ok:' || v_n || case when v_skipped > 0 then ':manual:' || v_skipped else '' end;
end $$;
revoke execute on function public.timesheet_autofill(date) from public, anon;
grant execute on function public.timesheet_autofill(date) to authenticated, service_role;

-- ---- 3. the painter's overtime ------------------------------------------------------
create or replace function public.timesheet_extra(p_work_order_id uuid, p_date date, p_start time, p_finish time, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_today date; v_start timestamptz; v_finish timestamptz; v_id uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_painter'; end if;
  if not public.is_employee() then return 'error:not_an_employee'; end if;
  if not public.wo_painter_on_job(p_work_order_id, v_cid) then return 'error:not_your_job'; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if p_date is null or p_date > v_today or p_date < v_today - 7 then return 'error:bad_date'; end if;
  if p_start is null or p_finish is null or p_finish <= p_start then return 'error:bad_span'; end if;
  if p_finish - p_start > interval '8 hours' then return 'error:too_long'; end if;
  if length(coalesce(p_note, '')) > 300 then return 'error:reason_too_long'; end if;
  v_start  := (p_date::timestamp + p_start)  at time zone 'Australia/Melbourne';
  v_finish := (p_date::timestamp + p_finish) at time zone 'Australia/Melbourne';
  if v_finish > now() then return 'error:not_yet'; end if;
  if exists (select 1 from public.timesheet_entries t
              where t.contractor_id = v_cid and t.status <> 'rejected'
                and t.started_at < v_finish and coalesce(t.finished_at, now()) > v_start) then
    return 'error:overlap';
  end if;
  insert into public.timesheet_entries (contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status, note)
  values (v_cid, p_work_order_id, p_date, v_start, v_finish, 0, 'painter', 'submitted', coalesce(trim(p_note), ''))
  returning id into v_id;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.timesheet_extra(uuid, date, time, time, text) to authenticated;

-- ---- 4. the office marks time off for a painter -------------------------------------
create or replace function public.leave_record_for(p_contractor_id uuid, p_kind text, p_start date, p_end date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; a record; v_kind public.unavailability_kind;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('leave', 'rdo', 'sick', 'other') then return 'error:bad_kind'; end if;
  v_kind := p_kind::public.unavailability_kind;
  if p_start is null or p_end is null or p_end < p_start then return 'error:bad_dates'; end if;
  select employment_type into v_type from public.contractors where id = p_contractor_id;
  if v_type is null then return 'error:not_found'; end if;
  if v_kind <> 'other' and v_type <> 'employee' then return 'error:not_an_employee'; end if;
  insert into public.contractor_unavailability (contractor_id, start_date, end_date, reason, source, kind, requested_by, approved_by, approved_at)
  values (p_contractor_id, p_start, p_end, coalesce(trim(p_reason), ''), 'staff', v_kind, auth.uid(),
          case when v_kind in ('leave', 'rdo') then auth.uid() end,
          case when v_kind in ('leave', 'rdo') then now() end)
  returning id into v_id;
  if v_kind = 'sick' then
    for a in select * from public.wo_assignments
              where contractor_id = p_contractor_id and status <> 'released'
                and start_date <= p_end and end_date >= p_start
    loop
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (a.work_order_id, 'assignment_cant_make_it', auth.uid(), 'staff',
              jsonb_build_object('assignment_id', a.id, 'contractor_id', p_contractor_id,
                                 'start_date', a.start_date, 'end_date', a.end_date,
                                 'reason', 'Sick (marked by the office)' || case when coalesce(trim(p_reason), '') <> '' then ' — ' || trim(p_reason) else '' end,
                                 'unavailability_id', v_id));
    end loop;
  end if;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.leave_record_for(uuid, text, date, date, text) to authenticated;

-- ---- read-back -------------------------------------------------------------------------
select
  exists (select 1 from public.settings where key = 'timesheets') as setting_ok,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_entries' and column_name = 'note') = 1 as note_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('timesheet_day_setting', 'timesheet_autofill', 'timesheet_extra', 'leave_record_for')) = 4 as functions_ok,
  (select d.day_start::text || '-' || d.day_finish::text || '-' || d.break_minutes from public.timesheet_day_setting() d) = '07:30:00-15:30:00-30' as standard_day_ok;

insert into public._prod_migrations(name) values ('20270166000000_timesheet_autofill.sql') on conflict (name) do nothing;
