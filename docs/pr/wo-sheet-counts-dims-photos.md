# Job sheet: counts on every job, measurements, every photo

Tom, 15 Oct 2026: "In the contractor work order it isn't showing the number room or area breakdown of the doors, windows etc, it is just labelling them as doors … This needs to be updated for all areas with a number attached for the contractor to see", "it doesn't show all of the photos", "there are also no measurements on the work orders".

## What changed
- **Counts on every job, not just new ones.** The 14 Oct count (PR #275) was frozen by the builder in the browser, so a work order issued from an estimate last saved before that deploy — every job then on site — carried none. Migration `20270272` adds a helper that fills a missing count from the estimate's own blocks (per-item rate items only, the builder's rule), `issue_work_order` passes the document through it, and the paste backfills every existing sheet once.
- **Measurements.** Each area carries the estimator's L × W × H (a single plane L × H) and each measured surface its priced quantity with unit — "38.4 m²", "14 lm" — frozen by the builder, carried by the crew copy, shown on the sheet beside the area name and at the head of the surface line, and first on the tick list's heading line. The backfill fills the dimensions for old sheets; the per-surface quantity is pricing's `computeQuantity` and is not re-implemented in SQL, so it appears on sheets issued from here on.
- **Every photo.** The area photo strip on the sheet was capped at eight. It now shows them all.

## Migration — `supabase/migrations/20270272000000_wo_snapshot_counts_dims.sql`
Production ref `llmrvgdequpmzzuaxdhq`. Paste in one go; it starts with `set lock_timeout = '15s'`, converges on a re-run, ends with a read-back row (`helper_fns_expect_1` = 1, `sheets_with_a_count` and `sheets_with_dims` should be most of `sheets`) and registers itself in `_prod_migrations`. Applied on C1 for the e2e run.

## Tests
- Unit: `lib/workorder/surfaces.test.ts` (dims / measure labels, heading line), `lib/workorder/crew.test.ts` (dims and quantity survive the crew copy).
- e2e on C1: `e2e/wo-sheet-counts-dims-photos.spec.ts` (staff issue a draft through the RPC from a stale `woDoc`; the snapshot comes out with `count` 4 / 1 and `dims`; the anonymous `/w` page shows "× 4", "4 × 3 × 2.4 m", "33.6 m²" and all 11 photos), `e2e/wo-surface-counts.spec.ts`, `e2e/wo-area-photo-lightbox.spec.ts`.
- Help: `docs/help/work-orders/{contractor,employee,pc}.md`; `docs/ARCHITECTURE.md`.

## Manual test (after the paste)
Open any live job's /w link → every counted row reads "Doors × N", every area has its size beside its name, an area with more than eight photos shows them all. Then open an estimate in the builder → Save → Issue → Walls reads "38.4 m²" under its name.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
