---
feature: demo-property
role: contractor
title: 12 Demo Street — your practice job
summary: A practice job on your own account for the induction. It uses the same screens as a real job, nothing in it is real, and nothing you do in it counts toward your status light or your money. Start it from the Jobs tab, find it under the Demo heading, and reset it any time to go back to the start.
sources: app/portal/jobs/page.tsx, app/portal/page.tsx, app/portal/requests/OfferCard.tsx, app/portal/jobs/[id]/page.tsx, app/components/demo/DemoControls.tsx, app/components/demo/demoActions.ts, supabase/migrations/20270262000000_demo_property.sql
---

## What this is for
12 Demo Street is where you make your mistakes instead of on a customer's job. During the induction you do each step on your phone in it — accept the offer, add a before photo, tick a surface — while the slides show the same step on the big screen. It looks and behaves like a real job because it is rendered by the same screens. The difference is the **Demo** label on everything, and that none of it counts.

## Before you start
You need a contractor login. Employed painters get their practice job with the worker induction, not from here.

## Steps
1. Open **Jobs**. At the bottom is a **Demo** heading. If you have no practice job yet it says **Start the practice job** — tap it. You land on 12 Demo Street under an amber **Practice job — nothing here is real** banner.
2. On **Home** the practice job is its own card, above **Your work**. Tap it to open the job.
3. Under **Requests** the practice offer carries a **Demo** chip beside the offer number. (Accepting it is Module 10 of the induction.)
4. The job page is the ordinary job page — scope, colours, materials, the tick list — with the banner at the top. Work through it as the slides say.
5. To go back to the start, tap **Reset demo** in the banner and confirm. You get a fresh 12 Demo Street and the old one is gone, with everything done in it.

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
