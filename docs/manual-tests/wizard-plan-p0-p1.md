# Estimator plan — Phase 0 + Phase 1 · manual test for Tom (7 Sep 2026)

Branch `feat/wizard-plan-p0-p1`. No SQL. Runs on your phone in about five minutes.
Everything here is also covered by two anonymous-customer journey specs
(`e2e/customer-journey/holding-and-honest-defaults.spec.ts`, `save-and-return.spec.ts`).

## A. The switch and the holding page (Phase 0)

1. Settings → Estimates → **Online estimates**. It reads HOLDING (the public switch is
   off, which is where you want it for the next three weeks). Change the headline to
   something of your own, Save.
2. In a private/incognito window open `/estimate?address=12 Test Street Malvern` (the
   homepage hand-off). You should see your headline, the line under it, and a
   **"Leave your details and we'll call you"** form with "For 12 Test Street Malvern"
   under it. The "Call me" button stays grey until name, phone and email are in.
3. Fill it and tap Call me → "Thanks <name> — we'll call you on <phone>…".
4. Back in the office: CRM → Today shows **"<name> requested a call"** with the address
   in the note; Contacts has the account.
5. Flip the switch to Live, Save, reload the private window → the wizard. Flip it back.

## B. Honest defaults and six honest steps (Phase 0)

1. As staff (or with the switch Live), open `/estimate` on your phone. The kicker reads
   **Step 1 of 6**. Tap "There isn't a floorplan to hand", type suburb + postcode.
2. Look at **Heritage listed?** — nothing is pre-selected. Tap Continue without
   answering → the red line names it. Tap No → Continue works.
3. Page 4: **built before 1970** and **asbestos** are both unselected; Continue names
   each in turn until you tap an answer.
4. The last page reads **Step 6 of 6 · Your details**.
5. In the editor the header reads **0 OF 7 ROOMS · 0 OF 2 CHECKS** (not "0 of 9
   confirmed"); the CTA reads "Confirm every room and check to continue".
6. Open the last card ("anything we haven't listed?"): on a no-plan job it no longer
   mentions a floorplan, and the chip reads **+ WC**.

## C. Save and return (Phase 1)

1. On your phone, answer page 1 and page 2, then close the tab (or reload).
2. Reopen `/estimate` → a cyan line **"Welcome back — you were at Surfaces"** and you
   are on page 2 with your ticks intact. Tap Back: suburb and bedrooms are still there.
3. Tap **Start again** → clean page 1; reload → still clean.
4. Finish a run with a real email of yours. The "Your estimate is saved" email's button
   now opens the **editor itself**, not the account page.
5. Open the portal (`/account`) on a different device via that link: the primary
   action reads **"Keep shaping my estimate"** and opens the confirm-loop editor;
   confirming a room saves. (Before: the Home said "Ring us" and the editor only opened
   for the browser session that built it.)

## Not in this batch (by design)
- The wizard stays OFF for the public until you flip the switch (your 3-week ruling).
- Email and phone stay the last question; drop-outs before that page are only reachable
  on the same device (the browser copy), not by email.
