-- =============================================================================
-- Remove two leftover TEST work orders so demo painters can be deleted.
-- Tom, 18 Sep 2026: a demo painter refused to delete — "They have been offered
-- WO-OVERLAP2, and that record stays."
--
-- WO-OVERLAP1/2 and WO-VERIFY1 were made while verifying the accept-forgery
-- hole in August; revert-forgery-test-acceptance.sql already names them as
-- leftovers to clear. Migration 20270172 stopped an offer nobody accepted from
-- blocking a delete, which handles most of it — this clears the junk itself.
--
-- This is NOT a migration. It changes data, not shape, so it registers nothing
-- in _prod_migrations and can be run once and forgotten.
--
-- Deleting a work order CASCADES to twenty tables (its surfaces, offers,
-- events, photos, variations, checklists, QA checks, sign-off, warranty,
-- walkthroughs, reports, assignments, timesheets, booking notes, calendar
-- events, automation holds) and is REFUSED outright by five (contractor
-- invoices, job costs, expenses, pre-approvals, colour records). That refusal
-- is the safety net: if one of these rows is somehow real, step 2 fails rather
-- than quietly destroying it.
-- =============================================================================

-- ---- STEP 1: look first. Run this on its own and read it. --------------------
with target as (
  select id, wo_ref from public.work_orders
   where wo_ref in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1')
)
select
  t.wo_ref,
  w.stage,
  w.status,
  w.created_at::date                                              as created,
  w.wo_snapshot->>'jobTitle'                                      as job_title,
  (select count(*) from public.booking_offers  o where o.work_order_id = t.id) as offers,
  (select count(*) from public.wo_assignments  a where a.work_order_id = t.id) as assignments,
  (select count(*) from public.wo_photos       p where p.work_order_id = t.id) as photos,
  (select count(*) from public.timesheet_entries e where e.work_order_id = t.id) as timesheets,
  -- The five that would REFUSE the delete. All of these must read 0.
  (select count(*) from public.contractor_invoices i where i.work_order_id = t.id) as bill_invoices,
  (select count(*) from public.job_costs        j where j.work_order_id = t.id) as job_costs,
  (select count(*) from public.contractor_expenses x where x.work_order_id = t.id) as expenses,
  (select count(*) from public.expense_preapprovals pa where pa.work_order_id = t.id) as preapprovals,
  (select count(*) from public.colour_records   c where c.source_job_id = t.id) as colour_records
from target t
join public.work_orders w on w.id = t.id
order by t.wo_ref;

-- And who is still stuck behind them: painters whose ONLY history is one of
-- these jobs, so removing the jobs is what lets the painter go.
select c.id, coalesce(nullif(trim(c.company_name), ''), p.name, 'unnamed') as painter,
       c.active, c.employment_type
from public.contractors c
left join public.profiles p on p.id = c.profile_id
where exists (
        select 1 from public.booking_offers o
         join public.work_orders w on w.id = o.work_order_id
        where o.contractor_id = c.id and w.wo_ref in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1'))
  and not exists (
        select 1 from public.work_orders w
        where w.contractor_id = c.id and w.wo_ref not in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1'))
order by painter;

-- ---- STEP 2: remove them. Only run this if STEP 1's last five columns are 0. --
begin;

-- Belt and braces: refuse the whole thing if any money or colour record is
-- attached, rather than relying on remembering to read step 1.
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.work_orders w
   where w.wo_ref in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1')
     and (exists (select 1 from public.contractor_invoices i where i.work_order_id = w.id)
       or exists (select 1 from public.job_costs j where j.work_order_id = w.id)
       or exists (select 1 from public.contractor_expenses x where x.work_order_id = w.id)
       or exists (select 1 from public.expense_preapprovals pa where pa.work_order_id = w.id)
       or exists (select 1 from public.colour_records c where c.source_job_id = w.id));
  if v_n > 0 then
    raise exception 'STOP: % of these work orders carry money or a colour record — they are not test data. Nothing was removed.', v_n;
  end if;
end $$;

delete from public.work_orders
 where wo_ref in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1');

commit;

-- ---- read-back: nothing left under those references -------------------------
select count(*) = 0 as all_gone
  from public.work_orders
 where wo_ref in ('WO-OVERLAP1', 'WO-OVERLAP2', 'WO-VERIFY1');
