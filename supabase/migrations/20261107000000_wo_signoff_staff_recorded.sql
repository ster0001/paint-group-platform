-- =============================================================================
-- Follow-up to 20261105: wo_staff_sign stamps captured_on = 'staff_recorded',
-- but the 20261028 check constraint only allowed contractor_device /
-- customer_device — the live e2e hit 23514. Widen the constraint; the
-- function body is unchanged.
-- =============================================================================
alter table public.wo_signoff drop constraint if exists wo_signoff_captured_on_check;
alter table public.wo_signoff
  add constraint wo_signoff_captured_on_check
  check (captured_on is null or captured_on in ('contractor_device', 'customer_device', 'staff_recorded'));

select pg_get_constraintdef(oid) as captured_on_check
  from pg_constraint where conname = 'wo_signoff_captured_on_check';
