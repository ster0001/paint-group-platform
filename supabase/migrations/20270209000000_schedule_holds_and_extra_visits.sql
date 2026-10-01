-- =============================================================================
-- Two asks from Tom on the scheduling board (1 Oct 2026):
--
--   1. "Drag an empty space to add an appointment which has already been added
--      to the calendar a 2nd time" — a painter booked Mon–Fri fits a small job
--      in on Wednesday, so the big job needs a SECOND run of days. Today a job
--      is one span (booking_offers / wo_assignments / work_orders.start_date);
--      there was nowhere to put a second visit.
--   2. "Reserve a space in the calendar internally" — hold a painter's days
--      while the client is still deciding, bright pink, as a reminder that
--      something has to happen with it (book it or let it go).
--
-- Two small tables, no change to the booking state machine:
--
--   wo_appointments  — an EXTRA visit on a job this painter is already on.
--                      Shown on the board in the job's own colour, and in the
--                      painter's portal calendar (they can read their own).
--   schedule_holds   — an internal, staff-only reservation of a painter's days,
--                      optionally pointing at the job it is waiting on. Pink.
--                      The painter never sees a hold.
--
-- Writes go through small definer RPCs (staff only), so a browser can never
-- add a visit to a job the painter is not on, and so every change is logged
-- on wo_events where there is a job to log it on.
--
-- Converges on a re-run. Paste starts with a lock timeout so a busy table
-- fails loudly instead of deadlocking.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. tables ----------------------------------------------------------------
create table if not exists public.wo_appointments (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  note          text not null default '',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint wo_appointments_range check (end_date >= start_date),
  constraint wo_appointments_note_len check (char_length(note) <= 300)
);
create index if not exists wo_appointments_contractor_idx on public.wo_appointments (contractor_id, start_date);
create index if not exists wo_appointments_wo_idx on public.wo_appointments (work_order_id);

