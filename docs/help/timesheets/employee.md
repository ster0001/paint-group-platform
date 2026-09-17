---
feature: timesheets
role: employee
title: Your hours — logged for you, plus any extra you work
summary: How an employed painter's hours reach payroll — a standard day is logged automatically on every day you are on a job, you add only extra hours, Start day / Finish day is for a day with two jobs, and what the status words mean.
sources: app/portal/TimesheetCard.tsx, app/portal/timesheetActions.ts, lib/contractor/timesheets.ts
verified_at_commit: 83a6a8ba48
---

## What this is for
As an employed painter your hours go to payroll from the app, and you do not have to clock in. Every weekday you are on a job, a **standard day** (7:30 am to 3:30 pm with a half-hour break, unless the office has set it differently) is logged for you that evening. If the job was signed off earlier that day, the day ends at the signature. The office checks each day and approves it. The app never shows you a rate or a dollar figure and never works out your pay. Payroll does that from the hours the office approves.

## Before you start
- You need to be on a job. Hours are logged against the job you are assigned to.
- Only one job that day: nothing to do. Two jobs in one day: nothing is logged for you automatically, so use **Start day / Finish day** on each job (below).

## Steps

### A normal day
1. Do nothing. The **Your hours** card on the home page (and on each job) says "A standard day … is logged for you". The next morning the day appears in your list as **Standard day · With the office**, then **Approved** once the office has looked.

### Extra hours
2. Worked past the standard finish, or came in early? Tap **Log extra hours**. Pick the job if you are on more than one, the day (today or up to a week back), the start and finish of the extra time, and a word on what for. Tap **Send extra hours**. It shows as **Extra hours · With the office**.
3. Extra hours cannot overlap a day already on your sheet — log only the time on top of the standard day.

### Two jobs in one day
4. Nothing is logged for you on that day. On each job's page tap **Start day**, then **Start day now**, when you get there, and **Finish day** with the break taken when you leave. The office can also enter it for you.

## What the colours and labels mean
- **Standard day** — logged for you.
- **Extra hours** — what you added, with your note.
- **Entered by the office** — the office typed it in for you.
- **Running** (amber) — a day you started by hand; tap Finish day when you knock off.
- **With the office** — waiting on their approval. **Approved** (green) — done. **Not approved** (clay) — sent back with the reason under it; talk to the office.

## If something goes wrong
- **No day appeared for yesterday.** Either you were on two jobs (log each by hand), you were marked sick or on leave, it was a weekend, or the office has not run the evening fill yet. Ask the office; they can fill any day with one click.
- **"Those hours overlap a day already on your sheet."** Your standard day is already there. Log only the extra time.
- **"Extra hours can be logged for today or the last 7 days."** Older than a week — ask the office to record it.
- **"You're on more than one job today."** Start the day from the job page of the one you are at.

## Related
- [Your assigned jobs, accepting one, your calendar and time off](../scheduling/employee.md)
- [Claim an expense you paid for on a job](../self-invoicing/employee.md)
