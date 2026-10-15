---
feature: invoicing
role: staff
title: Payments — collect from customers, pay contractors and suppliers, and see each job's profit
summary: The one Payments page (Payments in the sidebar): the headline and four blocks, chasing customers by job, one-press Paid with Undo, cash, sending with a due date, the deposit size, messages, the job panel with Money in and Money out and profit, contractor invoices (approve, pay with a reference, Green fast terms and holds, RCTIs, expenses and ask-first requests), supplier invoices (confirm, record as any cost, no job yet), Activity, card payments, what the customer sees when they press Pay, and when an invoice turns overdue.
verified_at_commit: 1eea2f4e0b
---

## What this is for
**Payments** is where the office sees and moves all of the money on every job: what customers owe us, what we owe contractors, and supplier invoices for materials and other costs. Everything is on one page, and each job opens in a panel with its invoices and its profit. The old Invoicing list (`/invoices`) and the Receivables and Payables tabs are gone; old links to them land here.

## Before you start
- You are signed in as staff with **Payments** ticked under Settings → Staff logins.
- Every accepted job is here. Its deposit is drafted at 50% when the customer accepts; you can change that before it is sent.

## The page at a glance
- **The headline** says in words what needs doing today: jobs with no deposit in, invoices overdue, contractor invoices past their pay-by date. It is written from the figures below each time the page loads.
- **Four cards** — press one to switch to it:
  - **Customers owe us**: the total on sent invoices, how much is not sent yet, and anything overdue.
  - **Contractors**: what we owe contractors, how many invoices wait for approval, approved to pay, and any expenses to decide or money owed back to employees.
  - **Materials**: supplier invoices to check, to approve and to pay, and how many have no job yet.
  - **Activity**: what customers paid in the last 14 days, and the event list.
- Everything you pick is in the address (`?tab=con`, `?view=table&q=Kite`), so a view can be bookmarked or sent to someone.

## Customers
1. Use the **stage strip** to see money by job stage (Offered through Closed). Press a stage to show only those jobs; press it again to show them all.
2. Choose a view:
   - **To chase** (the default): overdue first, then deposits not in, then what is due. Jobs with nothing to collect are counted underneath.
   - **By job stage**: a board, one column per stage.
   - **All jobs**: a table with Deposit, Progress and Final for every job, and the filters **All · Overdue · Deposit not in · Final unpaid · Paid in full**. Paid jobs only show under **Show paid jobs** or **Paid in full**.
3. Search by address, customer name or **invoice number** (INV-0049 finds its job).
4. Under the list, **Aged receivables** splits the money on sent invoices by days overdue: not overdue, 1–7, 8–14, 15–30, over 30.

### The buttons on a job
- **✓ Paid $amount** records a bank transfer for the full amount, dated today, in one press. A bar appears at the bottom with **Undo** for a few seconds. The receipt emails once the Undo has gone.
- **Cash or part** opens the payment sheet: Bank, Cash or Other, the amount, and the date it arrived (never in the future).
  - **Cash** against an invoice you have not sent: the invoice is not sent to the customer; the payment is still recorded against the job.
  - **Send notification of payment**: on means the customer gets an email confirming the cash; off means nothing is sent.
- **Send** (a draft) asks for the due date first. A deposit due on or after the start date is flagged. The due date can be changed any time before sending.
- **Adjust** (a deposit) offers 10%, 20%, 30%, 50% or a dollar amount, and shows what that leaves for later.
- **Message** opens the customer's chat in the bottom-left corner with a message already written for you: a deposit reminder, a friendly reminder, an overdue note or a thank-you, with the pay link. Edit it if you like. Nothing goes until you press **Send**: the customer gets the whole message by email and a text with a link to the chat. The job then says "messaged today".

## The job panel
Press a job's address to open its panel over the list (full screen on a phone). Press outside it, or **‹ Payments**, to close it. The same panel is the job's own page, `/invoicing/job/…`, which is what PC Command's **Payments →** opens; from there the back link returns to the work order.

At the top: the stage, the payment rail, and **Job total · Paid · Still owing** — the same figures as the job's row.

