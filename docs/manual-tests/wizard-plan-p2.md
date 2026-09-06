# Estimator plan — Phase 2 · the simpler form · manual test for Tom (7 Sep 2026)

Branch `feat/wizard-plan-p2` (stacked on `feat/wizard-plan-p0-p1`). No SQL. Five minutes on your phone,
as staff (the public switch stays off).

## A. Page 1 — three ways in
1. Open `/estimate`. The kicker reads **Step 1 of 5**. Under the heading: "About 90 seconds to your
   first range". Address, suburb/postcode, Interior/Exterior/Both, property kind, heritage — then
   **"How would you like to do this?"** with three cards: Describe it · Answer a few questions · Upload
   the floorplan or listing, and a "See real jobs and their prices →" line under them.
2. Tap Continue without choosing → the red line asks you to pick one of the three.
3. Tap **Describe it** → the text box and "Build it from my description" appear (the assistant's
   build), with "Rather chat it through?" beneath. Tap **Answer a few questions** → the quick basics
   appear. Tap **Upload the floorplan or listing** → the listing box and the upload button appear.
4. Switch to **Exterior**: the middle card reads "No photos to hand?…", the third "Add photos or the
   listing"; your choice carries across.

## B. Five pages for an interior job
1. Answer a few questions → Continue. Page 2 Surfaces, page 3 **Condition** now has the coats cards AND
   "Any damage we should know about?" on the same page; page 4 Details has doors, ceiling, windows and
   the two safety questions (nothing pre-selected); page 5 **Your details** = name/email/phone with
   the paint preferences underneath. "See my estimate" builds.
2. Exterior stays six pages (paint preferences now ride the last page, not Extras).

## C. Size band moves the price
1. Build two no-plan runs, one **<120 m²** and one **200+**. Bed 1 reads about 3.15 × 2.93 m in the
   first and about 4.03 × 3.74 m in the second; the range follows.

## D. Details you can settle in the editor
1. Leave doors "Not sure" on page 4. In the editor an amber card **"A few details to settle"** sits
   above the rooms with Panel / Flat (and window type / ceiling height when those were left open).
2. Tap **Panel** → the six amber "door style to confirm" lines disappear, the range moves, and a
   "Last change: Panel doors — every door is priced at the panel rate now" line sits under the range.
   Any later tile change updates that line ("Removed ceilings — about −$… from your range").
3. The exterior editor shows the range twice (header + sticky bar), not three times.

## Not in this batch (by design)
- Pricing the loop's likely additions up front (cupboards) waits for the Proving tags (Phase 3).
- Paint preferences after the price as an editor card: the wizard still records them on the last page.

## E. First Phase 3 pieces on this branch (pricing accuracy)
1. **Quick basics ask about the rooms the list used to assume away:** Bathrooms 1 / 2 / 3+ (the second is the
   ensuite), and "Also being painted?" Separate toilet · Garage · Study. Tick Garage and pick 2 bathrooms → the
   editor lists Ensuite and Garage as amber rooms to confirm.
2. **Exterior footprint:** page 2 (The house) asks "Roughly how big is the footprint?" — 200+ starts the
   sides at 13.8 m / 16.1 m instead of 12 / 14 m; <120 at 10.8 / 12.6 m. A read measurement still wins.
3. **Proving → "Why staff corrected them".** Each row has "Why did it change?" → pick reasons (rooms missed,
   sizes, surfaces, prep, rates, extras, access, other) + a one-line note → Save. The panel above the table
   counts the reasons with the median correction each sat in. Please tag the 20 rows already there —
   that is the data Phase 3's calibration reads. The tag is stored on the estimate (no SQL).
4. **Both (inside + outside):** "Answer a few questions" sizes the rooms from the basics AND the sides from
   your answers (no listing or photos needed); "Add photos or the listing" is the measured path for both.
