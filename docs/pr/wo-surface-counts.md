# Work order: how many doors and windows per room

Tom, 14 Oct 2026: "in the work order for contractors, please update to make it clearer on the number of doors, windows etc per room".

## What changed
- The customer's estimate has said "Doors × 4" since 18 Sep. The painter's job sheet never carried the number. Now `WOSurface.count` (the same figure the builder gives the customer snapshot: per-item substrates only, real counts only) is frozen into the work-order document and carried through the crew copy.
- The painter's sheet (`/w/[token]`, every variant) shows **Doors × 4** beside the row, from **one** up. "Doors" with no number is the ambiguity being removed, so the customer page's hide-at-one rule is not applied here. Measured surfaces (walls, ceilings) show nothing.
- The tick lists (portal job page, PC Command's Scope & ticks, the Painter's-view preview) show the same count on the row, read off the frozen document by `surface_key`. `wo_surfaces.label` stays the bare substrate, so standards matching, variation tick rows and the heal are untouched.
- No migration. Sheets frozen before today show no count until the builder re-saves and the work order is re-issued.

## Tests
- Unit: `lib/workorder/surfaces.test.ts` (`surfaceCountsByKey`), `lib/workorder/crew.test.ts` (count survives the crew copy).
- e2e on C1, 5/5: `e2e/estimate-item-counts.spec.ts` (the builder freezes the count into `woDoc`), `e2e/wo-surface-counts.spec.ts` (anonymous `/w` and the painter's tick list, label unchanged in the DB).
- Help: `docs/help/work-orders/{contractor,employee,pc}.md`; `docs/ARCHITECTURE.md`.

## Manual test
Open an estimate with doors counted in a room → Save → Issue work order → the `/w` link reads "Doors × 4" beside the row and nothing beside Walls → start the job as the painter → Scope & ticks shows the same × 4 on the row.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
