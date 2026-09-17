---
feature: timesheets
role: employee
title: Start your day, finish your day — your hours
summary: The Start day / Finish day card for employed painters — two taps on the home page or the job, the break you took, what the office does with the hours, and what the status words mean.
sources: app/portal/TimesheetCard.tsx, app/portal/timesheetActions.ts, lib/contractor/timesheets.ts
verified_at_commit: 82053bb807
---

## What this is for
As an employed painter your hours go to payroll from the app. You tap **Start day** when you are on the tools and **Finish day** when you knock off; the office checks each day and approves it. That is all the app asks — it never shows you a rate or a dollar figure, and it never works out your pay. Payroll does that from the hours the office approves.

## Before you start
- You need to be on a job today. **Start day** on the home page clocks you on to today's assigned job; if you are on two jobs today, open the one you are at and start the day from there.
- Only one day can be running at a time. If you forgot to finish yesterday, finish it first — the office will fix the times.

## Steps

### Starting and finishing
1. On the home page (or the job page) find **Your day** and tap **Start day**. The card shows the time you started.
2. At the end of the day choose the **break you took** (none, 30, 45 or 60 minutes) and tap **Finish day**. The card says how many hours went to the office.
3. Under the card your last few days are listed with their hours and a status.

### If you forgot to tap
4. Tell the office. They can record the day for you from their screen; it shows in your list marked the same way, waiting on approval.

## What the colours and labels mean
- **Running** (amber) — the day is open; tap Finish day when you knock off.
- **With the office** — finished; waiting on their approval.
- **Approved** (green) — the office has approved the hours. Nothing more to do.
- **Not approved** (clay) — sent back, with the reason under the entry. Talk to the office; they can record the right times.

## If something goes wrong
- **"Nothing is booked for you today."** No job is assigned to you today. Open the job you are on and start the day from its page.
- **"You're on more than one job today."** Start the day from the job page of the one you are at.
- **"Your day is already running."** Finish it before starting another.
- **"That's under a minute of work."** Start and Finish were tapped almost together; tap Start again when you are on the tools.
- **"Your day is running on another job."** (on a job page) Finish it from the home page first.

## Related
- [Your assigned jobs, accepting one, and your calendar](../scheduling/employee.md)
- [Claim an expense you paid for on a job](../self-invoicing/employee.md)
