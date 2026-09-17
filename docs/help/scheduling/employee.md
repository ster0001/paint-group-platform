---
feature: scheduling
role: employee
title: Your assigned jobs — accepting one, your calendar, and what to do if you can't make a day
summary: How a job reaches you as an employed painter — it lands in your calendar already booked, you tap Accept once to say you've seen it, several of you can share one job with one lead painter, and you can flag days you can't make.
sources: app/portal/jobs, app/portal/calendar, app/portal/jobs/[id]/AssignmentCard.tsx, lib/contractor/employeeJobs.ts
verified_at_commit: 3a6848a2fd
---

## What this is for
As one of Paint Group's own painters you are never offered a job and never asked to price anything. The office puts you on a job with dates, and it is in your **Jobs** and **Calendar** the moment they do. The only thing the job asks of you up front is one tap of **Accept**, which tells the office you have seen it. Nothing waits on that tap: the customer already has their booking confirmation, and the dates are yours either way.

## Before you start
- Sign in to the painter portal with the login the office gave you. The header reads **Painter portal**; the tabs are **Home · Jobs · Calendar · Help**.
- There is no Requests tab and no Invoicing tab. Jobs come to you assigned, and your money side is expenses only (that screen is coming).
- Your phone number on your profile is where the "you're on a job" text goes. Ask the office to check it if you are not getting them.

## Steps

### When a job is assigned to you
1. You get a text and an email: "You're on WO-1042 from Mon 5 Oct — open your work order and tap Accept." Open **Jobs**. The job card carries an amber **Tap Accept** chip, a **Lead** chip if you are the lead painter, the start date, and a **Time budget** line — the days and hours the job has been planned at. There is no price on an employee's card, ever.
2. Tap **Open work order**. At the top, **You're on this job** shows **Your days** (which may be fewer than the whole job if others share it) and the **Time budget**. If several painters are on the job it says so, and whether you are the lead.
3. Tap **Accept — I've seen it**. The card turns from amber to plain and reads "Accepted 5 Oct. Nothing else to do until the day." The office's board shows your block as seen. That is all Accept does; it is not a yes-or-no.
4. If the office moves your days later, you get a "your dates changed — accept again" text and the Accept button comes back. Tap it once more.

### The lead painter
5. Exactly one painter on every job is the **lead**. The customer's confirmation carries the lead's name, the walkthrough prompt comes to the lead, and the lead is who the office rings first. Everyone on the job can tick surfaces, add photos and raise a variation regardless. The office chooses the lead and can change it; you will see **Lead** on your card when it is you.

### Your calendar
6. **Calendar** shows every day you are on a job, in the job's colour, with a walkthrough day marked separately. Tap a booked day to open the job. Tap a free day to block it out — the office sees the block straight away and will not put you on a job over it without a reason.

### If you can't make a day
7. On the job, under the Accept card, tap **I can't make these days**, type why in a few words and tap **Tell the office**. Nothing changes on the job — your days stay yours until the office reassigns them — but a **Reassign** item goes to the top of the office's queue with your reason, so they can sort it. The card then reads "You've told the office you can't make these days." If your dates are moved, the flag clears and the new days need a fresh Accept.

## What the colours and labels mean
- **Tap Accept** (amber chip) — the office has put you on this job and has not yet seen you accept it.
- **Lead** (cyan chip) — you are the lead painter on this job.
- **Time budget** — planned days and hours for the whole job. A size, never a rate.
- **Booked** / **In progress** / **Completed** on a job card — the job's stage, the same as for every painter.

## If something goes wrong
- **A job you were told about is not in Jobs.** Ask the office to check you are on it and that your login is marked as an employee; a painter marked as a contractor sees a different portal.
- **The Accept button does nothing.** Check your signal and try again. If the card says the assignment no longer exists, the office has taken you off the job — they will have been in touch.
- **You see a price anywhere.** You should not. Tell the office which screen; that is a fault, not a feature.

## Related
- [Run a job from the first tick to the customer's signature](../work-orders/employee.md)
