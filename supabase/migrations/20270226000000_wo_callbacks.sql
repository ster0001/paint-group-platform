-- =============================================================================
-- 20270226 · Call backs: one record, four ways in (brief: standards / status /
-- call backs, Step 3; rulings C1–C11, ⚑15, ⚑22)
--
-- A call back is a return visit on another day to fix workmanship (C1). There
-- was no way to log one. This makes ONE record type — wo_callbacks — that every
-- route creates: a failed quality check that cannot be fixed today (qc_fail), a
-- flagged final walk-through (walkthrough_fail), the customer ringing after
-- sign-off (customer_call), and a scheduler visit ticked as a call back
-- (scheduler). Every row carries a reason (workmanship by default; the PC can
-- change it — only workmanship ever counts against the painter, C5) and the
-- date it was reported (C6), and names the painter who did the job even when
-- someone else is booked to fix it (C7).
--
-- Lifecycle: open → booked (a wo_appointments return visit) → fixed (the
-- painter, with a photo) → done (the PC confirms and closes — only that ends
-- it, ⚑22); void is the owner's (⚑15). An open call back pauses the customer's
-- invoice chasing (C10) through the existing hold column, with a KIND so a
-- close clears only what a call back set and never a staff dispute hold. It
-- never reopens a closed work order and never touches the painter's pay (C11).
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the record ------------------------------------------------------------
do $$ begin
  create type public.wo_callback_source as enum ('qc_fail', 'walkthrough_fail', 'customer_call', 'scheduler');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_callback_reason as enum ('workmanship', 'not_workmanship');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_callback_status as enum ('open', 'booked', 'fixed', 'done', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.wo_callbacks (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.work_orders (id) on delete cascade,
  -- Who did the job (C7): the lead assignment, else the work order's contractor.
  painter_id          uuid not null references public.contractors (id) on delete restrict,
  -- Who is booked to fix it — the same painter unless the office says otherwise.
  fixed_by_painter_id uuid references public.contractors (id) on delete set null,
  source              public.wo_callback_source not null,
  reason              public.wo_callback_reason not null default 'workmanship',
  reported_on         date not null default current_date,
  description         text not null default '',
  status              public.wo_callback_status not null default 'open',
  appointment_id      uuid references public.wo_appointments (id) on delete set null,
  qa_check_id         uuid references public.wo_qa_checks (id) on delete set null,
  fixed_at            timestamptz,
  fixed_note          text not null default '',
  closed_at           timestamptz,
  closed_by           uuid references auth.users (id) on delete set null,
  closed_note         text not null default '',
  voided_at           timestamptz,
  voided_by           uuid references auth.users (id) on delete set null,
  void_reason         text not null default '',
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint wo_callbacks_description_len check (char_length(description) <= 2000)
);
create index if not exists wo_callbacks_open_idx on public.wo_callbacks (work_order_id) where status in ('open', 'booked', 'fixed');
create index if not exists wo_callbacks_painter_idx on public.wo_callbacks (painter_id, status);
create index if not exists wo_callbacks_fixer_idx on public.wo_callbacks (fixed_by_painter_id) where fixed_by_painter_id is not null;

-- Photos of what is wrong, and of the fix: the painter's existing uploads,
-- linked by id the way a variation's are (wo_raise_variation).
alter type public.wo_photo_kind add value if not exists 'callback';
alter table public.wo_photos add column if not exists callback_id uuid references public.wo_callbacks (id) on delete set null;
create index if not exists wo_photos_callback_idx on public.wo_photos (callback_id) where callback_id is not null;

-- C10: which hold a call back set, so closing clears only that.
alter table public.invoices add column if not exists chase_hold_kind text check (chase_hold_kind in ('call_back', 'office'));

-- The walk-through's outcome, on the one sign-off row (brief §5):
-- passed | passed_after_fix (C3) | failed_callback (route 2).
alter table public.wo_signoff add column if not exists outcome text check (outcome in ('passed', 'passed_after_fix', 'failed_callback'));

-- ---- 2. RLS ---------------------------------------------------------------------
alter table public.wo_callbacks enable row level security;
drop policy if exists wo_callbacks_staff on public.wo_callbacks;
create policy wo_callbacks_staff on public.wo_callbacks
  for select to authenticated using (public.is_staff());
-- The painter it is about, and the painter booked to fix it, read it. Customers: nothing.
drop policy if exists wo_callbacks_painter_read on public.wo_callbacks;
create policy wo_callbacks_painter_read on public.wo_callbacks
  for select to authenticated
  using (painter_id = public.current_contractor_id() or fixed_by_painter_id = public.current_contractor_id());
revoke all on public.wo_callbacks from anon;
revoke insert, update, delete on public.wo_callbacks from authenticated;
grant select on public.wo_callbacks to authenticated;

-- The painter a call back is about sees its return visit on their job even
-- when someone else is booked to make it (C7): wo_appointments was own-rows
-- only (20270209); a painter on the job now reads every visit on that job.
drop policy if exists wo_appointments_job_painter_read on public.wo_appointments;
create policy wo_appointments_job_painter_read on public.wo_appointments
  for select to authenticated using (public.wo_painter_on_job(work_order_id, public.current_contractor_id()));

-- A painter booked on a return visit is on the job for photos and reads
-- (wo_painter_on_job is what the photo and surface policies ask).
create or replace function public.wo_painter_on_job(p_work_order_id uuid, p_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_contractor_id is not null and (
    exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.contractor_id = p_contractor_id)
    or exists (select 1 from public.wo_assignments a
                where a.work_order_id = p_work_order_id and a.contractor_id = p_contractor_id and a.status <> 'released')
    or exists (select 1 from public.wo_appointments ap
                where ap.work_order_id = p_work_order_id and ap.contractor_id = p_contractor_id)
  )
$$;

-- ---- 3. the walk-through outcome, derived at signing -----------------------------
create or replace function public.wo_signoff_set_outcome()
returns trigger language plpgsql as $$
begin
  if new.signed_at is not null and (old.signed_at is null or new.outcome is null) then
    if new.signed_kind = 'rectified'
       or exists (select 1 from jsonb_each(coalesce(new.areas, '{}'::jsonb)) a
                   where a.value ? 'rectified_at' or a.value ? 'flag_withdrawn_at') then
      new.outcome := 'passed_after_fix';
    elsif new.outcome is distinct from 'failed_callback' then
      new.outcome := 'passed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t_wo_signoff_outcome on public.wo_signoff;
create trigger t_wo_signoff_outcome before update on public.wo_signoff
  for each row execute function public.wo_signoff_set_outcome();

-- ---- 4. helpers -----------------------------------------------------------------
-- Who did the job (C7): the lead painter on an assigned job, else the contractor.
create or replace function public.wo_callback_painter(p_work_order_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.contractor_id from public.wo_assignments a
      where a.work_order_id = p_work_order_id and a.is_lead and a.status <> 'released' limit 1),
    (select w.contractor_id from public.work_orders w where w.id = p_work_order_id));
