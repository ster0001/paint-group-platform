# Paint Home polish: hero brighter, shopfront on every estimate row, the mark on the customer's estimate and invoice, address hand-off carries suburb + postcode

**Tom, 25 Oct 2026** — four items. No migration.

## What changed
1. **Address → wizard.** "After adding the address in the website, it doesn't transfer the suburb or the postcode". The homepage resolved the address but handed over only its words. Now a picked suggestion's street / suburb / state / postcode ride the hand-off URL (`estimateHref({ picked })` → `parseEstimateIntent` → `intent.address` → the wizard's `state.address` and customer suburb/postcode); pressing See my price with suggestions open but nothing picked resolves the top one first; words with no lookup behind them are looked up once when the wizard's first screen opens (`useAddressLookup.resolveText`, the one fetch). Both shopfronts.
2. **Hero brighter.** Cyan and blush glows, the prototype's soft cyan sweeps, a cyan-edged glowing block, white headline, cyan kicker — `marketing.css` only, Paint Home only.
3. **Estimates tab.** Every row's pill now says **Paint Home** (slate-and-cyan) or **Paint Group** (grey); same on the Wizard tab. Other lists keep the Paint-Home-only pill.
4. **The customer's estimate and invoice carry the Paint Home mark.** `/e`: the card prefers `logoUrlLight`, which the overlay did not replace, so the Paint Group light logo won — fixed, with a new `/painthome/logo-light.png` (ink lettering, transparent) for white surfaces. `/i` (and the PDF, a print of it): the sheet drew a hard-coded PAINT GROUP wordmark on every invoice; a Paint Home invoice now draws the Paint Home mark.

## Proof
- Unit: `lib/marketing/estimateLink.test.ts`, `prefill.test.ts` (the parts ride and parse; half a pick is no pick), `lib/brand/filter.test.ts`, `lib/invoicing/invoiceSheetBrand.test.ts` (the sheet's mark per brand). Full suite green; typecheck clean; lint 0 errors.
- e2e: new `e2e/marketing/address-handoff.spec.ts` (the wizard opens with suburb and postcode filled and Continue passes, on both hosts; words alone still open it); `painthome-staff.spec.ts` (both pills); `painthome-comms.spec.ts` (the mark's src on the estimate page). Local C1 result in the PR conversation; the PR e2e job otherwise.
- Hero checked in the browser at desktop and 375px.
- Help: `docs/help/paint-home/{staff,customer}.md`; `docs/ARCHITECTURE.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
