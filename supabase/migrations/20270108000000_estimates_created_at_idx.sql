-- @no-transaction
-- =====================================================================
-- The Estimates list orders every estimate by created_at desc and takes
-- the first thousand; there was no index on created_at, so that was a
-- sort of the whole table on every open (1.1 s over 60k rows on the test
-- project, and it timed out under e2e load on 6 Sep, rendering as
-- "No estimates yet"). CONCURRENTLY, `-- @no-transaction`: run this
-- statement on its own, never inside begin/commit (same rule as 20261202).
-- =====================================================================

create index concurrently if not exists estimates_created_at_idx
  on public.estimates (created_at desc);

-- Readback: expect one row, is_valid = true.
select i.relname as index_name, idx.indisvalid as is_valid, pg_size_pretty(pg_relation_size(i.oid)) as size
  from pg_index idx join pg_class i on i.oid = idx.indexrelid
 where i.relname = 'estimates_created_at_idx';