$$;

-- C10: pause the customer's invoice chasing while a call back is open.
create or replace function public.wo_callback_hold(p_work_order_id uuid, p_on boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare v_est uuid; v_n integer := 0;
begin
  select estimate_id into v_est from public.work_orders where id = p_work_order_id;
  if p_on then
    update public.invoices
       set chase_hold_reason = 'Call back open — chasing paused until it is closed', chase_hold_kind = 'call_back'
     where (work_order_id = p_work_order_id or estimate_id = v_est)
       and status not in ('paid', 'void', 'draft') and chase_hold_reason is null;
    get diagnostics v_n = row_count;
  elsif not exists (select 1 from public.wo_callbacks c
                     where c.work_order_id = p_work_order_id and c.status in ('open', 'booked', 'fixed')) then
    update public.invoices
       set chase_hold_reason = null, chase_hold_kind = null
     where (work_order_id = p_work_order_id or estimate_id = v_est) and chase_hold_kind = 'call_back';
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end $$;

-- ---- 5. the four ways in: one function ------------------------------------------
create or replace function public.wo_callback_log(
  p_work_order_id uuid,
  p_source text,
  p_reason text default 'workmanship',
  p_reported_on date default null,
  p_description text default '',
  p_photo_ids uuid[] default '{}',
  p_return_start date default null,
  p_return_end date default null,
  p_fixed_by uuid default null,
  p_qa_check_id uuid default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_painter uuid; v_fixer uuid; v_id uuid; v_appt uuid; v_open uuid; v_held integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_source not in ('qc_fail', 'walkthrough_fail', 'customer_call', 'scheduler') then return 'error:bad_source'; end if;
  if p_reason not in ('workmanship', 'not_workmanship') then return 'error:bad_reason'; end if;
  if p_return_start is not null and p_return_end is not null and p_return_end < p_return_start then return 'error:bad_dates'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  v_painter := public.wo_callback_painter(p_work_order_id);
  if v_painter is null then return 'error:no_painter'; end if;
  v_fixer := coalesce(p_fixed_by, v_painter);
  if not exists (select 1 from public.contractors where id = v_fixer) then return 'error:fixer_not_found'; end if;

  -- Route 4 (C2): a visit ticked as a call back on a job with one already open
  -- JOINS it — never a second record.
  if p_source = 'scheduler' then
    select id into v_open from public.wo_callbacks
     where work_order_id = p_work_order_id and status in ('open', 'booked', 'fixed')
     order by created_at limit 1;
  end if;

  if v_open is not null then
    v_id := v_open;
  else
    insert into public.wo_callbacks (work_order_id, painter_id, fixed_by_painter_id, source, reason, reported_on, description, qa_check_id, created_by)
    values (p_work_order_id, v_painter, v_fixer, p_source::public.wo_callback_source, p_reason::public.wo_callback_reason,
            coalesce(p_reported_on, current_date), coalesce(left(p_description, 2000), ''), p_qa_check_id, auth.uid())
    returning id into v_id;
  end if;

  -- The return visit, in the fixer's scheduler (C8). The job may be CLOSED —
  -- that is the point — so this writes the visit itself rather than through
  -- schedule_add_appointment's stage check.
  if p_return_start is not null then
    insert into public.wo_appointments (work_order_id, contractor_id, start_date, end_date, note, created_by)
    values (p_work_order_id, v_fixer, p_return_start, coalesce(p_return_end, p_return_start),
            left('Call back' || case when coalesce(p_description, '') <> '' then ' — ' || p_description else '' end, 300), auth.uid())
    returning id into v_appt;
    update public.wo_callbacks set appointment_id = v_appt, fixed_by_painter_id = v_fixer,
           status = case when status = 'open' then 'booked' else status end
     where id = v_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'appointment_added', auth.uid(), 'staff',
            jsonb_build_object('appointment_id', v_appt, 'contractor_id', v_fixer, 'start_date', p_return_start,
                               'end_date', coalesce(p_return_end, p_return_start), 'callback_id', v_id));
  end if;

  if array_length(p_photo_ids, 1) > 0 then
    update public.wo_photos set callback_id = v_id
     where id = any (p_photo_ids) and work_order_id = p_work_order_id;
  end if;

  if p_source = 'walkthrough_fail' then
    update public.wo_signoff set outcome = 'failed_callback' where work_order_id = p_work_order_id and signed_at is null;
  end if;

  v_held := public.wo_callback_hold(p_work_order_id, true);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, case when v_open is not null then 'callback_visit_attached' else 'callback_logged' end, auth.uid(), 'staff',
          jsonb_build_object('callback_id', v_id, 'source', p_source, 'reason', p_reason,
                             'reported_on', coalesce(p_reported_on, current_date), 'painter_id', v_painter,
                             'fixed_by', v_fixer, 'appointment_id', v_appt, 'qa_check_id', p_qa_check_id,
                             'invoices_held', v_held));
  if v_open is null then
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_painter, 'callback_logged', jsonb_build_object('callback_id', v_id, 'work_order_id', p_work_order_id,
                                                              'source', p_source, 'reason', p_reason), auth.uid());
  end if;
  return 'ok:' || v_id || case when v_open is not null then ':attached' else '' end;
