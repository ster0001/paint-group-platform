---
feature: demo-property
role: contractor
title: 12 Demo Street — your practice job
summary: A practice job on your own account for the induction. It uses the same screens as a real job, nothing in it is real, and nothing you do in it counts toward your status light or your money. Start it from the Jobs tab, find it under the Demo heading, and reset it any time to go back to the start.
sources: app/portal/jobs/page.tsx, app/portal/page.tsx, app/portal/requests/OfferCard.tsx, app/portal/jobs/[id]/page.tsx, app/portal/jobs/[id]/FinishDate.tsx, app/components/demo/DemoControls.tsx, app/components/demo/demoActions.ts, lib/demo/robots.ts, lib/demo/checklist.ts, supabase/migrations/20270262000000_demo_property.sql, supabase/migrations/20270263000000_demo_robots.sql
---

## What this is for
12 Demo Street is where you make your mistakes instead of on a customer's job. During the induction you do each step on your phone in it — accept the offer, add a before photo, tick a surface — while the slides show the same step on the big screen. It looks and behaves like a real job because it is rendered by the same screens. The difference is the **Demo** label on everything, and that none of it counts.

## Before you start
You need a contractor login. Employed painters get their practice job with the worker induction, not from here.

## Steps
1. Open **Jobs**. At the bottom is a **Demo** heading. If you have no practice job yet it says **Start the practice job** — tap it. You land on 12 Demo Street under an amber **Practice job — nothing here is real** banner.
2. On **Home** the practice job is its own card, above **Your work**. Tap it to open the job.
3. Under **Requests** the practice offer carries a **Demo** chip beside the offer number. (Accepting it is Module 10 of the induction.)
4. The job page is the ordinary job page — scope, colours, materials, the tick list — with the banner at the top. Work through it as the slides say. Under the banner is your checklist of the phone steps, ticked as you do them.
5. The office and the customer answer you here, a few seconds after each step: accept the offer and the office confirms on the job's Messages; ask a question and your Project Coordinator replies; change the finish date (with a reason) and it is noted; raise a variation and it comes back priced and approved by the customer, ready for you to Accept; start the walk-through and the customer approves three rooms and flags the hallway — fix it, tick the fix, tap **Fixed** and they walk again and it comes back clean, then they sign on your phone; submit your invoice and it is approved; claim an expense and it is approved. None of it is a real person and none of it is real money.
6. In Module 6 the facilitator sends you one real text, marked **DEMO:**. Tap its link and add a photo to 12 Demo Street — that answers it, the same way a real reminder is answered.
7. To go back to the start, tap **Reset demo** in the banner and confirm. You get a fresh 12 Demo Street and the old one is gone, with everything done in it.

## What the colours and labels mean
- **Demo** chip (amber) — this job, offer or card is the practice job.
- **Practice job — nothing here is real** — the banner on the job page. Everything below it is the real app; nothing below it is a real customer.

## If something goes wrong
- **Start the practice job says "already set up"** — you have one; it is under the Demo heading on Jobs.
- **Reset says it could not reset** — tell your Project Coordinator; they can reset it from your record.
- **You cannot see a Demo heading** — you are signed in as an employed painter. Your practice job comes with the worker induction.

## Related
- [Your status — the traffic light](../painter-status/contractor.md)
- [Finish standards](../standards/contractor.md)
