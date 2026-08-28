-- =====================================================================
-- A5-02 · The board's "newest photos across every job" query was reading
-- the whole photo table.
--
-- app/pc/page.tsx asks for the 24 most recent wo_photos ORDERED BY
-- created_at across ALL jobs. Every existing index on wo_photos leads with
-- work_order_id:
--
--   wo_photos_wo_idx         (work_order_id, kind, created_at desc)
--   wo_photos_area_idx       (work_order_id, area, kind)
--   wo_photos_surface_idx    (surface_id)
--   wo_photos_variation_idx  (variation_id)
--
-- so none of them can serve an all-jobs sort. Measured on the test project
-- at 500,000 rows (audit 2026-08-28, docs/audits/audit-2026-08-full.md):
--
--   Limit  (actual time=129.513..134.656 rows=24)
--     ->  Gather Merge
--           ->  Sort  Sort Key: created_at DESC
--                 ->  Parallel Seq Scan on wo_photos  (actual rows=250000 loops=2)
--                       Buffers: shared hit=8622
--
--   134ms warm, 1,704ms cold — the single most expensive operation on the
--   busiest staff screen, growing linearly with the fastest-growing table.
--
-- CONCURRENTLY so it cannot lock the table on a live database. That means
-- this statement CANNOT run inside a transaction block — run this file on
-- its own, not wrapped in begin/commit.
-- =====================================================================

create index concurrently if not exists wo_photos_recent_idx
  on public.wo_photos (created_at desc);

-- Readback: confirm the index exists and is valid (a failed CONCURRENTLY
-- build leaves an INVALID index behind that silently does nothing).
select i.relname            as index_name,
       idx.indisvalid       as is_valid,
       pg_size_pretty(pg_relation_size(i.oid)) as size
  from pg_index idx
  join pg_class i on i.oid = idx.indexrelid
 where i.relname = 'wo_photos_recent_idx';
