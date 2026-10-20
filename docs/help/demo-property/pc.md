---
feature: demo-property
role: pc
title: 12 Demo Street — a painter's practice job, and why it is in none of your numbers
summary: Every contractor can have one practice job for the induction. It is a real work order on their account, rendered by the same screens, but it is left out of PC Command, the schedule, the Contractors strip, Payments, the dashboard, every sweep and Google Calendar. You can open it from its link and reset it for the painter.
sources: app/pc/wo/[id]/page.tsx, app/pc/demo/page.tsx, app/components/demo/DemoControls.tsx, lib/demo/scope.ts, lib/demo/boundary.test.ts, lib/demo/robots.ts, lib/demo/prompt.ts, lib/demo/checklist.ts, supabase/migrations/20270262000000_demo_property.sql, supabase/migrations/20270263000000_demo_robots.sql
---

## What this is for
The induction runs on the painter's own phone in a practice job, 12 Demo Street. For that to be safe, the practice job must never count: not as a job on the board, not as a variation waiting on a price, not as a payable, not in the painter's traffic light. One flag on the job (`is_demo`) is copied onto everything raised against it — variations, invoices, expenses, call backs, photos, events — and every list the office reads leaves flagged rows out.

## Before you start
Nothing. A practice job exists only when the painter (or staff, from their record) sets one up.

## Steps
1. You will not see it in PC Command, on the schedule board, in Project Progress, under Contractors or in Payments. That is by design.
2. If the painter sends you a link to it, or you open it from their record, the job page opens like any other with an amber **Demo** banner at the top: *The painter's induction demo. It is left out of every count, queue and payment.*
3. **Reset demo** in that banner puts their practice job back to the start — the offer waiting, nothing ticked. It asks once. The painter can do the same from their side.
4. **Send demo prompt** in the same banner is Module 6's one real text: "DEMO: Please update your job in the app today" with a link, to the painter's mobile, through Messaging like any other send (wording under Settings → Messaging → *Induction — the DEMO reminder text*). It plants a reminder on the practice job; the painter's next photo or tick answers it. Nothing else ever texts a practice job.
5. The painter's record under **Contractors** has a **Demo property** line: **Set up demo** when they have none, **Reset demo** when they do.
6. **PC Command → Induction** is the live grid for the room: one row per practice job, one column per phone step (accept, photo, stage, the DEMO text, question, finish date, variation, walk-through, invoice, expense, blocked day, Google Calendar), ticked from the job's own rows. Reload after each slide.
7. A practice job never gets a quality check, whatever the painter's mode or colour: the painter runs the walk-through themselves in Module 9. If one is sitting at the quality-check stage from before 20 Oct 2026, **Reset demo** is the way back.
8. You never price, approve or reply on a practice job yourself: the **Paint Group robot** (a staff login nobody uses by hand) does, a few seconds after the painter's tap, through the same screens' RPCs — and it never alerts you. That includes a request to move the start date: on a practice job the robot approves it; on a real job it still waits for you. If a practice job's variation, invoice or question shows up in your queue, that is a defect.

## What the colours and labels mean
- **Demo** (amber chip) — the practice job. Anything carrying it is excluded from counts.

## If something goes wrong
- **A practice job shows up in a list, count or queue** — that is a defect. Note the screen and tell the office; the guard test (`lib/demo/boundary.test.ts`) should have caught the read.
- **Reset fails** — the painter's record page has the same control; if that fails too, it has been reported to the error monitor.

## Related
- [Contractors — the status light](../pc-contractors/pc.md)
- [Call backs](../call-backs/pc.md)
