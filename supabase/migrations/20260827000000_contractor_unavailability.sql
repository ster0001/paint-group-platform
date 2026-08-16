-- =============================================================================
-- Phase D: contractor unavailability — blocked-out periods, from BOTH sides
--
-- A contractor blocks days in their portal calendar ("I'm away that week") and
-- staff can block days from the scheduling board ("training", "annual leave we
-- agreed"). Both land in the same table, tagged with who set them, so the
-- timeline can show them differently and neither side silently overwrites the
-- other.
--
-- Ranges are INCLUSIVE of both ends — a one-day block has start_date = end_date,
-- which is how a painter thinks about it ("I'm off Friday").
-- =============================================================================

do $$ begin
  create type public.unavailability_source as enum ('contractor', 'staff');
exception when duplicate_object then null; end $$;

create table if not exists public.contractor_unavailability (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  reason        text not null default '',
  source        public.unavailability_source not null default 'contractor',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint contractor_unavailability_range check (end_date >= start_date)
);

create index if not exists contractor_unavailability_cid_idx
  on public.contractor_unavailability (contractor_id, start_date);

alter table public.contractor_unavailability enable row level security;

-- Staff see and manage everyone's.
drop policy if exists contractor_unavailability_staff on public.contractor_unavailability;
create policy contractor_unavailability_staff on public.contractor_unavailability
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A contractor reads all of their own blocks — including ones staff added, so
-- they can see why a day is marked off.
drop policy if exists contractor_unavailability_own_read on public.contractor_unavailability;
create policy contractor_unavailability_own_read on public.contractor_unavailability
  for select to authenticated
  using (contractor_id = public.current_contractor_id());

-- ...but they may only create and remove their OWN blocks. Without the source
-- check a contractor could delete a block staff put there.
drop policy if exists contractor_unavailability_own_write on public.contractor_unavailability;
create policy contractor_unavailability_own_write on public.contractor_unavailability
  for insert to authenticated
  with check (contractor_id = public.current_contractor_id() and source = 'contractor');

drop policy if exists contractor_unavailability_own_delete on public.contractor_unavailability;
create policy contractor_unavailability_own_delete on public.contractor_unavailability
  for delete to authenticated
  using (contractor_id = public.current_contractor_id() and source = 'contractor');

-- ---- is this contractor free for a date range? -------------------------------
-- Used by the board before sending an offer, so a job is never offered over a
-- day the contractor has blocked. Overlap test: two inclusive ranges overlap
-- when each starts on or before the other ends.
create or replace function public.contractor_is_free(
  p_contractor_id uuid, p_start date, p_end date
) returns boolean language sql security definer set search_path = public stable as $$
  select not exists (
    select 1 from public.contractor_unavailability u
     where u.contractor_id = p_contractor_id
       and u.start_date <= coalesce(p_end, p_start)
       and u.end_date   >= p_start
  );
$$;
grant execute on function public.contractor_is_free(uuid, date, date) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As a contractor:
--   insert into contractor_unavailability (contractor_id, start_date, end_date, source)
--   values (<own id>, '2026-09-01', '2026-09-05', 'contractor');        -- allowed
--   ...the same insert with source = 'staff'                            -- refused
--   delete from contractor_unavailability where source = 'staff';       -- deletes nothing
-- As staff: both are allowed for any contractor.
