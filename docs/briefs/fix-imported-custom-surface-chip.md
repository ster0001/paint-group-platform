# Fix: the "Imported · Custom surface" chip reaches customers

**Status:** written up 9 Oct 2026, not started. Tom's ruling (decisions sheet ⚑ 12): its own small fix, to land **before go-live**, not part of the wizard UI refresh.
**Size:** one filter, one unit test, one e2e assertion. No migration.

## What the customer sees

On `/estimate/scope`, the "Anything we haven't listed" card (`app/estimate/scope/JobExtras.tsx`) shows a group headed **Imported** with a chip **Custom surface (imported) · $105** (the dollar figure is the card's first interior charge-out, so it varies). It reads as test or import data leaking onto a customer screen, and ticking it adds a priced line to their range. The same row appears in "+ Add a surface" on a room and on an exterior side.

## Why

`supabase/migrations/20270152000000_import_provenance.sql` §6 inserts one `rate_items` row per active card and side:

    code 'Custom surface (imported)', sub_category 'Imported', unit 'Hours Per Item', charge_out_cents = the side's first charge-out

It exists so imported Airtable lines can carry their own hours and price as overrides. It was never meant to be offered to anyone.

The customer add lists are derived from the whole live card:

- `lib/wizard/add-catalogue.ts` → `interiorAddOptions()` offers every `Interior` row except cabinetry, allowances and substrate-governed codes, grouped by `sub_category`. It has no exclusion for the import row.
- `lib/wizard/extras.ts` → `jobExtras()` reuses `interiorAddOptions()`, so the row becomes a whole-job extra with a price (hence the chip).
- `exteriorAddOptions()` has the same gap on the outside.

## The fix

1. In `lib/wizard/add-catalogue.ts`, exclude the import row from both `interiorAddOptions()` and `exteriorAddOptions()`. Match on the code `Custom surface (imported)` **and** on `sub_category === "Imported"`, through one named predicate (for example `isImportOnly(r)`) beside `isAllowance`, so any later import-only row is covered too.
2. Staff surfaces that need the row to edit imported lines (the quote builder) read the rate card directly, not these customer lists. Confirm that with a grep before merging, so the staff edit path keeps working.
3. **Unit test** (`lib/wizard/add-catalogue.test.ts` or `extras.test.ts`): given a card holding the import row with a charge-out, neither `interiorAddOptions`, `exteriorAddOptions` nor `jobExtras` returns it, and an ordinary extra still comes back.
4. **e2e, as an anonymous customer** (house rule: the spec comes first): extend `e2e/customer-journey/job-extras.spec.ts` to assert that `extras-card` contains no text "Imported" and no `extra-custom-surface-(imported)` test id, then make it pass.

## Already-saved estimates

A customer who ticked the chip before the fix has a priced line on their draft. Check with a read-only query before go-live: estimate lines whose code is `Custom surface (imported)` on estimates with no import provenance. If any exist, Tom decides whether they are removed or left for the estimator to clear. Do not write a data fix without that ruling.

## Not in this fix

The wizard UI refresh (S4) restyles the extras card and keeps showing whatever `jobExtras()` returns. It does not filter rows itself, because one module decides what a customer may add.
