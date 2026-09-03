# Tom's 3 Sep batch — manual test script

Four items: Settings in buckets · condition hours reach the painter · approved variations go straight to the
painter · Settings → Automations. ~15 minutes on production once the migration is pasted.

## 0. The one migration

Paste `supabase/migrations/20261229000000_variation_auto_release.sql` in the **production** SQL editor
(check the project ref first — `llmrvgdequpmzzuaxdhq`). Read-back: one row, `variation_release = auto`.
Data-only and reversible: Settings → Automations → "Approved variations go straight to the painter" flips it back.

## 1. Settings in buckets (2 min)

1. Open **Settings**. Expect a sticky bar of six sections (Company · Communications & automations · Estimates ·
   Pricing · Rooms & scope rules · Money) and a "Find a setting…" box.
2. Click **Pricing** in the bar → the page scrolls to the Pricing section. Open **Pricing & job numbers** → Save all
   → "Saved ✓" (nothing changed).
3. Type `colour` in the search box → only Colours (and Trade accounts' colour card) remain; clear it.
4. Visit `/settings#automations` → the Automations folder opens and is scrolled into view.

## 2. Condition → the painter's hours (4 min)

1. Open an accepted job's estimate in the builder. Note **Total hours** on the totals strip and the
   **Contractor (N hr)** line. Job settings → Condition → **Poor — flaking / peeling (×1.35)**. Both go UP.
2. Work order tab: the job sheet shows **Condition · extra prep — Poor — flaking / peeling — extra prep allowed
   for: +N h across the job (×1.35 on painting hours)**, and each surface's hours read "incl. N h prep".
3. Set Condition back to what it was (this changes a live figure — put it back).
4. Wizard check (staff preview `/wizard`, exterior): on "How's the paintwork holding up?" pick **Peeling & flaking**.
   The estimate it creates has Condition = Poor in Job settings and the amber "peeling & flaking — needs eyes on
   it" note still listed. Delete the test estimate.

## 3. Approved variation → painter, automatically (5 min)

Needs the migration (or the switch ON in Automations) and a job in progress with a test painter.

1. Revision builder on the job: change a priced line → **Save & draft variations for signature** → email the link
   (or copy it). Open the link as the customer, sign.
2. Do NOT touch /pc. Sign in as the painter → home page card **"Variations waiting on you"** lists it → open →
   **Accept $X — N hrs** works. The painter's phone gets the "approved and waiting on you" text (needs a mobile on
   their profile).
3. Back in the revision builder: "Already signed on this job" now shows the change with **painter accepted**.
4. Turn the switch OFF in Settings → Automations → Save; repeat step 1 with another change: the painter sees
   "Approved — coming to you" and /pc/wo/<id> has the Release button, exactly as before. Turn it back ON.

## 4. Automations (4 min)

1. Settings → Communications & automations → **Automations**. Every message is listed by audience
   (Customers / Painters / Office) with its trigger; automatic ones have an On/Off switch, manual ones say "You press
   send", planned ones "Not sending yet".
2. **Job offer** → Edit wording → change the text message's first words → Save automations → "Saved ✓". Reload:
   the change stuck. Offer a job to the test painter: the text arrives with the new words.
3. Switch **Quality check — put right** OFF → Save. Record a failed QA check on a test job: no text goes out
   (the portal card still shows the rectification). Switch it back ON → Save.
4. The **Estimate sent** row's wording is the same three fields the send dialog pre-fills from — the old Messaging
   folder's content, now here.

## Gates run before shipping

`tsc` clean · eslint 0 errors · unit 1528/1528 · C1 e2e: variation-auto-release 4/4, settings-automations 2/2,
wo-variations 10/10, revision-contractor 5/5, revision-reconcile 6/6, wo-full-loop 13/13, condition-hours-golden 1/1,
tom-batch-23aug pricing-settings 1/1.
