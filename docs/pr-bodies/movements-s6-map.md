# Movements Session 6 — the Map view and the order card

Branch `feat/movements-s6-map`, stacked on `feat/movements-s8-proof`. Merge order: S4 → S5 → S7 → S6 → S8 → **S6-map**. One migration: `20270283000000_movements_job_points.sql` (paste after 20270282; the SQL is below).

Unblocked 21 Oct 2026: Tom created the browser key (⚑4) and put it in `.env.local`. **Vercel still needs `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` for Production + Preview and a redeploy** — until then the Map tab does not appear on the deployed app (Settings → Movements → Movements says whether the key is present).

## What is in it

- **Map view** (`app/pc/movements/MapView.tsx`, brief §3.4 Map, rulings 13, 21, 22): Google Maps JS through a script-tag loader (`lib/maps/googleMaps.ts`, no package, the API slice hand-typed in `lib/maps/google-maps.d.ts`). One icon per job — teal house when `jobNeeds()` is empty, amber carrying the first need's icon (paint / materials / the gear type / rubbish) with a one-line "what's needed" under the street, grey house for a closed job with gear still on it; tap an amber icon to open the chip it waits on. Warehouse as the dark square. Shops as faint dots behind the **Shops** toggle, solid and named when a stop today. The selected person's **order numbers** on each stop of their day in their lane colour (◌ violet for a fixed appointment). **Route line** toggle off by default — straight dashed lines warehouse → stops → warehouse (⚑7). Day chips, person chips; Map and Day share the `day` / `who` URL parameters.
- **The order card** beside the map: the day's stops as rows (number · what · from → to · time · km); **drag the ⋮⋮ handle** (pointer events, mouse or finger; fixed rows have no handle) → the same `reorder()` patches and `reorderDay` action the Day view's ▲▼ use, so the numbers on the map, the card, Day and the Week board are one source (ruling 22). **Run plan** opens Day on that person and day; **Send to <name>'s phone** as Day.
- **One evaluator**: `mapPins()` in `lib/movements/evaluate.ts` is the only place a pin's fill, icon kind, label line, badges and the route are worked out; the view draws. 3 golden cases, including the numbers following a reorder.
- **⚑3 — real points on jobs**: `work_orders.lat / lng / point_checked_at` + `wo_set_point` (staff-only, the one writer; a null point only stamps the attempt) + `movements_job_point` preferring the real point over the suburb centroid (so the sync's nearest branch and Nearby agree with the map). Filled **lazily**: the Map view asks `geocodeJobs` once per mount for up to 8 jobs of the week with no point not tried in 7 days; the action reads the addresses, calls the office Places key (`lib/places/geocodeAddress.ts` — Places API (New) Text Search with a `places.location` field mask, Melbourne-biased, 4 s timeout; a job holds an address, not a place id, so the details endpoint cannot be used directly) and writes through the RPC. Suburb centroid until then.
- Help: `docs/help/movements/pc.md` — the Map section and three "if something goes wrong" lines. Ledger row updated. `docs/ARCHITECTURE.md` paragraph.

## Tests

- Unit: `lib/movements/evaluate.test.ts` (+3), `lib/movements/load.test.ts` (+2). Whole movements folder green.
- e2e: `e2e/movements-map.spec.ts` — (1) the shop numbered 1 and the job 2 at its real point; drag row 2 above row 1 → the map badges, the card, the database (sequence 1 at 07:00, 2 at 13:00) and the Day view all follow; (2) the amber pin opens the rubbish question, "Painter disposed" turns the icon teal; the Shops and Route toggles. **Skips with a named reason when `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is absent from the test env** — the CI e2e job needs the key as an `E2E_GOOGLE_MAPS_BROWSER_KEY` secret passed into the build's `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (not added here: a new secret is Tom's; the workflow change is one line once it exists). Local run result: see the session report.

## The migration (paste in the SQL editor, then read the `_prod_migrations` row back)

See `supabase/migrations/20270283000000_movements_job_points.sql` — converges on a re-run; starts with `set lock_timeout = '15s'`; ends with a read-back row whose `_expect_` columns must match, then the ledger insert.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
