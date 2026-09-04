# 4 Sep 2026 — Materials on the PC job page + Payables job search / expense-type dropdown

**SQL first:** paste `supabase/migrations/20261231000000_wo_set_material.sql` into the
SQL editor and read back ONE row: `wo_set_material | p_work_order_id uuid, p_row_key text,
p_colour_name text, p_colour_hex text, p_status text, p_litres numeric`. Until it runs,
the Materials card still SHOWS everything; only "Save to job sheet" answers
"Material edits need database migration 20261231 run first — nothing was changed."

## A. PC → Projects → click a job → Materials card (right column, under Colour matches)

1. **Budget strip.** Budget = the estimate's materials cost from the builder's
   Materials tab (ex GST). Invoiced ex GST = every supplier invoice matched to this
   job (÷ 1.1). Remaining goes red and reads "Over budget" when invoiced beats budget.
   Each matched invoice is listed underneath (supplier · order ref · date · $ inc).
   "All job costs →" opens the money view.
2. **One row per product × colour** with a swatch, the colour name (or "Colour TBC"),
   Confirmed/TBC pill, litres, and a pill per substrate it covers
   (`Lounge · Walls · 2c`). A colour-match product says whether its code is in.
3. **Adjust colour / litres** → name, colour picker + hex box, litres, "Colour
   confirmed with the customer" → **Save to job sheet**. Expect the pill/summary to
   update, then open **Painter's view** (or the /w link) — the painter's job sheet
   shows the new colour on the material AND on every surface painted in it.
4. Closed job → no Adjust button (the sheet is final).
5. Match a new supplier invoice on Payables (section B) → come back → Invoiced moved.

## B. Invoicing → Payments → Payables tab

1. On an intake card press **Confirm**. "Matched job" is a search box: a proposed
   match arrives already chosen (with **Change**); otherwise type part of the address
   or `PG-0004` → matches drop down (arrow keys + Enter work) → pick one. Materials
   also offer "No job yet (unmatched)".
2. **Expense type** is a dropdown (Materials, Scaffold, Render, Carpentry, Rubbish,
   Equipment, Permit, Traffic, Other). Confirm cost as before.
3. **Materials without a job → Assign to job** opens the same search box; picking a
   job matches it straight away (message "Matched — the cost now sits on its job").
4. The job list behind the box now includes jobs closed in the last 60 days
   (supplier invoices arrive after the painter has finished).

## Proof on the C1 test stack (4 Sep)
`e2e/pc-materials.spec.ts` 4/4 (breakdown per substrate · save rewrites snapshot
materials + surfaces + colours map + wo_events · budget moves when invoices land ·
RPC gates), `e2e/cost-intake.spec.ts` confirm path green with the search box + select
(its duplicate-dismiss test waits on a ~10 s Payables re-render on C1's 20k-job volume
data — see the handoff note), unit 1539/1539, lint at the 5-warning cap, tsc clean.
Screenshot walk: `e2e/_look-materials.spec.ts` (LOOK_OUT=<dir>).
