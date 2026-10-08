-- =============================================================================
-- Tom, 7 Oct 2026 — two rulings in one paste.
--
-- CRM · "If a job is accepted, remove all follow-ups from the CRM automatically."
--   The follow-up reminder a staff member sets on a customer (accounts.followup_due_at /
--   followup_note) and a snooze (snoozed_until) survived the estimate being accepted,
--   so Today kept asking the office to chase a customer who had already said yes.
--   estimates_crm_lifecycle (20270152 body) now clears both the moment an estimate
--   turns accepted — every acceptance path runs through the trigger, token page,
--   portal and staff alike. The derived follow-ups (a sent quote gone quiet, a callback,
--   an online estimate) are suppressed in lib/crm/work-queue.ts against the account's
--   latest acceptance; nothing is stored for those.
--   Backfill: a reminder set BEFORE the customer's acceptance is cleared now; one set
--   after it (e.g. "ring about the start date") is kept — the followup_set event dates it.
--
-- Timesheets · "These don't need to be approved — approve them automatically for now,
--   they get paid a salary for an 8 hour day."
--   timesheet_auto_approve  helper, NO grant: the 20270163 approve body without the
--                           staff check; approved_by stays null = approved by the rule.
--                           A day no cost rate covers stays 'submitted' so the labour
--                           is never silently lost — the office approves it by hand
--                           once the rate is in (timesheet_approve is unchanged).
--   timesheet_finish / timesheet_record / timesheet_autofill / timesheet_extra
--                           their live bodies (20270163, 20270166) plus one line: the
--                           row they insert is auto-approved. A day left running
--                           overnight (closed at 16 h) still waits for the office.
--
-- Converges on a re-run: or-replace throughout, guarded backfill, idempotent grants.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. acceptance clears the account's reminder and snooze -------------------
create or replace function public.estimates_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fresh boolean := (tg_op = 'INSERT') or (old.account_id is null);
        v_total integer := coalesce(new.accepted_total_cents, new.total_cents, 0);
begin
  -- Import (20270152): the loader writes the historical events itself, with
  -- their real dates. Nothing here may stamp now() on a 2025 acceptance.
  if current_setting('crm.import', true) = 'on' then return new; end if;
  if new.account_id is null then return new; end if;

  if (new.sent_at is not null or new.status in ('sent', 'accepted', 'declined', 'expired'))
     and (v_fresh or (old.sent_at is null and old.status = 'draft')) then
    perform public.crm_emit('estimate_sent', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0), 'channel', 'link',
                         'validDays', case when new.valid_until is not null and new.sent_at is not null then greatest((new.valid_until - new.sent_at::date), 1) end),
      'system', coalesce(new.sent_at, new.created_at), new.id, null, null, 'estimate_sent:' || new.id);
  end if;

  if new.status = 'accepted' and (v_fresh or old.status is distinct from 'accepted') then
    perform public.crm_emit('estimate_accepted', new.account_id,
      jsonb_build_object('totalCents', greatest(v_total, 0)),
      'customer', coalesce(new.accepted_at, now()), new.id, null, null, 'estimate_accepted:' || new.id);
    -- Tom, 7 Oct 2026: a job accepted is a follow-up answered. The office's
    -- reminder and any snooze on the customer go with it.
    update public.accounts
       set followup_due_at = null, followup_note = null, snoozed_until = null
     where id = new.account_id
       and (followup_due_at is not null or followup_note is not null or snoozed_until is not null);
  end if;

  if new.status = 'declined' and (v_fresh or old.status is distinct from 'declined') then
    perform public.crm_emit('estimate_declined', new.account_id,
      case when nullif(trim(coalesce(new.declined_reason, '')), '') is null then '{}'::jsonb
           else jsonb_build_object('reason', left(new.declined_reason, 2000)) end,
      'customer', coalesce(new.declined_at, now()), new.id, null, null, 'estimate_declined:' || new.id);
  end if;

  if new.status = 'expired' and (v_fresh or old.status is distinct from 'expired') then
    perform public.crm_emit('estimate_lapsed', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0),
                         'sentAt', new.sent_at, 'validUntil', new.valid_until),
      'system', now(), new.id, null, null, 'estimate_lapsed:' || new.id);
  end if;

  if new.viewed_at is not null and (v_fresh or old.viewed_at is null)
     and not exists (select 1 from public.estimate_views v where v.estimate_id = new.id) then
    perform public.crm_emit('estimate_viewed', new.account_id,
      jsonb_build_object('viewNumber', 1),
      'customer', new.viewed_at, new.id, null, null, 'estimate_viewed:' || new.id || ':first');
  end if;

  return new;
