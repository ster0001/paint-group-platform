# Wizard batch — Tom's 18 items (25 Oct 2026)

Customer-side changes to the online estimate, from Tom's walk through the wizard on 25 Oct. One data-only migration.

## What changed, by item

1. **Floorplan only.** The place step offers the floorplan upload; the listing-URL field and "Read the floorplan from this listing" are gone from the quick look. (Staff pages keep `listingUrl`.)
2. **Deep blue for bold.** The groups ticked under "Which ones?" paint deep blue in the room picture, with a caption saying why.
3. **Tighter guide.** The guide range is capped at its low end + 40% (`wizard_bands.guideMaxSpreadPct`, default 40): 6000–10000 reads 6000–8400. The low end and the open questions are untouched; the Detailed range after the tighten is not capped. ⚑ The dear end is trimmed, so a job that resolves every open question the dear way can land above the guide's top — the tighten shows the true number. "No option to tighten" on a bold job: not reproduced — the Tighten door is on every interior reveal on the test stack (a Paint Home visit-tier reveal, or an over-cap job, hides it by design).
4. **No dark-to-light re-ask.** The darklight card, the ceilings row and the per-room ceiling tick are gone from the tighten screen. The quick look's answer prices the third coat as before.
5. **Cupboards start as No** — robe doors included (the 7 Oct default had them Yes).
6. **Inside the cupboard is its own question**, asked with the doors a No (a mirrored robe keeps its doors and still gets the inside painted). A No on the doors no longer drops the interior answer; only the inside face of the robe doors still follows the doors.
7. The "damage is easier to price in person" box is gone from the prep panel.
8. The paragraph on coats and the "photo and a tap" line are replaced by **"Attach photos of areas that need attention."**
9. **"What is it?" comes first**, then "How much of it is there?"; the tag is a choice and **Add it** sends.
10. **Something else** opens a note box; the repair line carries the customer's words.
11. **Tap the room's name to rename it** — no pencil.
12. **Air vent $50** per vent (migration).
13. **The air vent "+" crash:** the whole-job "Interior - Extras" block was drawn as a room card (Walls, Ceilings tiles on a block with no walls) and its stepper posted a room action the block could not take — 400, back to 1. The block is never a room card now, and a ticked extra on the sheet has its own − / + (count on the line, price follows, survives reload).
14. **Mantle $340** (migration). The sheet also prices every timed row at charge-out × hours — it used to show the hourly rate ($95) beside a mantle.
15. **Picture rails** are not on the sheet.
16. **Custom surface (imported)** is never offered, on either side.
17. **The measurements are in the size question as boxes** — retype a number (and the ceiling if this room's differs) and tap Update size; Looks right agrees with what is there. No "Adjust it".
18. **Sent screen:** a requested visit reads "Thanks — your estimator will contact you. They'll go through all of the information with you and, if required, organise a site inspection." Nobody is named. "Prefer a visit anyway?" stays.

## Migration — Tom pastes

`supabase/migrations/20270305000000_wizard_extras_prices_25oct.sql` — data-only, convergent: Air Vent charge-out 20000 (× 0.25 h = $50), Mantle 13600 (× 2.5 h = $340). Read-back row with `_expect_` values; registers itself in `_prod_migrations`. Applied on C1 (358 total). The test project has no Mantle row, so its read-back shows null for the mantle columns — expected there, not on production.

## Tests

- Unit: `npx vitest run lib` — 4,083 passed.
- Typecheck clean; `npx eslint --max-warnings 4 .` — 0 errors, 4 warnings (pre-existing).
- e2e (C1, anonymous customer): `e2e/customer-journey/tom-batch-25oct.spec.ts` (new) + the rewritten `dark-to-light`, `room-spots`, `human-moments`, `interior-loop`, `self-sign`, `document-model`, `tighten-c10`, `tom-batch-15sep-evening`, plus `interior-addpanel`, `job-extras`, `confirm-rooms`, `some-rooms` — result in the PR comment.
- Help: `docs/help/estimator/customer.md` updated; `help:index --check` current. ARCHITECTURE.md paragraph appended.

## Manual check for Tom (prod, after the paste)

1. /estimate → Inside → place step: floorplan upload only. Job step: Yes to bold, tick Walls → walls deep blue in the picture.
2. Guide range: top ≤ low × 1.4. Tighten → no "Which surfaces are going from dark to light?" card.
3. Open a bedroom: size boxes prefilled; retype the width → Update size → "updated by you". Robe doors No; "Paint the walls inside the built-in robe?" visible. Tap the room's name → rename.
4. "+ Anything needing extra prep in here?" → one line, What is it? first, Something else → note → Add it.
5. Anything we haven't listed: Air vent · $50 → tick → − / + → 2; Mantle · $340; no Picture rails, no Custom surface.
6. Send for a visit → sent screen reads "Thanks — your estimator will contact you…".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
