# 24 Sep 2026 — quality-check repair + overrides, office sign-off, photo rules, revision colours

**SQL first, in order, each with `set lock_timeout = '15s';` at the top and the read-back row
compared to its `_expect_` columns before moving on:**

1. `20270196000000_wo_qa_recheck.sql` — fixes *function public.wo_qa_open_count(uuid) does not exist*.
   Read-back: every column equals its `_expect_` (`parked_fails` 0).
2. `20270197000000_wo_qa_waived_staff_completion.sql`
3. `20270198000000_wo_photos_optional_short_jobs.sql`
4. `20270199000000_wo_sync_scope_colours.sql`

Then `select name from public._prod_migrations where name like '2027019%' order by 1;` must list all four.
The test project needs the same four through `node scripts/c1/apply-migrations.mjs` before the new
specs can run there.

## 1 · The quality check works again (and a fail gets its re-check)
1. PC → a job at In progress with **Quality check required** ticked. Painter: tick every surface,
   answer the finishing-up list, **All done — next step** → Quality check.
2. PC → the job → tick the four standards → **Log check — PASS**. Expect "Passed — all checks
   clear…" and the rail at **05 Walkthrough**. (Before: the `wo_qa_open_count` error.)
3. Optional: **Log FAIL** on another job → the card reads *re-check scheduled*, Job facts list
   `final fail · re-checked` and `final · re-check due`, the painter's re-finish brings a fresh
   re-check card, and passing it moves the job on.

## 2 · Only staff sign off a quality-checked job
1. On the job from step 2 (at Walkthrough, a pass on record): the **Next step** card reads
   **Sign off as complete — quality check passed**; the Walkthrough card has the same button with a
   note field; **Record sign-off manually** and **Customer can't attend** are gone.
2. Painter's page: **Quality check passed — Paint Group signs this job off from the office**; no
   Start-the-walkthrough bar.
3. Press the button. Expect "Signed off and closed — warranty started, report sent…", stage
   **06 Closed**, `wo_signoff.signed_name` = your profile name, `captured_on = staff_recorded`, a
   `warranties` row, the customer's signed-report email.
4. A job with NO quality check is unchanged: the customer signs on the painter's phone.

## 3 · Walkthrough not required — a button, at any open stage, even late
1. Any open job (including one at **01 Offer**): the Walkthrough card shows **Walkthrough not
   required** as a button. Press → reads **Walkthrough not required ✓ — require it again**.
2. On a job already at **05 Walkthrough** with a booked final: press it, then on the Next-step card
   **Close the job — no walkthrough required**. Expect closed, the booked walkthrough **cancelled**,
   report/warranty/invoice draft written.

## 4 · Quality check not required on one job
1. A NEW contractor's job at In progress: Job facts show `N scheduled`. Under the facts press
   **Quality check not required on this job**. Expect "No quality check on this job…", the pill
   **Not required — waived by the office**, the due checks gone.
2. Painter finishes → job goes straight to the pack/close, no Quality check stage.
3. Tick **Quality check required** → waiver off, check re-scheduled.
4. A job parked at **04 Quality check** when you waive: it moves to Walkthrough (or closes if no
   walkthrough) on the spot.

## 5 · Colours added in the revision working scope
1. An accepted job whose sheet has a TBC colour. **Revise scope →** → pick a colour for that
   substrate → save. Expect "Saved ✓ (working scope) · colours updated on the job for the customer
   and the painter".
2. PC job page → Materials card: the colour, **confirmed**. Painter's job sheet (`/portal/jobs/…`):
   the colour on the material and each surface. Customer's account → property → **Colours**: the
   colour card shows it.
3. A colour on a brand-new area that the customer has not signed for yet does NOT appear until
   that variation is signed.

## 6 · Photos not required on a line
1. PC job page → Scope & ticks (any stage): **Photos not required — Fuel allowance** under the line
   → the row shows **No photos**. Painter: ticking that row asks for no photo; the area's other rows
   still ask.

## 7 · One before and one finished photo on a short job
1. A job booked for ≤ 3 days: the painter's first tick anywhere asks **Before photo of the job —
   one is enough on a short job**; after it, every area ticks. The last tick asks for one finished
   shot for the job. A job booked for 4+ days still asks per area.
2. Change the threshold: Settings → work-order loop → `photoMinimums.shortJobDays`.

## Gates
- Unit: `lib/workorder/qa.test.ts`, `lib/workorder/surfaces.test.ts` (photo rules).
- e2e: `wo-qa-recheck`, `wo-qa-overrides`, `wo-photo-rules`, `revision-colours`, `wo-full-loop` 6–8.
