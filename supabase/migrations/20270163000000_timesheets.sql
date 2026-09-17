-- =============================================================================
-- Employed painters — Session 6: timesheets + job cost (brief §3.8, ruling 10)
--
-- Why: a contractor job carries its labour cost (the offer). An employee job
-- carries none unless something records it, so every employee job reported an
-- inflated gross margin. This is the first clean source of real worked hours.
--
-- 1. timesheet_entries — one row per painter per day on a job. Two taps in
--    the portal (timesheet_start / timesheet_finish: open → submitted) or the
--    office's own entry (timesheet_record, source 'pc'). The office approves
--    or rejects. Approval posts ONE labour line into job_costs at the hours ×
--    the painter's cost rate on that day, and pins the line to the entry.
-- 2. employee_cost_rates — the office's internal cost per hour (base + super +
--    WorkCover + allowances ÷ hours, brief ruling 10), history kept by
--    effective_from. STAFF-ONLY: no painter policy at all. The platform never
--    calculates pay; the payroll CSV carries hours only.
-- 3. RLS: a painter reads their own entries (no money on the table); staff
--    read everything; nothing is client-writable — every write is an RPC.
--
-- Money: integer cents, GST 0 (an internal cost, not a supplier invoice).
-- Dates: the work day is the Melbourne calendar day, measured from the zone.
-- =============================================================================

-- ---- 1. the labour category on the job ledger ---------------------------------
-- New enum values are usable only after this transaction commits; nothing
-- below uses the literal outside a plpgsql body (checked at call time).
alter type public.job_cost_category add value if not exists 'labour';

-- ---- 2. tables ------------------------------------------------------------------
create table if not exists public.employee_cost_rates (
  id              uuid primary key default gen_random_uuid(),
  contractor_id   uuid not null references public.contractors (id) on delete cascade,
  cents_per_hour  integer not null check (cents_per_hour > 0 and cents_per_hour < 100000),
  effective_from  date not null default (now() at time zone 'Australia/Melbourne')::date,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint employee_cost_rates_one_per_day unique (contractor_id, effective_from)
);
create index if not exists employee_cost_rates_cid_idx
  on public.employee_cost_rates (contractor_id, effective_from desc);

