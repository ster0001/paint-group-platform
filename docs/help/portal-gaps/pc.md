---
feature: portal-gaps
role: pc
title: Materials requests, no-work days and missing certificates on PC Command
summary: Three cards painters raise from their phone land on PC Command. Materials — order it and reply on the job (the reply shows on the painter's phone). No work today — confirm and that day's update reminders are not counted, or decline. Insurance — a contractor with no verified certificate, with how many reminder texts they have had; no job offers until it is in.
sources: app/pc/page.tsx, app/pc/wo/[id]/MaterialRequests.tsx, app/pc/materialActions.ts, app/pc/wo/[id]/NoWorkDay.tsx, app/pc/noWorkActions.ts, lib/crm/work-queue.ts, lib/automations/sweeps/certificateReminders.ts, supabase/migrations/20270266000000_portal_gaps.sql
---

## What this is for
Painters used to phone or text about paint running out, rained-off days and certificates they would "bring next week". Each of those is now a card on PC Command with a time against it, answered from the job or the contractor's record, and the answer goes back to the painter's phone without a call.

## Before you start
Nothing. The cards appear as painters raise them. The certificate card appears for every active contractor with no verified, unexpired public liability certificate, whether or not they tapped **I will add this later**.

## Steps
1. **Materials** (🪣 card, due in 4 hours): **Reply** opens the job at the **Materials requests** card. Type where and when they can pick it up, then **Ordered**; or **Decline** with the reason. The line on the painter's job changes to *Ordered — …* or *Not ordered — …* the moment you tap. The card clears itself.
2. **No work today** (🌧 card, due in 2 hours): **Confirm or decline** opens the job at **Reminder moments**. **Confirm** marks the day as no work — the reminder moments for that day are skipped, so a missed update there is not counted against the painter. **Decline** leaves the day as a work day; the painter sees *Declined — counts as a work day* on the job.
3. **Insurance** (🛡 card, no due time): **Open painter** opens the contractor's record. Chase the certificate; when it is uploaded, verify it under **Insurance & licences** — the card and the reminder texts stop when the certificate is verified.
4. The reminder texts go out by themselves on days 2, 4 and 6 after the painter tapped **I will add this later** (9 am; `certificate_rules` in Settings). The card shows how many have been sent.

## What the colours and labels mean
- **Amber card** — waiting on you; the time shows how long it has been.
- **Clay (overdue)** — past its due time.
- **Blue (Insurance)** — a standing gap, not a timed one.
- **No work (requested)** on the job — the painter's request; **No work** — confirmed; **no_work_declined** — declined.

## If something goes wrong
- **Confirm says "That request is gone"** — someone already confirmed or declined it; reload the job.
- **The painter says the reply did not show** — they need to reopen the job page; the reply is on the Materials card, not in Messages.
- **A contractor with a certificate still has an Insurance card** — the certificate is uploaded but not **verified**, or it has expired. Verify or ask for a current one.

## Related
- [Worker logins — pc](../worker-logins/pc.md)
- [Work orders — pc](../work-orders/pc.md)