end $$;
revoke all on function public.wo_callback_log(uuid, text, text, date, text, uuid[], date, date, uuid, uuid) from public, anon;
grant execute on function public.wo_callback_log(uuid, text, text, date, text, uuid[], date, date, uuid, uuid) to authenticated;

-- ---- 6. book / re-book the return visit ---------------------------------------
create or replace function public.wo_callback_book(p_callback_id uuid, p_start date, p_end date default null, p_fixed_by uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_callbacks%rowtype; v_fixer uuid; v_appt uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;
  if p_end is not null and p_end < p_start then return 'error:bad_dates'; end if;
  select * into v from public.wo_callbacks where id = p_callback_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status in ('done', 'void') then return 'error:closed'; end if;
  v_fixer := coalesce(p_fixed_by, v.fixed_by_painter_id, v.painter_id);
  if v.appointment_id is not null then
    update public.wo_appointments set start_date = p_start, end_date = coalesce(p_end, p_start), contractor_id = v_fixer
     where id = v.appointment_id returning id into v_appt;
  end if;
  if v_appt is null then
    insert into public.wo_appointments (work_order_id, contractor_id, start_date, end_date, note, created_by)
    values (v.work_order_id, v_fixer, p_start, coalesce(p_end, p_start),
            left('Call back' || case when v.description <> '' then ' — ' || v.description else '' end, 300), auth.uid())
    returning id into v_appt;
  end if;
  update public.wo_callbacks set appointment_id = v_appt, fixed_by_painter_id = v_fixer,
         status = case when status = 'open' then 'booked' else status end
   where id = p_callback_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v.work_order_id, 'callback_booked', auth.uid(), 'staff',
          jsonb_build_object('callback_id', p_callback_id, 'appointment_id', v_appt, 'fixed_by', v_fixer,
                             'start_date', p_start, 'end_date', coalesce(p_end, p_start)));
  return 'ok:booked';