create table if not exists public.timesheet_entries (
  id              uuid primary key default gen_random_uuid(),
  contractor_id   uuid not null references public.contractors (id) on delete cascade,
  work_order_id   uuid not null references public.work_orders (id) on delete cascade,
  work_date       date not null,
  started_at      timestamptz not null,
  finished_at     timestamptz,
  break_minutes   integer not null default 0 check (break_minutes >= 0 and break_minutes <= 240),
  source          text not null default 'painter' check (source in ('painter', 'pc')),
  status          text not null default 'open' check (status in ('open', 'submitted', 'approved', 'rejected')),
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz,
  rejected_reason text not null default '',
  /** The labour line approval posted; null until then (set-null if the line goes). */
  job_cost_id     uuid references public.job_costs (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint timesheet_entries_span check (finished_at is null or (finished_at > started_at and finished_at - started_at <= interval '16 hours')),
  constraint timesheet_entries_open_shape check ((status = 'open') = (finished_at is null)),
  constraint timesheet_entries_approved_shape check ((status = 'approved') = (approved_at is not null))
);
-- One open day per painter — the second Start refuses rather than forking.
create unique index if not exists timesheet_entries_one_open
  on public.timesheet_entries (contractor_id) where status = 'open';
create index if not exists timesheet_entries_wo_idx on public.timesheet_entries (work_order_id, work_date);
create index if not exists timesheet_entries_cid_idx on public.timesheet_entries (contractor_id, work_date desc);
create index if not exists timesheet_entries_status_idx on public.timesheet_entries (status, work_date);

-- ---- 3. RLS ---------------------------------------------------------------------
alter table public.employee_cost_rates enable row level security;
drop policy if exists employee_cost_rates_staff on public.employee_cost_rates;
create policy employee_cost_rates_staff on public.employee_cost_rates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke insert, update, delete on public.employee_cost_rates from authenticated, anon;
grant select on public.employee_cost_rates to authenticated;

alter table public.timesheet_entries enable row level security;
drop policy if exists timesheet_entries_staff on public.timesheet_entries;
create policy timesheet_entries_staff on public.timesheet_entries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists timesheet_entries_own on public.timesheet_entries;
create policy timesheet_entries_own on public.timesheet_entries
  for select to authenticated using (contractor_id = public.current_contractor_id());
revoke insert, update, delete on public.timesheet_entries from authenticated, anon;
grant select on public.timesheet_entries to authenticated;

-- ---- 4. hours, in one place -----------------------------------------------------
-- Worked hours to two places: the span less the break. Every caller (approve,
-- the CSV, the report) reads this so no two screens disagree.
create or replace function public.timesheet_hours(p_started timestamptz, p_finished timestamptz, p_break_minutes integer)
returns numeric language sql immutable as $$
  select case when p_finished is null then null
    else round((extract(epoch from (p_finished - p_started)) / 3600.0) - (coalesce(p_break_minutes, 0) / 60.0), 2) end
$$;
grant execute on function public.timesheet_hours(timestamptz, timestamptz, integer) to authenticated;

-- The rate in force on a day: the latest effective_from on or before it.
-- Staff-only table; the function is invoker-rights on purpose so a painter
-- calling it reads nothing.
create or replace function public.employee_cost_rate_on(p_contractor_id uuid, p_date date)
returns integer language sql stable as $$
  select cents_per_hour from public.employee_cost_rates
   where contractor_id = p_contractor_id and effective_from <= p_date
   order by effective_from desc limit 1
$$;
grant execute on function public.employee_cost_rate_on(uuid, date) to authenticated;

-- ---- 5. the painter's two taps --------------------------------------------------
-- Start day. Defaults to today's assigned job when none is named; refuses
-- when there is nothing on today, when two jobs are and none was picked,
-- when the painter is not on the named job, or when a day is already open.
create or replace function public.timesheet_start(p_work_order_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_wo uuid; v_today date; v_n integer; v_id uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_painter'; end if;
  if not public.is_employee() then return 'error:not_an_employee'; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;

  if p_work_order_id is null then
    -- (no min() over uuid in Postgres — take the first of the array)
    select count(*), (array_agg(a.work_order_id))[1] into v_n, v_wo
      from public.wo_assignments a
     where a.contractor_id = v_cid and a.status <> 'released'
       and v_today between a.start_date and a.end_date;
    if v_n = 0 then return 'error:no_job_today'; end if;
    if v_n > 1 then return 'error:pick_job'; end if;
  else
    if not public.wo_painter_on_job(p_work_order_id, v_cid) then return 'error:not_your_job'; end if;
    v_wo := p_work_order_id;
  end if;

  if exists (select 1 from public.timesheet_entries where contractor_id = v_cid and status = 'open') then
    return 'error:already_started';
  end if;

  insert into public.timesheet_entries (contractor_id, work_order_id, work_date, started_at, source)
  values (v_cid, v_wo, v_today, now(), 'painter')
  returning id into v_id;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.timesheet_start(uuid) to authenticated;

-- Finish day: closes the open entry with a break and submits it for approval.
-- Anything under a minute of work is refused — a mis-tap, not a day.
create or replace function public.timesheet_finish(p_break_minutes integer default 30)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v public.timesheet_entries%rowtype; v_hours numeric;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_painter'; end if;
  if p_break_minutes is null or p_break_minutes < 0 or p_break_minutes > 240 then return 'error:bad_break'; end if;
  select * into v from public.timesheet_entries where contractor_id = v_cid and status = 'open' for update;
  if not found then return 'error:not_started'; end if;
  if now() - v.started_at > interval '16 hours' then
    -- Left running overnight: close it at 16 h and let the office fix it.
    update public.timesheet_entries
       set finished_at = v.started_at + interval '16 hours', break_minutes = p_break_minutes, status = 'submitted'
     where id = v.id;
    return 'ok:16';
  end if;
  v_hours := public.timesheet_hours(v.started_at, now(), p_break_minutes);
  if v_hours is null or v_hours <= 0 then return 'error:too_short'; end if;
  update public.timesheet_entries
     set finished_at = now(), break_minutes = p_break_minutes, status = 'submitted'
   where id = v.id;
  return 'ok:' || v_hours::text;
end $$;
grant execute on function public.timesheet_finish(integer) to authenticated;

-- ---- 6. the office --------------------------------------------------------------
-- Record a day on the painter's behalf (a forgotten tap, a paper sheet).
-- Source 'pc'; lands submitted, so approval is still a separate act.
create or replace function public.timesheet_record(
  p_contractor_id uuid, p_work_order_id uuid, p_started_at timestamptz, p_finished_at timestamptz, p_break_minutes integer default 30
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select employment_type into v_type from public.contractors where id = p_contractor_id;
  if v_type is null then return 'error:not_found'; end if;
  if v_type <> 'employee' then return 'error:not_an_employee'; end if;
  if not public.wo_painter_on_job(p_work_order_id, p_contractor_id) then return 'error:not_on_job'; end if;
  if p_started_at is null or p_finished_at is null or p_finished_at <= p_started_at then return 'error:bad_span'; end if;
  if p_finished_at - p_started_at > interval '16 hours' then return 'error:too_long'; end if;
  if p_break_minutes is null or p_break_minutes < 0 or p_break_minutes > 240 then return 'error:bad_break'; end if;
  if public.timesheet_hours(p_started_at, p_finished_at, p_break_minutes) <= 0 then return 'error:too_short'; end if;
  insert into public.timesheet_entries (contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status)
  values (p_contractor_id, p_work_order_id, (p_started_at at time zone 'Australia/Melbourne')::date,
          p_started_at, p_finished_at, p_break_minutes, 'pc', 'submitted')
  returning id into v_id;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.timesheet_record(uuid, uuid, timestamptz, timestamptz, integer) to authenticated;

-- Approve: hours × the rate on the work day → ONE labour line on the job,
-- status approved, GST 0, paid 'account'. Refuses without a rate — an
-- unpriced line would silently understate the job. Idempotent on approved.
create or replace function public.timesheet_approve(p_entry_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.timesheet_entries%rowtype; v_rate integer; v_hours numeric; v_cents integer; v_name text; v_cost uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.timesheet_entries where id = p_entry_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'approved' then return 'ok:' || coalesce(v.job_cost_id::text, ''); end if;
  if v.status <> 'submitted' then return 'error:not_submitted'; end if;
  v_rate := public.employee_cost_rate_on(v.contractor_id, v.work_date);
  if v_rate is null then return 'error:no_rate'; end if;
  v_hours := public.timesheet_hours(v.started_at, v.finished_at, v.break_minutes);
  if v_hours is null or v_hours <= 0 then return 'error:too_short'; end if;
  v_cents := round(v_hours * v_rate)::integer;
  select coalesce(nullif(trim(p.name), ''), 'Employee') into v_name
    from public.contractors c left join public.profiles p on p.id = c.profile_id where c.id = v.contractor_id;

  insert into public.job_costs
    (work_order_id, category, description, amount_ex_cents, gst_cents, status, recorded_by, paid_with, approved_at, approved_by)
  values
    (v.work_order_id, 'labour',
     'Labour — ' || v_name || ' · ' || to_char(v.work_date, 'DD Mon') || ' · ' || trim(to_char(v_hours, 'FM9990.00')) || ' h',
     v_cents, 0, 'approved', auth.uid(), 'account', now(), auth.uid())
  returning id into v_cost;

  update public.timesheet_entries
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), job_cost_id = v_cost
   where id = v.id;
  return 'ok:' || v_cost::text;
end $$;
grant execute on function public.timesheet_approve(uuid) to authenticated;

create or replace function public.timesheet_reject(p_entry_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.timesheet_entries%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.timesheet_entries where id = p_entry_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'approved' then return 'error:already_approved'; end if;
  if v.status = 'open' then return 'error:still_open'; end if;
  update public.timesheet_entries set status = 'rejected', rejected_reason = left(coalesce(p_reason, ''), 300) where id = v.id;
  return 'ok:rejected';
end $$;
grant execute on function public.timesheet_reject(uuid, text) to authenticated;

-- The cost rate: one row per effective day, later rows supersede. Logged as
-- a contractor_event (the amount stays on the rate table, not in the event).
create or replace function public.set_employee_cost_rate(p_contractor_id uuid, p_cents_per_hour integer, p_effective_from date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_type text; v_from date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_cents_per_hour is null or p_cents_per_hour <= 0 or p_cents_per_hour >= 100000 then return 'error:bad_rate'; end if;
  select employment_type into v_type from public.contractors where id = p_contractor_id;
  if v_type is null then return 'error:not_found'; end if;
  if v_type <> 'employee' then return 'error:not_an_employee'; end if;
  v_from := coalesce(p_effective_from, (now() at time zone 'Australia/Melbourne')::date);
  insert into public.employee_cost_rates (contractor_id, cents_per_hour, effective_from, created_by)
  values (p_contractor_id, p_cents_per_hour, v_from, auth.uid())
  on conflict (contractor_id, effective_from) do update
    set cents_per_hour = excluded.cents_per_hour, created_by = excluded.created_by, created_at = now();
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (p_contractor_id, 'cost_rate_set', jsonb_build_object('effective_from', v_from), auth.uid());
  return 'ok:' || v_from::text;
end $$;
grant execute on function public.set_employee_cost_rate(uuid, integer, date) to authenticated;

-- ---- 7. read-back ------------------------------------------------------------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'timesheet_entries') = 2 as timesheet_policies_ok,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'employee_cost_rates') = 1 as rate_policies_ok,
  exists (select 1 from pg_indexes where indexname = 'timesheet_entries_one_open') as one_open_ok,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'job_cost_category' and e.enumlabel = 'labour') as labour_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('timesheet_hours', 'employee_cost_rate_on', 'timesheet_start', 'timesheet_finish', 'timesheet_record',
                       'timesheet_approve', 'timesheet_reject', 'set_employee_cost_rate')) = 8 as functions_ok,
  public.timesheet_hours('2026-09-17 07:00+10'::timestamptz, '2026-09-17 15:06+10'::timestamptz, 30) = 7.60 as hours_ok,
  not has_table_privilege('authenticated', 'public.timesheet_entries', 'insert')
    and not has_table_privilege('authenticated', 'public.employee_cost_rates', 'insert') as no_client_writes_ok;

insert into public._prod_migrations(name) values ('20270163000000_timesheets.sql') on conflict (name) do nothing;
