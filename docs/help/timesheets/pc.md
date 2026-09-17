---
feature: timesheets
role: pc
title: Approve employed painters' days, record one for them, and export the payroll CSV
summary: The Timesheets tab in PC Command — each clocked day waiting on approval, what approving does to the job's costs, recording a day the painter forgot, the allocated-vs-actual table, the payroll CSV, and where the cost rate lives.
sources: app/pc/timesheets/page.tsx, app/pc/timesheets/TimesheetRow.tsx, app/pc/timesheets/RecordHours.tsx, app/pc/timesheets/export/route.ts, app/(app)/contractors/ContractorsManager.tsx
verified_at_commit: 82053bb807
---

## What this is for
Employed painters clock on and off in their portal. Every finished day lands here for you to approve. **Approving posts the hours to the job as one labour-cost line** at that painter's internal cost rate on that day, so an employee job carries its labour cost the way a contractor job carries the offer — and the job's GP on the PC job page moves by exactly that. The painter only ever sees hours. Payroll takes the CSV; the platform never calculates pay.

## Before you start
- Each employee needs a **cost rate** before any of their days can be approved. Set it on **Painters** (the Contractors page): on an employee's row, type the dollars per hour in **Cost rate** and press **Save**. It is your internal cost — base plus super, WorkCover and allowances divided by hours — and applies from the day you save it (history is kept). A day worked before the rate's start date cannot be approved; the row says so.

## Steps

### Approving a day
1. Open **PC Command → Timesheets**. Each card is one painter's day: the job, start and finish, the break, the hours to two places.
2. Press **Approve**. The card reads **Approved ✓** and the job's money view (Costs tab) gains a line "Labour — <painter> · <date> · <hours> h" at hours × rate, GST nil.
3. Something wrong? Press **Send back**, type why, then **Send back** again. The painter sees the reason under that day; the day posts nothing.

### Recording a day the painter forgot
4. In **Record a day for a painter**, choose the painter, the job (only jobs they are assigned to are offered), the date, start and finish times and the break, then **Record**. It joins the list marked "entered by the office" and still needs approving.

### Payroll
5. **Payroll CSV → Last 7 days / Last 14 days** downloads the approved days: painter, job, date, start, finish, break, hours, source, approved at. No rate and no pay column — payroll works those out.

### Allocated vs actual
6. The table lists every job with approved hours in the last 60 days against the hours the estimate allowed. Actual in amber means it has run over.

## What the colours and labels mean
- **Approve / Send back** — the day is waiting on you.
- **Still running** — the painter has not tapped Finish day yet.
- **Approved ✓** — posted to the job.
- **Not approved** — sent back with a reason.
- **"No cost rate covers this day"** — set the rate on Painters (dated on or before the day) before approving.

## If something goes wrong
- **"No cost rate is set for this painter."** Set one on Painters, then approve.
- **"That painter isn't assigned to that job."** Recording only works for a job the painter is on; assign them on the Schedule first.
- **"A day can't run past 16 hours."** A day left running overnight closes at 16 hours; send it back and record the real times.
- **The CSV download says Not found.** You are not signed in as staff.

## Related
- [Assign employed painters to a job on the board](../scheduling/staff.md)
- [Employee reimbursements on Payables](../invoicing/staff.md)
