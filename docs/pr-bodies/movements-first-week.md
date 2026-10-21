# Movements: Tom's first-week asks (21 Oct)

Six asks after the first day on the board.

1. **One line = one order chip.** Items separated by commas on the one line, up to 500 characters (the constraint, `material_line_add/update`, every input and the estimate builder's Materials & sundries field).
2. **Gear needed box on the job page.** Under Equipment movements booked, type the gear (commas between items), press Enter → an `equipment_out` chip in the tray with no register items; booking it makes its return chip as before. `movement_create` allows a titled gear chip with no items (returns and repairs still need items).
3. **No Bunnings default.** The sync writes no shop for a materials line (SQL + the TS mirror). The tray says *no shop yet — tap to confirm*; the Supplier lane refuses it (`no_shop`). The chip sheet has **How does it get to site?** — pick the shop, then **Delivered to site** (placed on the Supplier lane on the job's first day) or **Picked up** (stays in the tray for a person). New RPC `movement_set_method`, new column `movements.method_pref`.
4. **One paint order per brand.** A product saved with a blank brand takes the brand its name starts with when that brand exists; two spellings of one brand fold onto the one with more products (`products_infer_brand` trigger). The migration backfills blank brands and resyncs open jobs once.
5. **Litres editable everywhere** — already true on the Materials card, in the chip sheet (tap a line) and in the builder's working scope; the help says so. No code.
6. **Unscheduled site check-ins in the tray.** A `wo_site_visits` row with no day shows under the tray as **Site check-ins to book**; drag it onto a staff lane and the hour row (or AM/PM) books it through `wo_site_visit_set_schedule`. Painter and supplier lanes refuse.

## Migration — paste on production
`supabase/migrations/20270287000000_movements_first_week.sql` — converging, starts with `set lock_timeout = '15s';`, ends with the read-back and the ledger row. Compare the read-back to its `_expect_` values. Applied on C1.

## Proof
- `e2e/movements-first-week.spec.ts` — see the run line in the PR message.
- `vitest run lib/movements lib/crm lib/sql` green; tsc clean; lint on the changed files 0 errors (1 pre-existing warning).

## Help
`docs/help/movements/pc.md`, `docs/help/movements/contractor.md`, `docs/help/work-orders/pc.md`; ledger `docs/briefs/movements-progress.md`; `docs/ARCHITECTURE.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