end $$;

-- Backfill: reminders set before an acceptance that has since happened.
-- (the SQL editor commits statement by statement, so no `on commit drop` — dropped after the read-back)
drop table if exists _followups_cleared; create temp table _followups_cleared (account_id uuid);
with latest_set as (
  select account_id, max(occurred_at) as set_at
    from public.crm_events where type = 'followup_set' group by account_id
), latest_accept as (
  select account_id, max(coalesce(accepted_at, created_at)) as accepted_at
    from public.estimates where status = 'accepted' and account_id is not null group by account_id
), cleared as (
  update public.accounts a
     set followup_due_at = null, followup_note = null
    from latest_set s, latest_accept x
   where a.id = s.account_id and a.id = x.account_id
     and a.followup_due_at is not null
     and x.accepted_at > s.set_at
  returning a.id
)
insert into _followups_cleared select id from cleared;

-- ---- 2. the rule approves a day -----------------------------------------------
create or replace function public.timesheet_auto_approve(p_entry_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.timesheet_entries%rowtype; v_rate integer; v_hours numeric; v_cents integer; v_name text; v_cost uuid;
begin
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
     v_cents, 0, 'approved', null, 'account', now(), null)
  returning id into v_cost;

  -- approved_by null = approved by the rule (Tom, 7 Oct 2026), not by a person.
  update public.timesheet_entries
     set status = 'approved', approved_by = null, approved_at = now(), job_cost_id = v_cost
   where id = v.id;
  return 'ok:' || v_cost::text;
end $$;
revoke execute on function public.timesheet_auto_approve(uuid) from public, anon, authenticated;

-- ---- 3. every writer approves what it submits ---------------------------------
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
  perform public.timesheet_auto_approve(v.id);
  return 'ok:' || v_hours::text;
end $$;
grant execute on function public.timesheet_finish(integer) to authenticated;

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
  perform public.timesheet_auto_approve(v_id);
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.timesheet_record(uuid, uuid, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.timesheet_autofill(p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_day date; v_n integer := 0; v_skipped integer := 0; d record; a record; v_id uuid;
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
    values (a.contractor_id, a.work_order_id, v_day, v_start, v_finish, d.break_minutes, 'auto', 'submitted')
    returning id into v_id;
    perform public.timesheet_auto_approve(v_id);
    v_n := v_n + 1;
  end loop;
  return 'ok:' || v_n || case when v_skipped > 0 then ':manual:' || v_skipped else '' end;
end $$;
revoke execute on function public.timesheet_autofill(date) from public, anon;
grant execute on function public.timesheet_autofill(date) to authenticated, service_role;

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
  perform public.timesheet_auto_approve(v_id);
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.timesheet_extra(uuid, date, time, time, text) to authenticated;

-- ---- 4. the days already waiting are approved now, where a rate covers them ---
-- (a day with no rate stays submitted — same as a new one.)
drop table if exists _timesheets_auto; create temp table _timesheets_auto (entry_id uuid, result text);
insert into _timesheets_auto
select t.id, public.timesheet_auto_approve(t.id)
  from public.timesheet_entries t where t.status = 'submitted' order by t.work_date;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select prosrc like '%followup_due_at = null%' from pg_proc where proname = 'estimates_crm_lifecycle') as accept_clears_followup, true as _expect_accept_clears_followup,
  (select count(*) from _followups_cleared) as reminders_cleared_now,
  (select has_function_privilege('authenticated', 'public.timesheet_auto_approve(uuid)', 'execute')) as auto_approve_not_granted, false as _expect_auto_approve_not_granted,
  (select count(*) from pg_proc where proname in ('timesheet_finish','timesheet_record','timesheet_autofill','timesheet_extra') and prosrc like '%timesheet_auto_approve%') as writers_auto_approving, 4 as _expect_writers_auto_approving,
  (select has_function_privilege('authenticated', 'public.timesheet_finish(integer)', 'execute')) as finish_granted, true as _expect_finish_granted,
  (select has_function_privilege('service_role', 'public.timesheet_autofill(date)', 'execute')) as autofill_system_granted, true as _expect_autofill_system_granted,
  (select count(*) from _timesheets_auto where result like 'ok:%') as waiting_days_approved_now,
  (select count(*) from _timesheets_auto where result = 'error:no_rate') as waiting_days_still_no_rate;

drop table if exists _followups_cleared; drop table if exists _timesheets_auto;

insert into public._prod_migrations(name) values ('20270219000000_accept_clears_followups_timesheets_auto_approve.sql') on conflict (name) do nothing;
