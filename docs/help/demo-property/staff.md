---
feature: demo-property
role: staff
title: Set up or reset a contractor's practice job from their record
summary: On a contractor's record under Contractors there is a Demo property line. Set up demo gives them 12 Demo Street for the induction; Reset demo puts it back to the start. It never appears in their job list, their offers count, or anywhere money or status is counted.
sources: app/(app)/contractors/[id]/page.tsx, app/components/demo/DemoControls.tsx, app/components/demo/demoActions.ts, supabase/migrations/20270262000000_demo_property.sql
---

## What this is for
Before an induction the facilitator makes sure 12 Demo Street is on each new contractor's account. This is where you do that without signing in as them. The same line resets it afterwards.

## Before you start
The contractor must exist as a contractor (not an employed painter — employees get their practice job with the worker induction).

## Steps
1. Open **Contractors** and the painter's record.
2. Find **Demo property** in the details list. It reads **Not set up** or **12 Demo Street is on their account**.
3. Tap **Set up demo**. The line changes to show it is on their account. Doing it twice does nothing more — there is only ever one.
4. Tap **Reset demo** to start it over. It asks once. The old practice job and everything done in it is deleted and a fresh one is seeded, in one step.

## What the colours and labels mean
- **Not set up** — no practice job on the account.
- **12 Demo Street is on their account** — one exists; it is not in the job list below.

## If something goes wrong
- **"The practice job is for contractors"** — the record is an employed painter.
- **Set up or Reset fails** — it has been reported to the error monitor; try again, then tell the developer.

## Related
- [12 Demo Street for the painter](contractor.md)
- [12 Demo Street for the PC](pc.md)
