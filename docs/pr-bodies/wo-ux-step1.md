# Work order UX — Step 1: By surface view, bulk tick RPC, undo

Brief `docs/briefs/claude-code-brief-work-order-ux.md` §4.1 + §4.4; mockup `docs/mockups/work-order-ux-mockup.html`; Step 0 report `docs/briefs/work-order-ux-s0-report.md`.

## What changed

- **Migration `20270300000000_wo_surface_groups.sql`** (Tom pastes; starts with `set lock_timeout`, converges on re-run, ends with the read-back and the `_prod_migrations` row): `surface_groups` (8) + `surface_group_keys` (17, standards key → group), `wo_surfaces.group_code`, the one resolver `wo_surface_groups_assign(wo)`, `wo_seed_surfaces` now calls it, `wo_tick_surface_group(wo, group, to)` and `wo_untick_bulk(parent_event)` (both `grant execute … to authenticated`), and a backfill over every open job. Read-back `_expect_`: groups 8 · keys 17 · fns 3 · grants 3 · policies 2.
- **`app/components/wo/TickList.tsx`** — By surface (default) | By room toggle, remembered in `localStorage`; group rows with bar, Mark all prepped / Mark all painted, expand to rooms, 6-second Undo toast. Same component on the painter page, the worker screen, the console job page and the as-painter mirror (each now passes `workOrderId`). `app/components/wo/bulkTickAction.ts` — the two server actions.
- **`lib/workorder/surfaceGroups.ts`** — pure view model + labels/wording, pinned to the migration by `surfaceGroups.test.ts`. `SurfaceRow.group`. `draftUpdateForWorkOrder` (job-keyed draft refresh, called once per bulk tap and after an undo).
- **Reminder texts** (§4.4): the four painter update defaults end with “Tap By surface to update the whole job in one go.” Inventory rows 16 / 16a note it.
- **Help**: `docs/help/work-orders/{contractor,employee,pc}.md`; `docs/ARCHITECTURE.md` paragraph.

## Rulings honoured
R1 no whole-job button · R2 By surface default, By room one tap away · R3 painted refused (server + screen) until every room prepped · R4 same per-room rows + one parent event · R5 rooms at or past the target skipped (count 0, nothing written) · R6 Undo 6 s on screen, 60 s + same user on the server · R14 a bulk tick counts as an update exactly like a single tick (the evaluator credits days).

## Decisions taken (report §7 defaults; say if wrong)
- **Undo and the reminder moment (M8):** undo puts the rows back and writes the by-hand reverse ticks (so the day's draft re-reads right) and one `surface_group_untick`; it does not un-answer the day's reminder moment and never deletes events. `all_surfaces_done`, once written, stays — the single tick's rule.
- **Resolver fallback:** a keyed row the frozen document no longer carries resolves from its own label (older or healed lists).

## Tests
- Unit: `lib/workorder/surfaceGroups.test.ts` (14) — mirror of the migration, group views, R3/R5 sets, toast, remembered view. Whole suite green.
- E2e `e2e/wo-ticks-by-surface.spec.ts` on C1, as the painter on a 390×844 phone (dark, then light via the theme cookie) and as PC in the mirror: lands By surface · gate refuses the whole call with nothing written · R3 refused on the server · bulk prepped writes 3 children + 1 parent, Undo restores and writes the untick · **golden** bulk-vs-three-single-ticks same event shape and states, repeat tap writes nothing · Mark all painted · By room remembered across reload · staff bulk tick in the mirror recorded as `staff`.
- Worker attribution: the bulk RPC uses the single tick's actor block word for word (`wo_worker_on_job` → `worker`); no worker e2e login exists, so this is covered by the shared code, not a run.

## For Tom
- Paste `20270300000000_wo_surface_groups.sql`; compare the read-back row to its `_expect_` values; check the ledger.
- ⚑5 induction slide (content only, for the deck): *“By surface. Tap Mark all prepped or Mark all painted to update every room of one surface in one go. Painted unlocks once every room is prepped. Undo for six seconds if you tap the wrong one. By room is still there for the odd room that is behind.”*
- Rulings still open for Steps 2–3: M1 (`customer_defect_tape` as Trigger C — time, size floor), M2 (registry approve mode instead of `auto_send`), M9 (what paused means), the sender.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
