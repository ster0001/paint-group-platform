# Finish standards, Step 2 — manual test script for Tom

Branch `feat/standards-status-callbacks`. Phone for the painter half, laptop for the office half.

## Before you start
1. Paste `supabase/migrations/20270225000000_standards_signoff.sql`. Read-back: 2 columns, 2 policies, no insert, 7 functions, ack grant true, 1 trigger, send_offer gated true, join invites true, doc kind true, grace 7.
2. Deploy the branch. Nothing is sent to anyone until you press an invite button.

## As the office
1. **Contractors**: every card now has a **Standards:** line reading **Not invited yet** (or **Not signed — not invited yet (employee)**). A new amber button at the top says **Invite N to confirm the standards**. Do NOT press it until you have told the painters (rollout §12). Press **Send standards invite** on your test contractor only.
2. Their line changes to **Not signed — invited 0d ago, offers stop <date>**. They get a text and an email. Their page's **Finish standards** row says the same with **Send reminder text**.
3. Settings → Automations: four new entries under painters — *Finish standards — please read and confirm*, *— reminder*, *— your copy*, *— updated, confirm again*. Wording editable; Text / Email / Both on the invite and the update.

## As the test contractor (phone)
1. Home shows an amber **Please confirm · Read and confirm the finish standards** card. Tap it → **Start** → six sections. The Next button stays off until the tick. Stop after section 2, go back to Home, reopen: it resumes at section 3.
2. Finish all six → **Standards confirmed**, with today's date and Version 1. Home now shows a green **✓ You confirmed these on … · Version 1** chip on the Finish standards card; the profile has a **Finish standards — Confirmed** card; Help › Finish standards shows the same pill.
3. Within a minute, **Profile → Insurance & licences** lists **Finish standards — your signed copy** (View opens the PDF, no Remove button) and the email with the PDF arrives.

## The gate (office)
1. Pick a painter you have invited who has NOT confirmed. In the database (SQL editor) set their `standards_grace_until` to yesterday — or wait the 7 days. Their line reads **grace ended · no job offers**.
2. Schedule board: drag a job onto their row. The sheet shows **Standards not signed** and **Send offer** is greyed; **Hold these dates instead** still works.
3. PC Command: a **{name} has not signed the finish standards** card with **Send reminder text** — press it; the text goes and the card says **Text sent**. The card clears when they confirm.
4. Invite a brand-new painter (Contractors → + Invite a contractor) and join as them on a phone: the first screen is the sign-off with no tab bar; Home is not reachable until the six ticks are in.

## Reminders
- Days 2, 4 and 6 after an invite at 9 am a text goes (`Reminder: confirm the … finish standards to keep getting job offers`). To check without waiting, run the sweep by hand: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/cron/campaign-sweep?only=standards"` and look at the painter's `contractor_events` (`standards_reminder_sent`).

## What to tell me
- Any wording you want changed on the sign-off screens, the texts or the emails.
- Whether 7 days' grace is right (Settings → `standards_rules`, DB for now).
