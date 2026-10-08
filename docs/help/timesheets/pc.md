---
feature: timesheets
role: pc
title: Employed painters' days — logged and approved automatically, plus time off and the payroll CSV
summary: The Timesheets tab in PC Command — the standard day that logs itself every evening and approves itself, the one kind of day that still waits (no cost rate), days that need a manual entry, painters' extra hours, leave and RDO requests, recording a day by hand, the allocated-vs-actual table, the payroll CSV, and where the cost rate lives.
sources: app/pc/timesheets/page.tsx, app/pc/timesheets/StandardDay.tsx, app/pc/timesheets/TimesheetRow.tsx, app/pc/timesheets/LeaveRow.tsx, app/pc/timesheets/RecordHours.tsx, app/pc/timesheets/export/route.ts, app/api/cron/wo-sweep/route.ts, app/(app)/contractors/ContractorsManager.tsx
verified_at_commit: 83a6a8ba48
---

## What this is for
Employed painters do not clock on. Every evening a **standard day** (7:30–3:30 with a 30-minute break by default) is logged for each employee on a job that weekday, ending at the sign-off if the job closed earlier. Painters add only extra hours. **Since 7 October 2026 there is no approval step**: painters are salaried for an eight-hour day, so every day — the standard day, extra hours, a day the office types in — approves itself the moment it is logged. **Approving posts the hours to the job as one labour-cost line** at that painter's internal cost rate on that day, so an employee job carries its labour cost the way a contractor job carries the offer — and the job's GP on the PC job page moves by exactly that. The painter only ever sees hours. Payroll takes the CSV; the platform never calculates pay.

## Before you start
- Each employee needs a **cost rate** before any of their days can post to a job. A day logged with no rate covering it is the one kind of day that waits here for you — it is never lost, and it approves with one press once the rate is in. Set it on **Painters** (the Contractors page): on an employee's row, type the dollars per hour in **Cost rate** and press **Save**. It is your internal cost — base plus super, WorkCover and allowances divided by hours — and applies from the day you save it (history is kept). A day worked before the rate's start date cannot be approved; the row says so.

## Steps

### The standard day
1. Open **PC Command → Timesheets**. **Standard day** at the top shows the start, finish and break the evening fill logs — change them and **Save**; they apply from the next fill. **Approve all standard days (n)** clears any filled day that was waiting on a rate, once the rate is in — on a normal week it reads (0). **Fill that day now** runs the fill for a day the evening sweep missed (it refuses a day that has not reached the standard finish yet).
2. **Needs a manual day** lists any painter who was on two jobs on a weekday with nothing logged — nothing is filled for them; record each job's hours below, or they tap Start / Finish on each job.

### The days that wait
3. Days approve themselves, so the list is normally empty. A card appears only for a day no cost rate covers, or a day left running that closed itself at 16 hours. Each card is one painter's day: the job, start and finish, the break, the hours to two places, and where it came from — **standard day**, **logged by the painter** (extra hours, with their note) or **entered by the office**.
4. Set the rate on Painters if that is what is missing, then press **Approve**. The card reads **Approved ✓** and the job's money view (Costs tab) gains a line "Labour — <painter> · <date> · <hours> h" at hours × rate, GST nil. It is a cost on the job only — it does not appear on **Invoicing → Payables**, because employees are paid through payroll.
5. Something wrong with a waiting day? Press **Send back**, type why, then **Send back** again. The painter sees the reason under that day; the day posts nothing. A day that has already approved itself cannot be sent back — correct it on the job's Costs tab.

### Time off requests
6. **Time off requests** lists every leave or RDO an employed painter has asked for. **Approve** puts it on the board as time off (the Schedule refuses to book them over it) and texts them. **Decline** asks for a word on why, which they see under the entry. If the days land on a job they are booked on, the card says so up front and Approve refuses until you reassign those days on the Schedule — or decline. A sick day never appears here: it counts at once and raises **Reassign** on Today for any booked day. You can mark a painter sick, on leave or on an RDO yourself from the Schedule board's **Block out days** (pick the kind on an employee's lane); leave and RDO entered by you count as approved at once.

### Recording a day the painter forgot
7. In **Record a day for a painter**, choose the painter, the job (only jobs they are assigned to are offered), the date, start and finish times and the break, then **Record**. It posts to the job at once ("Recorded and approved"); if no cost rate covers that day it joins the list instead, and the message says so.

### Payroll
8. **Payroll CSV → Last 7 days / Last 14 days** downloads the approved days: painter, job, date, start, finish, break, hours, source, approved at. No rate and no pay column — payroll works those out.

### Allocated vs actual
9. The table lists every job with approved hours in the last 60 days against the hours the estimate allowed. Actual in amber means it has run over.

## What the colours and labels mean
- **Approve / Send back** — the day is waiting on you (no cost rate, or it ran past 16 hours).
- **Still running** — the painter has not tapped Finish day yet.
- **Approved ✓** — posted to the job (by the rule, or by you).
- **Not approved** — sent back with a reason.
- **"No cost rate covers this day"** — set the rate on Painters (dated on or before the day) before approving.
- **"Booked on WO-… — reassign those days first, or decline."** on a time-off card — approving would empty a booked day.
- **Today's queue**: **Not accepted** (a painter who has not tapped Accept on a job starting within a day — ring them), **Time off** (a request to decide), **Reassign** (sick or can't make it on a booked day). Each clears by itself once the fact behind it changes.

## If something goes wrong
- **"Recorded — waiting, because no cost rate covers that day."** / **"No cost rate is set for this painter."** Set one on Painters (dated on or before the day), then press Approve on the waiting card.
- **"That painter isn't assigned to that job."** Recording only works for a job the painter is on; assign them on the Schedule first.
- **A painter says yesterday was not logged.** They were on two jobs (see Needs a manual day), were sick or on leave, it was a weekend, or the fill has not run — press **Fill that day now**.
- **"A day can't run past 16 hours."** A day left running overnight closes at 16 hours; send it back and record the real times.
- **The CSV download says Not found.** You are not signed in as staff.
- **There is no Employee tick box on the Contractors page.** The **Employed painters** switch at the top of that page is off — turn it on. Off never changes an existing employee.

## Related
- [Assign employed painters to a job on the board](../scheduling/staff.md)
- [Employee reimbursements on Payables](../invoicing/staff.md)