### Money in
Every invoice is a card with its payments listed under it.
- **A draft**: change its **Due date**, **Check invoice**, **Delete draft**, **Already paid**, or **Send**. A deposit draft has the size buttons on the card.
- **A sent invoice**: **Change amount** (a deposit), **Cancel, invoice in full** (a deposit or progress claim with nothing paid on it), **Pause reminders** / **Resume reminders**, **Void**, **Open invoice**, **Cash or part**, **✓ Paid**.
- **Cancel, invoice in full**: the job is finished and the deposit was never paid, so you want one invoice for the whole job. Press it on the unpaid deposit and confirm: the deposit (and any unpaid progress claim) is cancelled with its number burnt, and one final invoice for the whole job is drafted beside it. Check the draft and press **Send** as usual. The customer's old link says that invoice has been cancelled. It refuses if any money has already been paid on the deposit; the ordinary final already takes that money off.
- **This draft was worked out before an earlier invoice was issued… Redraft**: a final drafted while the deposit was still a draft charges the whole contract. Press **Redraft** and it is worked out again from what is left to invoice. New finals now redraft themselves when an earlier invoice is issued.
- **No $0 finals, no leftover deposits.** When a job is signed off with nothing left to invoice, no final is drafted. When a final is first drafted at sign-off, a deposit that was never sent is removed: the final already asks for that money. Redrafting a final never removes a deposit.
- Above the cards: **Request a payment** (a share of the job or a fixed amount, drafted for you to check), **Invoice in full**, and **Revise scope**.

### Money out and profit
- **Gross profit** is the job value excluding GST, less every cost recorded: the contractor's offer plus accepted variations, own painters' labour, materials, other trades and costs, and approved contractor expenses. Hover over a line to see the rows it adds up. "So far, job still open" until the job is closed.
- **Own painters: every booked day counts, from the day it is booked** (since 15 October 2026). For each employed painter on the job, every Monday to Friday inside their booking (public holidays excluded) is a work day at the standard day's hours × that painter's cost rate on the day — tomorrow's and next week's days included, so a job booked for a fortnight shows the whole fortnight's labour the moment it is booked. A day already logged shows as its recorded line ("Labour — Adi · 16 Oct · 7.50 h"); a day not yet logged shows as "Adi · 16 Oct · booked 7.5 h" with a **Booked** tag, and becomes the recorded line when the evening fill logs it. Weekends count only when the office records one (Timesheets → Record a day). Days an employee logs outside their booking count too.
- **No cost rate = nothing can be priced.** A note under the profit names any painter whose booked days have no cost rate ("No cost rate is set for Adi Rapoport (6 booked days)…"). Set it on Painters (the Contractors page); the days then post themselves and the note goes.
- **An employee job has no contractor line.** When the crew is employees and no offer is live, the figure the job sheet carries as the painter's pay is the estimate's labour budget, not money owed to anyone — it is not a cost here. Before 15 October 2026 it was counted on top of the painters' days, so every employee job read two labour costs.
- A job under way with no materials recorded shows a note: the profit reads too high until the supplier invoices are matched.
- **Contractor invoices on this job** have **Approve** and **✓ Paid**.
- **Supplier invoices on this job** have **View**.
- **Costs recorded on this job**: scaffold, rubbish and other trades have **Approve**, then **✓ Paid** (with Undo). Employee **Labour** lines have no buttons: employees are paid through payroll.
- **Add a cost** records a cost with its document.

## Contractors
Sections, worst first: **Past the pay-by date**, **To approve**, **Approved, to pay**, **With the contractor**, **Paid**. Each row says what the customer has paid on that job.
1. **Approve** — one press, with Undo. An **RCTI** (an invoice drafted for the contractor under their agreement) waits under To approve and is approved the same way; its figures are set when you approve it.
2. Pay by bank, then either **✓ Paid** (one press, today) or **Paid, with reference…** to record the bank reference and the date it went. The remittance goes to the contractor once the Undo has closed.
3. **Query** opens the painter's messages on the work order.
4. **By contractor** groups the rows, with **Approve all** and one **✓ Paid** for everything approved.

