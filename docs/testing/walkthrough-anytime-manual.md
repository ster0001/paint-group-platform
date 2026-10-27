# Manual test — the walkthrough starts whenever the boxes are ticked (26 Oct 2026)

What changed: colour-match codes no longer hold the hand-over, and a passed quality check no
longer hides the painter's **Start the walkthrough** button. The office is told about missing
colour codes through a PC Command card instead. Migration `20270306` must be live first
(check `_prod_migrations` for `20270306000000_walkthrough_anytime_colour_match.sql`).

## A. Colour codes outstanding — the painter still starts (phone, as a contractor)

1. Pick a test job whose estimate has at least one paint flagged **colour match required** with
   no code (or answer **No** to "Colour schedule finalised" on the pre-start list and leave a
   paint without a colour name).
2. As the contractor on the phone: tick every surface, add the after photos, tap **All done —
   next step**, tick the finishing-up list and answer its questions.
3. Tap **Start the walkthrough** (card or the pinned bar).
   - Expect: the customer's walkthrough view opens. Before this change it said
     *Not yet — colour match codes still needed for …*.
4. As staff, open PC Command (`/pc`).
   - Expect: a 🎨 card **Colour match codes still to come on WO-… — address**, naming the paints,
     with **Open the job** landing on the job page's **Colour matches** card.
   - The job page timeline shows **colour match outstanding** with the same paints.
5. Key the codes on the **Colour matches** card (either side).
   - Expect: the PC Command card is gone on the next load. Nothing to dismiss.

## B. Quality check passed — the painter's button stays

1. A job with **Quality check required** ticked. Painter finishes and ticks the finishing-up list
   (job goes to **Quality check**).
2. As staff, log the check as a **pass**.
3. As the contractor, open the job page.
   - Expect: **Walkthrough & sign-off** card with **Start the walkthrough**, and under its text a
     line *Paint Group's quality check has passed, so the office can also sign this job off from
     their side. You don't have to wait for that…*. The pinned bar reads **READY TO SIGN OFF**.
   - Before this change the page read *Quality check passed — Paint Group signs this job off from
     the office* and had no button.
4. Tap **Start the walkthrough** — the customer's view opens and they can sign on the phone.
5. Alternatively, as staff, **Sign off as complete — quality check passed** still works from the
   job page; whichever happens first closes the job.

## C. Dates do not gate anything

1. On a job at the walkthrough stage, move the finish / walkthrough date forward or back.
2. **Start the walkthrough** still opens. No date was ever read by the start.

## D. Guard rails that must still hold

- A painter whose surfaces are not all ticked still gets *Tick off every surface first*.
- Finishing-up items still to tick still refuse in words (*N completion items still to tick*).
- The customer and the painter cannot call the office's outstanding-colour list: the painter's
  session gets an empty list; the customer role has no grant.
- Demo (12 Demo Street) jobs never appear on the PC Command card.
