-- =============================================================================
-- Employed painters — Session 1: identity + the money contract
-- (docs/briefs/claude-code-brief-employed-painters.md §3.1, §3.3;
--  docs/briefs/employed-painters-session-0.md §3, §4, ⚑E ⚑G)
--
-- One painter identity, two employment types. NOT a fourth auth role:
-- `profiles.role` stays 'contractor' for both, and every behavioural
-- difference derives from `contractors.employment_type` through ONE
-- capability function (lib/painters/capabilities.ts). Nothing in SQL or TS
-- branches on the column directly except `is_employee()` below.
--
-- The money contract is a SERVER contract, not a hidden <div>. Today every
-- painter-facing page reads its money tables DIRECTLY under the contractor
-- role's RLS (session-0 §4), so "an employee never sees a dollar figure" has
-- to be the policies: an employee has NO row-level read on any table that
-- carries cents. Their job reads arrive in Session 3 through RPCs that return
-- a money-free shape. Until then an employee's portal renders honest empty
-- lists — which is exactly what the adversarial money test asserts.
--
-- What stays visible to an employee: wo_surfaces, wo_photos, wo_checklist_
-- items, wo_updates, wo_qa_*, wo_signoff, wo_walkthroughs (through
-- wo_visible_jobs — no money on any of them), contractor_expenses and
-- expense_preapprovals (ruling 13: employees claim expenses).
--
-- Contractors are untouched: every policy below keeps its existing predicate
-- and gains `and not is_employee()`, which is false for every row that exists
-- today (employment_type defaults to 'contractor', and the flag that lets the
-- office tick anyone as an employee — Session 5 — is off).
-- =============================================================================

-- ---- 1. The column ----------------------------------------------------------
alter table public.contractors
  add column if not exists employment_type text not null default 'contractor';

alter table public.contractors drop constraint if exists contractors_employment_type_check;
alter table public.contractors
  add constraint contractors_employment_type_check
  check (employment_type in ('contractor', 'employee'));

-- Written only by set_employment_type (Session 5). NOT granted to
-- authenticated: 20260824010000 replaced the table-wide UPDATE with a column
-- allow-list, so leaving this column out of the grant is what keeps a painter
-- from flipping their own type.
revoke update (employment_type) on public.contractors from authenticated;

comment on column public.contractors.employment_type is
  'contractor (self-invoicing, offered jobs, sees their price) | employee (PAYG: assigned jobs, expenses only, never sees money). Read through lib/painters/capabilities.ts, never directly.';

create index if not exists contractors_employment_type_idx
  on public.contractors (employment_type) where employment_type = 'employee';

-- ---- 2. The one SQL question: is the caller an employee? -------------------
-- SECURITY DEFINER so a policy can ask without the caller needing to read
-- contractors (the 20261009 lesson: a policy subquery runs under the caller's
-- RLS). Stable, and used as `(select public.is_employee())` so it is an
-- InitPlan — evaluated once per statement, never per row.
create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contractors
     where profile_id = auth.uid() and employment_type = 'employee'
  )
$$;
grant execute on function public.is_employee() to authenticated;

-- ---- 3. Money tables: the contractor read excludes employees ---------------

-- work_orders: carries contractor_payment_cents and the whole wo_snapshot
-- (contractorPaymentCents, option fragments). Predicate from 20261213 kept.
drop policy if exists work_orders_contractor_read on public.work_orders;
create policy work_orders_contractor_read on public.work_orders
  for select to authenticated
  using (
    issued_at is not null
    and contractor_id is not null
    and contractor_id = (select public.current_contractor_id())
    and not (select public.is_employee())
  );

-- booking_offers: payment_cents, hours_allowance. Employees are never offered
-- (ruling 1), so they have no business here at all.
drop policy if exists booking_offers_contractor_read on public.booking_offers;
create policy booking_offers_contractor_read on public.booking_offers
  for select to authenticated
  using (
    contractor_id = (select public.current_contractor_id())
    and not (select public.is_employee())
  );

-- contractor_invoices: the RCTI. Employees never self-invoice (ruling 4).
drop policy if exists contractor_invoices_own on public.contractor_invoices;
create policy contractor_invoices_own on public.contractor_invoices
  for select to authenticated
  using (
    contractor_id = (select public.current_contractor_id())
    and not (select public.is_employee())
  );

-- wo_variations: price_cents (customer money), contractor_delta_cents,
-- priced_lines. Session 4 gives employees a "Variation approved" RPC that
-- returns scope lines and hours only. Shape from 20261213 kept.
drop policy if exists wo_variations_read on public.wo_variations;
create policy wo_variations_read on public.wo_variations
  for select to authenticated
  using (
    wo_variations.work_order_id in (select id from public.wo_visible_jobs)
    and not (select public.is_employee())
  );

-- wo_events: meta carries price_cents on variation_priced / customer_approved
-- (20261002:143,198) and total_cents on acceptance. The event log is the
-- source of truth the PC reads; the painter's screens read derived state.
drop policy if exists wo_events_read on public.wo_events;
create policy wo_events_read on public.wo_events
  for select to authenticated
  using (
    wo_events.work_order_id in (select id from public.wo_visible_jobs)
    and not (select public.is_employee())
  );

-- ---- 4. The switch -----------------------------------------------------------
-- employees_enabled gates the office tick box (Session 5) and nothing else:
-- a painter row that IS an employee is treated as one whatever the flag says,
-- because the flag being off must never make money visible to someone it was
-- hidden from. Default off in production until Session 7's full-loop e2e.
insert into public.settings (key, value)
values ('employees_enabled', jsonb_build_object('enabled', false))
on conflict (key) do nothing;

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contractors' and column_name = 'employment_type') = 1
    as employment_type_column,
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'contractors'
      and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'employment_type') = 0
    as employment_type_not_self_writable,
  (select count(*) from pg_proc where proname = 'is_employee') = 1 as is_employee_fn,
  (select count(*) from pg_policies
    where policyname in ('work_orders_contractor_read', 'booking_offers_contractor_read',
                         'contractor_invoices_own', 'wo_variations_read', 'wo_events_read')
      and qual like '%is_employee%') = 5 as five_policies_exclude_employees,
  (select count(*) from public.contractors where employment_type = 'employee') as employees_now,
  (select value ->> 'enabled' from public.settings where key = 'employees_enabled') as employees_enabled;

insert into public._prod_migrations(name) values ('20270153000000_employment_type.sql') on conflict (name) do nothing;
