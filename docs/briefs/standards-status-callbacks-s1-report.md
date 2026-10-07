# Finish standards, painter status, call backs — Step 1 report (standards as data + the help base)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** `docs/briefs/claude-code-brief-standards-status-callbacks.md` §10 Step 1 · **Step 0:** `standards-status-callbacks-s0-report.md`

## What was built

| Brief asked | Built |
|---|---|
| §5 standards tables + idempotent loader, 159 rows | `supabase/migrations/20270224000000_finish_standards.sql` (five tables, RLS, grants, `small_job_hours` setting + RPC, read-back row); `scripts/seed-standards.ts` (upserts on natural keys, removes what the file dropped, then re-reads through `lib/standards/read.ts` and exits 1 unless the tables equal the file). Run on the C1 test project: **17 surfaces, 53 checks, 159 level rows, 34 rate codes, read-back equals the file ✓** |
| Map the 17 surfaces to rate-card codes; list unmapped codes | `lib/standards/codes.ts` — the table below, for approval. Unmapped codes listed below and printed by `scripts/diag/standards-unmapped-lines.mjs`, which also lists every surface line on open production jobs with no standard (read only; Tom runs it) |
| Standards screens per the mockup, in the agreed place | Under the existing **HELP** tab: `/portal/help/standards` (Interior / Exterior grid, Version + approved date, the six rule pages), `/portal/help/standards/<surface>` (level switch), `/portal/help/standards/s/<section>`. Pinned card on `/portal/help`; "Finish standards" card on Home. PC Command has the same screens at `/pc/standards…` |
| "What we expect" on each work-order surface line, locked to the job's level, "See other levels"; no link when unmapped | `TickList.expectHref` (painter and PC tick lists) and `WorkOrderDoc.standardsLinks` (job sheet); links built once by `standardsLinksFor` at the **area's** level (areas can override the job). A locked page shows the blue pill "Level N on this job" and "See other levels ›" |
| Tape check required / not required from hours and `small_job_hours` | `settings.small_job_hours` (numeric envelope, default 16, editable under Pricing & job numbers) → `small_job_hours()` RPC → `WorkOrderDoc` line under Level of finish, from `estimatedHours(doc)` |
| Bogging, Stain blocking, Additional coats chips; no completion tick | Added to `VARIATION_CATEGORIES`; nothing added to any checklist |
| PC quality check links each surface to the same record (S12) | `QaCheck.expect`: "What we expect on this job's surfaces", one link per surface line → `/pc/standards/<key>?level=N&job=` |
| Light and dark via the portal's tokens | `app/components/standards/standards.css` uses only tokens both shells define; the e2e asserts computed colours in both themes |
| E2e as the painter on a phone, both themes | `e2e/standards.spec.ts` (390×844, `isMobile`): RLS through each role's token, Help → grid → surface → levels → rule page, both themes, the job's links (label fallback and code+side), tape check both ways, the finish chip, the chips, the PC tick list and QA card |

## The surface ↔ rate-card code map (for approval)

| Standards surface | Side | Rate-card codes |
|---|---|---|
| Walls | interior | Walls |
| Ceilings | interior | Ceilings |
| Cornices | interior | Standard Cornices · Patterned Cornices |
| Skirting boards | interior | Skirting Boards · Skirting Boards MDF |
| Architraves | interior | Architrave (1 Side) |
| Window frames | interior | Fixed / Picture / Window Reveal · Awning / Casement Window · Double Hung Sash · Colonial / Bay Window |
| Doors | interior | Flat Door and Frame (1 Side) · Flat Door (1 Side) · 4-6 Panel Door and Frame (1 Side) · 4-6 Panel Door (1 Side) |
| Weatherboards | exterior | Weatherboards |
| Brick | exterior | Brick · Brick (Unpainted) |
| Render | exterior | Render · **Stucco · Cement Sheet · Concrete / Tilt Slab** (judgement: the card clones Render for all three) |
| Picket fence | exterior | Picket Fence (Hand Paint) · Picket Fence (Spray) — **Paling Fence not mapped** |
| Windows | exterior | Fixed / Picture Window · Awning / Casement Window · Double Hung Sash · Colonial / Bay Window |
| Doors | exterior | Standard Door (1 Side) · Front Door — **Security Door not mapped** |
| Fascias | exterior | Fascias |
| Eaves | exterior | Eaves · **Soffits / Exterior Ceilings** (judgement) |
| Strapping | exterior | Strapping |
| Fretwork | exterior | **no rate code exists** — readable from the Standards screen, never linked from a line |

Three window codes exist on both sides of the card; the area's side (new snapshots) or its sibling lines (issued jobs) decide which standard. With nothing to go on, interior.

**Rate-card codes that map to no surface** (a line with one shows no link): Gutters, Downpipes, Roof, Deck Painting, Pergola, Garage Door (1 Car), Garage Door (2 Car), Pressure Washing, Colorbond Cladding, Cutek, Columns, Posts, Wood Shutters, Window Shutters, Hand Rails, Balustrades, Picture Rails, Paling Fence, Security Door, Side Gate, Meter Box, Shed, Air Vent, the seven cabinetry codes, the four allowances, Custom surface (imported).

**Work-order lines on production with no standard:** not run (production is Tom's). `node scripts/diag/standards-unmapped-lines.mjs` prints them grouped by label.

## Decisions taken (from the Step 0 report §12, Tom said proceed)

1. **QA screen (S12):** the four generic QA items stay; the check card gains one link per surface line to its standard at the job's level. Per-surface QA items were not built — Step 5 decides the cadence and can revisit.
2. **Surface code on issued jobs:** `WOSurface.code` and `WOArea.side` ride every snapshot frozen from now; older jobs resolve by label (as a rate code, then as the surface name), side from sibling lines. No join to `builder_state`.
3. **Standards live under Help**, not a seventh tab.
4. **Help for employees:** fixed in passing — `/portal/help` and `/portal/help/[feature]` now hand an employed painter the employee guides.

## Clean-up done in this step (your standing instruction)

- `lib/workorder/finish.ts` `FINISH_LEVELS`: the invented Utility / Premium / Showcase prep-and-acceptance text replaced by the guide's three level summaries, pinned to the JSON by a test. `FinishChip` renders them and links to the standards.
- Three duplicate variation label maps (`console.ts`, `timeline.ts`, `app/v/[token]`) and two hard-coded "Removed from scope" strings → one `variationCategoryLabel(code, audience)`.
- `draftRevisionVariationsAction` no longer overwrites a painter's category with `extra_scope`.
- `TickList`'s unused `workOrderId` prop removed (three callers).
- Dead table `public.work_order_surfaces` (20260818, no readers) dropped in the migration — **Tom: this is a `drop table` in a paste; it has had no reader since 20260927.**
- `/portal/help` employee roles bug (above).

Left for the step that touches them (listed in the Step 0 report §10): the stale "Move to completion prep" copy, `qaCadence.establishedContractors`, the queue duplication, the reminder sweep's UTC date, the messaging inventory, the token-file comments.

## Open for Tom

- Approve or amend the code map above (especially the four judgement calls in bold).
- The `drop table work_order_surfaces` line.
- `small_job_hours` default 16 — also the JSON's `small_job_hours`; the Settings row is what the app reads.

## Not in this step
Sign-off, the offers gate, reminders, call backs, the evaluator, the traffic light, PC Contractors — Steps 2–9.
