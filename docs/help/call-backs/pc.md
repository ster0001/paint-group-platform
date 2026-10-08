---
feature: call-backs
role: pc
title: Log a call back, book the return visit and close it
summary: A call back is a return visit on another day to fix workmanship. One record, four ways in — a failed quality check, a flagged walk-through, the customer ringing, or a visit ticked as a call back on the schedule board — each with a reason and the date it was reported. It pauses the customer's invoice chasing until you close it, counts against the painter who did the job, never reopens a closed job and never touches the painter's pay.
sources: app/pc/wo/[id]/CallbackPanel.tsx, app/pc/wo/[id]/QaCheck.tsx, app/pc/schedule/ScheduleBoard.tsx, app/pc/flow/page.tsx, app/pc/page.tsx, lib/callbacks, lib/crm/work-queue.ts, supabase/migrations/20270226000000_wo_callbacks.sql
---

## What this is for
Until now there was no way to record that a job needed a return visit. Every call back is now one record on the job with a **source** (how it came in), a **reason** (workmanship or not — only workmanship ever counts against the painter), the **date it was reported**, what is wrong, photos, the return visit and who is fixing it. The painter it counts against is the one who did the job, even when someone else is booked to fix it.

## Before you start
- Migration `20270226000000_wo_callbacks.sql` applied. Until then the job page's Call backs card says so.
- A call back can be logged on a closed job; the job stays closed. It can be logged on a job in progress too (a failed check, a flagged walk-through).

## Steps

### Route 3 — the customer rang
1. Open the job in PC Command and find the **Call backs** card. Tap **Customer called back**.
2. Check the **reported** date (today by default), write **what is wrong**, add photos, choose **Workmanship** or **Not workmanship**, pick the **return visit** dates and **who fixes it** (the painter who did the job by default). Tap **Log call back**.
3. The return visit appears on the schedule board and in the fixer's calendar; they get a text with the address, the day and what is wrong. The customer's invoice reminders pause until you close it.

### Route 1 — a failed quality check
1. Log the fail as usual. The card then asks **Can the contractor rectify today, or is it a call back?**
2. **Fixed today** records a failed check and nothing more. **Call back** (with a return day) logs the call back against the painter, linked to the check.

### Route 2 — the walk-through flagged an area
1. When the customer flags an area, PC Command shows **Walk-through flagged an area at …** with **Is a call back required?**. If the painter fixes it and the customer signs the same day, it is a pass after a fix — tap **Rang them** to clear the card and do nothing else. If it is not signed by the end of that day the card turns critical.
2. **Is a call back required?** opens the job with the form ready (source: flagged at the walk-through). Log it; the sign-off record reads *failed_callback*.

### Route 4 — a visit on the schedule board
1. Drag across empty days on the painter's row, choose **Extra visit**, pick the finished job and tick **Call back — this visit fixes workmanship on a finished job**. Write what is wrong in the note.
2. If the job already has an open call back the visit joins it; nothing is counted twice.

### Working the call back
- **Flow** shows a **Call backs** column above the lanes only while one is open, and a **Call back** tag (and **Invoice chasing paused**) on the job card.
- The queue carries one card per state: no return visit booked (**Book the visit**), the visit is today or tomorrow, and **marked fixed** by the painter (**Confirm and close**).
- On the job page: **Book the visit** / **Move the visit**, **Mark not workmanship** / **Mark workmanship** (the reason is logged either way), **Confirm and close** — only this ends a call back — and, for the owner, **Void** with a reason.

## What the colours and labels mean
- **Call back** (clay) — open: no visit yet, booked, or marked fixed.
- **Closed** (green) — confirmed by the office. **Voided** — logged in error; it no longer counts.
- **Invoice chasing paused** — the hold a call back set; a close or a void clears it, a dispute hold set by hand stays.

## If something goes wrong
- **"No painter is on this job"** — the job has no contractor or lead painter; put one on it first.
- **The painter cannot mark it fixed without a photo** — by design; they add a photo of the fix on the job.
- **Only the owner can void** — the PC changes the reason instead; both are on the record.

## Related
- [Work orders in PC Command](../work-orders/pc.md)
- [Finish standards](../standards/pc.md)