### Green fast terms and the hold
A contractor on **Green** when the job is signed off is paid **3 business days** after the signed day; the row shows **Green · 3 business days**. If the customer raises something, press **Hold fast payment** and say why: the invoice goes back to the normal due date, the row reads **Held — reason**, and PC Command and the CRM show a **Payment hold** until you press **Release**. A **Bonus** row is a painter's approved bonus they have claimed.

### Expenses
Under the invoices:
- **Expense claims to decide**: **Approve** (it rides the contractor's next invoice) or **Reject** (they see why in their app). **Receipt** opens the photo.
- **Ask first: over-threshold purchases**: **Approve…**, type the most they may spend, and confirm; or **Decline**.
- **Owed back to employees**: claims an employed painter paid from their own pocket. Pay them through payroll or a transfer, then press **Paid back**.

## Materials
- **To check**: invoices that arrived at bills@ or were snapped as receipts. Each shows the supplier, invoice number, date and GST read from the document, what the supplier wrote as the reference, and the job found. When the job came from the order reference the row says how sure the reader was.
  - **Confirm** files it on the job found, as materials, approved.
  - **Other job** / **Pick a job** chooses the job yourself. **Not for a job** files it as overhead.
  - **Record as a cost…** is for anything that is not materials (scaffold, rubbish, carpentry…), or for a document the reader could not read: choose the kind of cost and the job, and type or correct the total and GST.
  - **Delete** keeps the document and counts it nowhere; **Restore** puts it back. A possible duplicate has **Dismiss**.
- **On a job, to approve** and **Approved, to pay**, grouped by supplier with one **✓ Paid** per supplier (with Undo).
- **No job yet**: materials recorded (mostly from the Airtable sync) that sit on no job, so no job's profit counts them. Press **Assign to a job**. Home's **Materials to match** tile counts these and opens this list.
- **Snap a receipt** picks a job and opens Add a cost for the photo.

## Activity
The newest invoice events: drafted, sent, viewed, paid, undone, voided, reminders paused and resumed, messages sent. Every "viewed by customer" for one invoice is a single line with how many times and over which days.

## Card payments — the one button in Settings
Open **Settings → Money → Invoicing** and find **Card payments (Stripe)**. The line under the heading says whether card payments are **on** or **off**, and the button beside it does the one thing:
- **Add card payments** turns them on. The customer's Pay box gains an **Or pay online by card** option with the surcharge disclosed, and card payments record themselves when Stripe confirms them.
- **Remove card payments** turns them off. The Pay box shows bank transfer only.

## What the customer sees when they press Pay
On the invoice page a customer presses **Pay $amount** and a box opens with the amount due for that document, our account name, bank, BSB and account number, and the invoice number as the **Reference** with a **Copy** button. The printed invoice and the PDF keep the bank details on the page instead.

## What a deposit invoice shows
A deposit invoice lists every line item from the accepted estimate under **Contract works — from your accepted estimate**, then the deposit itself under **This invoice**. The scope lines are for information; they are not added into the deposit's total.

## What the colours and labels mean
- **Orange** — a deposit not in. A job starting within a week, or already under way, glows.
- **Red** — overdue: money still owing at **midday the day after the due date**. An invoice due Tuesday turns overdue at 12:00 on Wednesday, the moment the first reminder goes.
- **Cyan** — sent, not yet due.
- **Green** — paid.
- **Grey** — a draft, not sent yet.
- **Paid in cash, not sent** — the cash cleared an invoice the customer never received; it stays as our record of the sale.

## If something goes wrong
- **A red box saying the payments could not be loaded.** Something failed to read; the page is not empty. Reload; if it stays, the error has already been reported.
- **"Nothing is left to invoice for the contractor on this job."** Earlier contractor invoices already cover the agreed pay. Check the offer and variations on the work order.
- **"Check the amount and try again."** The amount is more than the balance plus 5 per cent, or zero. Check what was received.
- **Pressed ✓ Paid by mistake.** Press **Undo** on the bar at the bottom straight away — it stays for a few seconds, and the receipt or remittance only goes once it has gone. After that, ask the owner to reverse the payment.

## Related
- Contractor invoices from the contractor's side: self-invoicing/staff.md
- The work order's money and the job sheet: work-orders/pc.md
