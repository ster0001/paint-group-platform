-- =============================================================================
-- Index on work_orders.contractor_id - audit finding S4
--
-- This column is filtered on every portal Jobs load (lib/contractor/jobs.ts)
-- AND inside the RLS policy added by 20260825000000, so it is evaluated on
-- every contractor read of the table, not just the obvious query. It was the
-- one FK in the schema without an index.
--
-- Partial, because a null contractor means "unassigned" and no query ever looks
-- for those by contractor: it keeps the index to the rows that are actually
-- searched, and unassigned jobs cost nothing to maintain.
-- =============================================================================

create index if not exists work_orders_contractor_idx
  on public.work_orders (contractor_id)
  where contractor_id is not null;

-- ---- Verification -----------------------------------------------------------
--   explain analyze select * from work_orders where contractor_id = '<a real id>';
-- should show an Index Scan using work_orders_contractor_idx once the table is
-- big enough for the planner to bother - on a handful of rows a seq scan is
-- still correct and cheaper.
