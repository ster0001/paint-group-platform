-- =====================================================================
-- A2 · step 1 + step 3 — backfill, then delete the confirmed orphans.
--
-- RUN THIS BEFORE the migration 20261026000000_invoices_customer_link.sql.
-- Run it as ONE paste: the guard and the delete must share a transaction.
--
-- Confirmed with Tom on the 23 Aug audit numbers: 34 rows matching
-- `estimate_id IS NULL AND amount_cents = 0`, all e2e debris — none has a
-- job_id, all are status 'draft', the payments table is empty, and no
-- orphan carries a non-zero amount.
--
-- The `amount_cents = 0` guard is what protects the three live deposit
-- invoices ($5,243.66 / $1,669.42 / $7,578.87). Do not relax it, and do
-- NOT delete on "no estimate" alone.
-- =====================================================================

begin;

-- ---- step 1 · backfill customer_id from the parent estimate -----------
-- Column name confirmed against the LIVE schema: public.estimates.customer_id
-- (uuid -> customers.id). Expect 0 rows changed today: 70 of 71 estimates
-- have no customer either. That is the finding, not a failure.
update public.invoices i
   set customer_id = e.customer_id
  from public.estimates e
 where i.estimate_id = e.id
   and i.customer_id is null
   and e.customer_id is not null;

-- ---- step 3 · re-verify IN THIS TRANSACTION, then delete -------------
-- The counts below were taken at a point in time and the e2e suite writes
-- to this same database. If anything has run since, the numbers move and
-- this ABORTS rather than deleting whatever it happens to find.
do $$
declare v_deletable int; v_money int; v_has_est int; v_total int;
begin
  select count(*) filter (where estimate_id is null and amount_cents = 0),
         count(*) filter (where estimate_id is null and amount_cents > 0),
         count(*) filter (where estimate_id is not null),
         count(*)
    into v_deletable, v_money, v_has_est, v_total
    from public.invoices;

  if (v_deletable, v_money, v_has_est, v_total) is distinct from (34, 0, 3, 37) then
    raise exception
      'A2 ABORT — invoices moved since the count was agreed. Expected 34/0/3/37, found %/%/%/%. NOTHING deleted; re-run the step 2 report and re-confirm.',
      v_deletable, v_money, v_has_est, v_total;
  end if;
end $$;

delete from public.invoices
 where estimate_id is null
   and amount_cents = 0;

-- ---- readback --------------------------------------------------------
-- Expect: remaining = 3, all three still customer_id null (that is the
-- deferred NOT NULL work, not a failure of this script).
select count(*)                                          as remaining,
       count(*) filter (where customer_id is null)       as null_customer,
       count(*) filter (where estimate_id is not null)   as has_estimate,
       sum(amount_cents)                                 as total_cents
  from public.invoices;

commit;
