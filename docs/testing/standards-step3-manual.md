# Call backs, Step 3 — manual test script for Tom

Branch `feat/standards-status-callbacks`. Laptop for the office half, phone for the painter.

## Before you start
1. Paste `supabase/migrations/20270226000000_wo_callbacks.sql`. Read-back: 1 table, 2 policies, no insert, 9 functions, 3 columns, photo kind true, 1 trigger, visit painter on job true.
2. Deploy the branch.

## Route 3 — the customer rang (office)
1. Open a FINISHED job in PC Command (Projects → the job). Scroll to **Call backs** → **Customer called back**.
2. Reported date defaults to today; write what is wrong; add a photo; leave **Workmanship**; pick a return day; pick who fixes it (the painter who did the job is first). **Log call back**.
3. Check: the painter's row on the schedule board shows the visit; **Flow** shows a **Call backs** column at the top and the job card carries **Call back · Invoice chasing paused**; **Invoicing → the job's Money view** shows the final invoice's reminders paused with the reason; the job is still Closed.
4. The fixer gets a text: "call back at <address> on <day>: <what is wrong>".

## The painter (phone)
1. Home → **Call backs** lists it. Tap → the **Call back** card on the job: what is wrong, your photos, the return visit day.
2. **Fixed — add a photo** → add a photo → **Mark as fixed**. The card reads "waiting for the office to confirm".

## Close it (office)
1. PC Command shows **<painter> marked the call back at <address> fixed** → **Confirm and close** → on the job page, **Confirm and close**.
2. Check: the Flow column is gone, the invoice reminders have resumed, the record reads **Closed**.

## Route 1 — a failed quality check
1. On a job at **05 Quality check**, log a FAIL with a note. The card now asks **Can the contractor rectify today, or is it a call back?** Pick a return day and **Call back**. A call back appears on the job, linked to the check; the check is still a FAIL.

## Route 2 — a flagged walk-through
1. When a customer flags an area at the walk-through, PC Command shows **Walk-through flagged an area at …** with **Is a call back required?**. If the painter fixes and the customer signs today, press **Rang them** to clear it. Otherwise **Is a call back required?** opens the job with the form ready; log it.

## Route 4 — the schedule board
1. Drag across empty days on a painter's row → **Extra visit** → search the finished job → tick **Call back — this visit fixes workmanship on a finished job** → write what is wrong → **Add the visit**. If the job already has an open call back the message says it joined it.

## Reason and void
- **Mark not workmanship** on the job page: logged, and it no longer counts toward the painter (Step 5). **Void** appears only for the owner and asks why.

## What to tell me
- Wording on any of the cards, the question, or the text.
- Whether "Invoice chasing paused" should also show on the Invoicing list (today it is on Flow and the Money view's tooltip).
