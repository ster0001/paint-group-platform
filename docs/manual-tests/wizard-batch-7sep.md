# Manual test — Tom's 7 Sep (evening) wizard batch

Branch `feat/wizard-batch-7sep`. Run the migration first (Supabase → SQL editor, paste
`supabase/migrations/20270128000000_cement_sheet_rate.sql`, read back the two rows it
selects at the end). Without it everything works; the "Cement sheet" tile simply
does not appear.

## 1. Describe it asks the questions (5 min)

1. Open `/estimate` in a private window. Type a suburb + postcode, pick **House**,
   tap **Describe it** and write a few lines ("3 bedroom house, walls and ceilings,
   change of colour").
2. **Continue** → you now get **Step 2 of 4 · Condition** (coats + damage). Pick
   "Mostly minor, a few areas of concern" and attach a phone photo.
3. **Continue** → **Step 3 of 4 · Details**: built before 1970, asbestos, living there.
4. **Continue** → your details, then **See my estimate**.
5. In the editor: the sticky line says "Your photos are with your estimator — pending
   sign-off…", the amber trace says the same, and the button is "Finalise my price"
   (never "Accept estimate").
6. Staff: Estimates → open it in the builder. Above the areas: **Customer photos ·
   NEEDS ESTIMATOR SIGN-OFF** with the thumbnail. CRM → Today shows "Sign off 1
   condition photo — …". Click **Signed off — prep priced ✓**, then **Save**. Reload
   the customer's editor: the pending line is gone.

## 2. Exterior — "Answer a few questions" and the new question set (5 min)

1. `/estimate` → tap **Answer a few questions** FIRST, then **Exterior**. There must be
   no bedrooms / open-plan questions on the page.
2. **Continue** → **What are we painting?** The house is pre-ticked. Tick **Fence** and
   **Garage / workshop / shed**. Under the house: storeys, footprint, **What's the house
   made of?** (Render, Weatherboards, Brick, Stucco, Cement sheet*, Colorbond, Tilt slab,
   Other, None), **Also being painted on the house?** (Windows, Doors, Eaves, Fascias,
   Gutters & downpipes, Garage door), **Where are we painting?** (The full exterior,
   Front, Left side, Back, Right side). Tick **Front** only.
3. **Continue** → **A little more on those**: fence type (Paling / Picket brushed /
   Picket sprayed / **Metal**) + metres; what the shed is made of. Pick Metal, 20 m.
4. **Continue** → condition; **Continue** → extras (no Fence/Deck tiles here any more —
   they are on page 2); **Continue** → details → **See my estimate**.
5. Editor: Left side / Right side / Back read **NOT PAINTING ✓**; Front reads CONFIRM
   THIS SIDE; progress starts at 3 OF 8. The amber trace lists "metal fence — no rate
   on the card yet; your estimator prices it" and the shed.
6. Try a fence-only job (untick the house): all four sides arrive NOT PAINTING, the
   fence is the only priced line.

\* Cement sheet appears once the migration has run.

## 3. The room name after "Confirm" (1 min, on a phone)

Any interior estimate in the editor: confirm the first room. The next room opens with
its NAME (and the ✎ rename box if you tap it) sitting just under the sticky header —
not scrolled off the top.

## 4. Sign back in after dropping out (5 min)

1. Private window: run the interior questions path up to **Your details**, type a
   REAL email you can read, then close the tab.
2. After 45 minutes idle (or CRM → Today, which runs the sweep on the way in), the
   session files as Dropped and ONE email goes out: "Pick up where you left off — your
   estimate is saved" (Settings → Automations → "Abandoned wizard — pick up where you
   left off"; switch it off there if you don't want it).
3. Open the link → your account page. Under **My estimates** there is a card "Not yet
   submitted — You were at Your details — tap to finish it". The property and colours
   tabs are empty, as expected.
4. Tap it → the wizard reopens where you left off ("Welcome back — you were at…").
5. Staff: Estimates → Wizard: the session stays **Dropped** while the customer only
   looked at their account page; it turns **Online now** once they touch the wizard
   again, and drops again after 45 idle minutes.

## 5. What is NOT priced by the wizard (by design, flagged amber for the estimator)

Metal fence, floor coatings, "Other" cladding, a freestanding wall's height (assumed
1.8 m), the shed's size (the card's flat Shed allowance).
