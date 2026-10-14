---
feature: portal-gaps
role: contractor
title: Request more materials, mark a rained-off day, add your certificates later
summary: From a job you can ask the office for more materials (what and how much) and see their reply on the same card; you can tell the office there was no work today (rained off, site not ready, sick) and once they confirm, that day's update reminders are not counted. During induction you can say "I will add this later" on your public liability certificate and carry on — you are texted a reminder on days 2, 4 and 6, and job offers start once it is in.
sources: app/portal/jobs/[id]/MaterialsRequest.tsx, app/portal/jobs/[id]/NoWorkToday.tsx, app/portal/jobs/[id]/gapActions.ts, app/portal/DeferCertificates.tsx, app/portal/workerActions.ts, supabase/migrations/20270266000000_portal_gaps.sql
---

## What this is for
Three things painters used to phone or text about now have a button on the job: running short of paint, a day with no work on site, and certificates that are not to hand on induction day. Each one goes to the office as a card they have to answer, and the answer comes back to the same place on your phone.

## Before you start
- **Materials** and **No work today** are on a job you have accepted and that is live (not an offer, not closed).
- **I will add this later** shows on Home under the certificate action item, only while there is no certificate on file.
- Workers (crew logins) do not see these buttons — the lead painter raises them.

## Steps
1. **Request more:** on the job, under **Materials**, tap **Request more**. Type what you need (for example *Wash&Wear Natural White*) and how much (*10 L*), then **Send to the office**. The request shows under the card as *Sent to the office — waiting for a reply*.
2. When the office answers, the same line reads **Ordered — …** with their note (where to pick it up and when), or **Not ordered — …** with the reason. Nothing to do; just check the line.
3. **No work today:** on the job, tap **No work today**, pick the reason (**Rained off**, **Site not ready**, **Sick**, **No materials yet**, **Other**) and tap the button with today's date. Asking twice for the same day is one request.
4. Once the office confirms, the line shows the day as **No work** and the update reminders for that day stop counting. If they decline, the line shows **Declined — counts as a work day**; the day's reminders stand.
5. **I will add this later:** on Home, under *Upload your public liability certificate*, tap **I will add this later**. The line changes to *You said you would add this later — we will text you a reminder. Job offers start once it is in.* Upload the certificate from **Profile** whenever you have it.

## What the colours and labels mean
- **Sent to the office — waiting for a reply** — the office has it; the card is on their board.
- **Ordered / Not ordered** — the office's answer, with their note.
- **No work (requested)** (amber) — waiting for the office to confirm the day.
- **No work** — confirmed; that day's reminders are not counted.
- **Declined — counts as a work day** (amber) — the office did not confirm the day.
- **Missing** on the certificate chip — you chose to add it later; reminders are on.

## If something goes wrong
- **The Request more button is not there** — the job is still an offer or is closed, or you are signed in as a worker. Accept the offer first, or ask the lead painter to raise it.
- **"Pick today or yesterday"** — a no-work day can only be raised for today or yesterday (Melbourne time). Ask the office to mark an older day from their side.
- **No reply after a few hours** — ring the office; the card is on their board with a time against it.

## Related
- [Work orders — contractor](../work-orders/contractor.md)
- [Worker logins — contractor](../worker-logins/contractor.md)