create table if not exists public.schedule_holds (
  id              uuid primary key default gen_random_uuid(),
  contractor_id   uuid not null references public.contractors (id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  -- The job the client is still deciding on. Null = a lead with no work order yet; the note says what.
  work_order_id   uuid references public.work_orders (id) on delete cascade,
  note            text not null default '',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  released_at     timestamptz,
  released_reason text not null default '',
  constraint schedule_holds_range check (end_date >= start_date),
  constraint schedule_holds_note_len check (char_length(note) <= 300)
);
create index if not exists schedule_holds_contractor_idx on public.schedule_holds (contractor_id, start_date) where released_at is null;
create index if not exists schedule_holds_wo_idx on public.schedule_holds (work_order_id) where released_at is null;

-- ---- 2. RLS -------------------------------------------------------------------
alter table public.wo_appointments enable row level security;
alter table public.schedule_holds enable row level security;

drop policy if exists wo_appointments_staff on public.wo_appointments;
create policy wo_appointments_staff on public.wo_appointments
  for select to authenticated using (public.is_staff());

-- The painter reads their own extra visits — the portal calendar draws them.
drop policy if exists wo_appointments_own_read on public.wo_appointments;
create policy wo_appointments_own_read on public.wo_appointments
  for select to authenticated using (contractor_id = public.current_contractor_id());

-- A hold is INTERNAL (Tom): staff only, the painter has no policy at all.
drop policy if exists schedule_holds_staff on public.schedule_holds;
create policy schedule_holds_staff on public.schedule_holds
  for select to authenticated using (public.is_staff());

-- Reads under RLS; every write through the RPCs below.
revoke all on public.wo_appointments from anon;
revoke all on public.schedule_holds from anon;
revoke insert, update, delete on public.wo_appointments from authenticated;
revoke insert, update, delete on public.schedule_holds from authenticated;
grant select on public.wo_appointments to authenticated;
grant select on public.schedule_holds to authenticated;

-- ---- 3. extra visits ----------------------------------------------------------
-- The painter must already be ON the job: named on the work order, holding a
-- live or accepted offer for it, or assigned to it. Anything else is a new
-- booking, which is what the tray drop is for.
create or replace function public.schedule_add_appointment(
  p_work_order_id uuid,
  p_contractor_id uuid,
  p_start date,
  p_end date,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_on_job boolean;
  v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null or p_end is null then return 'error:no_start_date'; end if;
  if p_end < p_start then return 'error:bad_dates'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;

  select (v_wo.contractor_id = p_contractor_id)
      or exists (select 1 from public.booking_offers o
                  where o.work_order_id = p_work_order_id and o.contractor_id = p_contractor_id
                    and o.state in ('offered', 'proposed', 'accepted'))
      or exists (select 1 from public.wo_assignments a
                  where a.work_order_id = p_work_order_id and a.contractor_id = p_contractor_id
                    and a.status <> 'released')
    into v_on_job;
  if not coalesce(v_on_job, false) then return 'error:not_booked_on_job'; end if;

  insert into public.wo_appointments (work_order_id, contractor_id, start_date, end_date, note, created_by)
  values (p_work_order_id, p_contractor_id, p_start, p_end, coalesce(left(p_note, 300), ''), auth.uid())
  returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'appointment_added', auth.uid(), 'staff',
          jsonb_build_object('appointment_id', v_id, 'contractor_id', p_contractor_id,
                             'start_date', p_start, 'end_date', p_end, 'note', coalesce(p_note, '')));
  return 'ok:added';
end $$;
revoke all on function public.schedule_add_appointment(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.schedule_add_appointment(uuid, uuid, date, date, text) to authenticated;

create or replace function public.schedule_move_appointment(p_id uuid, p_start date, p_end date)
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_appointments%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null or p_end is null then return 'error:no_start_date'; end if;
  if p_end < p_start then return 'error:bad_dates'; end if;
  select * into v_a from public.wo_appointments where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_a.start_date = p_start and v_a.end_date = p_end then return 'ok:unchanged'; end if;
  update public.wo_appointments set start_date = p_start, end_date = p_end where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'appointment_moved', auth.uid(), 'staff',
          jsonb_build_object('appointment_id', p_id, 'contractor_id', v_a.contractor_id,
                             'from', jsonb_build_object('start_date', v_a.start_date, 'end_date', v_a.end_date),
                             'to', jsonb_build_object('start_date', p_start, 'end_date', p_end)));
  return 'ok:moved';
end $$;
revoke all on function public.schedule_move_appointment(uuid, date, date) from public, anon;
grant execute on function public.schedule_move_appointment(uuid, date, date) to authenticated;

create or replace function public.schedule_remove_appointment(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_appointments%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_a from public.wo_appointments where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  delete from public.wo_appointments where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'appointment_removed', auth.uid(), 'staff',
          jsonb_build_object('appointment_id', p_id, 'contractor_id', v_a.contractor_id,
                             'start_date', v_a.start_date, 'end_date', v_a.end_date));
  return 'ok:removed';
end $$;
revoke all on function public.schedule_remove_appointment(uuid) from public, anon;
grant execute on function public.schedule_remove_appointment(uuid) to authenticated;

-- ---- 4. holds -----------------------------------------------------------------
create or replace function public.schedule_hold_dates(
  p_contractor_id uuid,
  p_start date,
  p_end date,
  p_work_order_id uuid default null,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null or p_end is null then return 'error:no_start_date'; end if;
  if p_end < p_start then return 'error:bad_dates'; end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then return 'error:contractor_not_found'; end if;
  if p_work_order_id is not null and not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:work_order_not_found';
  end if;

  insert into public.schedule_holds (contractor_id, start_date, end_date, work_order_id, note, created_by)
  values (p_contractor_id, p_start, p_end, p_work_order_id, coalesce(left(p_note, 300), ''), auth.uid())
  returning id into v_id;

  if p_work_order_id is not null then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'dates_held', auth.uid(), 'staff',
            jsonb_build_object('hold_id', v_id, 'contractor_id', p_contractor_id,
                               'start_date', p_start, 'end_date', p_end, 'note', coalesce(p_note, '')));
  end if;
  return 'ok:held';
end $$;
revoke all on function public.schedule_hold_dates(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.schedule_hold_dates(uuid, date, date, uuid, text) to authenticated;

create or replace function public.schedule_move_hold(p_id uuid, p_start date, p_end date)
returns text language plpgsql security definer set search_path = public as $$
declare v_h public.schedule_holds%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null or p_end is null then return 'error:no_start_date'; end if;
  if p_end < p_start then return 'error:bad_dates'; end if;
  select * into v_h from public.schedule_holds where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_h.released_at is not null then return 'conflict:released'; end if;
  if v_h.start_date = p_start and v_h.end_date = p_end then return 'ok:unchanged'; end if;
  update public.schedule_holds set start_date = p_start, end_date = p_end where id = p_id;
  return 'ok:moved';
end $$;
revoke all on function public.schedule_move_hold(uuid, date, date) from public, anon;
grant execute on function public.schedule_move_hold(uuid, date, date) to authenticated;

create or replace function public.schedule_release_hold(p_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_h public.schedule_holds%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_h from public.schedule_holds where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_h.released_at is not null then return 'conflict:released'; end if;
  update public.schedule_holds
     set released_at = now(), released_reason = coalesce(left(p_reason, 300), '')
   where id = p_id;
  if v_h.work_order_id is not null then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_h.work_order_id, 'hold_released', auth.uid(), 'staff',
            jsonb_build_object('hold_id', p_id, 'contractor_id', v_h.contractor_id, 'reason', coalesce(p_reason, '')));
  end if;
  return 'ok:released';
end $$;
revoke all on function public.schedule_release_hold(uuid, text) from public, anon;
grant execute on function public.schedule_release_hold(uuid, text) to authenticated;

-- ---- 5. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wo_appointments') as appointment_policies,
  2 as _expect_appointment_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'schedule_holds') as hold_policies,
  1 as _expect_hold_policies,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('wo_appointments', 'schedule_holds')
       and grantee = 'authenticated' and privilege_type = 'SELECT') as select_grants,
  2 as _expect_select_grants,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('wo_appointments', 'schedule_holds')
       and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) as write_grants,
  0 as _expect_write_grants,
  (select count(*) from information_schema.routine_privileges
     where specific_schema = 'public' and grantee = 'authenticated'
       and routine_name in ('schedule_add_appointment', 'schedule_move_appointment', 'schedule_remove_appointment',
                            'schedule_hold_dates', 'schedule_move_hold', 'schedule_release_hold')) as rpc_grants,
  6 as _expect_rpc_grants;

insert into public._prod_migrations(name) values ('20270209000000_schedule_holds_and_extra_visits.sql') on conflict (name) do nothing;
