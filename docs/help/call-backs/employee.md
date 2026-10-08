---
feature: call-backs
role: employee
title: A call back — what is wrong, when to go back, and marking it fixed
summary: When a job needs a return visit to fix workmanship, the office logs a call back. It shows on Home and on the job with what is wrong, the photos and the day of the return visit. You mark it fixed with a photo; the office confirms and closes it.
sources: app/portal/jobs/[id]/CallbackCard.tsx, app/portal/page.tsx, app/portal/callbackActions.ts, lib/callbacks
---

## What this is for
A call back is a return visit on another day to fix something on a job you did. The office logs it when a quality check cannot be fixed the same day, when the customer flags an area at the walk-through and it needs another day, or when the customer rings after the job. It always counts against the painter who did the job, even if another painter is booked to fix it. 

## Before you start
- You get a text when the return visit is booked: the address, the day and what is wrong.
- The visit is in your **Calendar** too.

## Steps
1. On **Home**, **Call backs** lists each one. Tap it to open the job. The **Call back** card says what is wrong, shows the office's photos and the **return visit** day.
2. Go back on that day and fix it. Then tap **Fixed — add a photo**, add a photo of the fix, write what you did if you want, and tap **Mark as fixed**.
3. The card now reads **waiting for the office to confirm**. The office closes it; nothing more for you to do.

## What the colours and labels mean
- **Call back** (clay) — open, or booked.
- **Waiting** — you marked it fixed; the office confirms.

## If something goes wrong
- **"Add a photo of the fix first"** — the photo is required.
- **The return visit day does not suit** — ring the office; they move it.

## Related
- [Run a job from the first tick to the customer's signature](../work-orders/employee.md)
- [The finish standards](../standards/employee.md)