end $$;
revoke all on function public.wo_callback_book(uuid, date, date, uuid) from public, anon;
grant execute on function public.wo_callback_book(uuid, date, date, uuid) to authenticated;

-- ---- 7. the painter marks it fixed, with a photo (⚑22) -------------------------
create or replace function public.wo_callback_mark_fixed(p_callback_id uuid, p_note text default '', p_photo_ids uuid[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_callbacks%rowtype; v_cid uuid;
begin
  select * into v from public.wo_callbacks where id = p_callback_id for update;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if not (public.is_staff() or v_cid in (v.painter_id, v.fixed_by_painter_id)) then return 'error:not_yours'; end if;
  if v.status in ('done', 'void') then return 'error:closed'; end if;
  if v.status = 'fixed' then return 'ok:already'; end if;
  if array_length(p_photo_ids, 1) is null and not public.is_staff() then return 'error:photo_required'; end if;
  update public.wo_photos set callback_id = p_callback_id
   where id = any (coalesce(p_photo_ids, '{}')) and work_order_id = v.work_order_id;
  update public.wo_callbacks set status = 'fixed', fixed_at = now(), fixed_note = coalesce(left(p_note, 1000), '')
   where id = p_callback_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v.work_order_id, 'callback_fixed', auth.uid(), case when public.is_staff() then 'staff' else 'contractor' end,
          jsonb_build_object('callback_id', p_callback_id, 'by', v_cid, 'photos', coalesce(array_length(p_photo_ids, 1), 0)));
  return 'ok:fixed';
end $$;
revoke all on function public.wo_callback_mark_fixed(uuid, text, uuid[]) from public, anon;
grant execute on function public.wo_callback_mark_fixed(uuid, text, uuid[]) to authenticated;

-- ---- 8. the PC confirms and closes — the only thing that ends it (⚑22) ----------
create or replace function public.wo_callback_close(p_callback_id uuid, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_callbacks%rowtype; v_released integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.wo_callbacks where id = p_callback_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status in ('done', 'void') then return 'error:closed'; end if;
  update public.wo_callbacks set status = 'done', closed_at = now(), closed_by = auth.uid(), closed_note = coalesce(left(p_note, 1000), '')
   where id = p_callback_id;
  v_released := public.wo_callback_hold(v.work_order_id, false);
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v.work_order_id, 'callback_closed', auth.uid(), 'staff',
          jsonb_build_object('callback_id', p_callback_id, 'was', v.status, 'invoices_released', v_released));
  return 'ok:done';
end $$;
revoke all on function public.wo_callback_close(uuid, text) from public, anon;
grant execute on function public.wo_callback_close(uuid, text) to authenticated;

-- ---- 9. the PC changes the reason (⚑15) -------------------------------------------
create or replace function public.wo_callback_set_reason(p_callback_id uuid, p_reason text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_callbacks%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_reason not in ('workmanship', 'not_workmanship') then return 'error:bad_reason'; end if;
  select * into v from public.wo_callbacks where id = p_callback_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'void' then return 'error:closed'; end if;
  if v.reason::text = p_reason then return 'ok:unchanged'; end if;
  update public.wo_callbacks set reason = p_reason::public.wo_callback_reason where id = p_callback_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v.work_order_id, 'callback_reason_changed', auth.uid(), 'staff',
          jsonb_build_object('callback_id', p_callback_id, 'from', v.reason, 'to', p_reason, 'note', coalesce(p_note, '')));
  return 'ok:' || p_reason;
end $$;
revoke all on function public.wo_callback_set_reason(uuid, text, text) from public, anon;
grant execute on function public.wo_callback_set_reason(uuid, text, text) to authenticated;

-- ---- 10. only the owner voids one logged in error (⚑15) ---------------------------
create or replace function public.wo_callback_void(p_callback_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_callbacks%rowtype; v_released integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not public.has_dashboard_role('owner') then return 'error:not_owner'; end if;
  if coalesce(trim(p_reason), '') = '' then return 'error:reason_required'; end if;
  select * into v from public.wo_callbacks where id = p_callback_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'void' then return 'ok:already'; end if;
  update public.wo_callbacks set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(p_reason, 1000)
   where id = p_callback_id;
  v_released := public.wo_callback_hold(v.work_order_id, false);
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v.work_order_id, 'callback_voided', auth.uid(), 'staff',
          jsonb_build_object('callback_id', p_callback_id, 'was', v.status, 'reason', p_reason, 'invoices_released', v_released));
  return 'ok:void';
end $$;
revoke all on function public.wo_callback_void(uuid, text) from public, anon;
grant execute on function public.wo_callback_void(uuid, text) to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'wo_callbacks') as table_made, 1 as _expect_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wo_callbacks') as policies, 2 as _expect_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wo_appointments' and policyname = 'wo_appointments_job_painter_read') as visit_read, 1 as _expect_visit_read,
  has_table_privilege('authenticated', 'public.wo_callbacks', 'insert') as auth_can_insert, false as _expect_no_insert,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('wo_callback_log','wo_callback_book','wo_callback_mark_fixed','wo_callback_close','wo_callback_set_reason','wo_callback_void','wo_callback_hold','wo_callback_painter','wo_signoff_set_outcome')) as functions, 9 as _expect_functions,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and (table_name, column_name) in (('wo_photos','callback_id'), ('invoices','chase_hold_kind'), ('wo_signoff','outcome'))) as new_columns, 3 as _expect_columns,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'wo_photo_kind' and e.enumlabel = 'callback') as photo_kind, true as _expect_photo_kind,
  (select count(*) from pg_trigger where tgname = 't_wo_signoff_outcome') as outcome_trigger, 1 as _expect_trigger,
  (select position('wo_appointments' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wo_painter_on_job') as visit_painter_on_job, true as _expect_on_job;

insert into public._prod_migrations(name) values ('20270226000000_wo_callbacks.sql') on conflict (name) do nothing;
