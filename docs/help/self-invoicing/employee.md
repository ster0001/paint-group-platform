---
feature: self-invoicing
role: employee
title: Claim an expense you paid for on a job
summary: The Expenses tab for employed painters — a receipt photo, the category, the amount from the receipt, which job, and who paid; what happens over $100; and how a claim you paid yourself gets paid back.
sources: app/portal/money/page.tsx, app/portal/money/Expenses.tsx, app/portal/money/expenseActions.ts
---

## What this is for
As an employed painter you never invoice Paint Group — you are paid through payroll. The **Expenses** tab is only for things you bought for a job: a top-up of materials, sundries, parking, tip fees. Every claim needs a photo of the receipt, and the office approves it. If you paid on the company card it is simply recorded against the job. If you paid with your own money, the office pays you back once it is approved.

## Before you start
- You need to be on a job. Claims are made against a job, so **Expenses** shows "Nothing to claim against yet" until one is assigned to you.
- Have the receipt in front of you: the amount you enter is the receipt's total including GST, and the GST shown on it.
- Anything over **$100** needs asking first. Tap **Ask before I buy** with a description and a rough cost; the office answers in the app. Without that, a claim over $100 still sends but is flagged for the office to look at.

## Steps

### Claiming an expense
1. Open **Expenses** and tap **＋ Claim an expense**.
2. Tap **Attach the receipt** and take a photo of it (or pick a PDF). No photo, no claim.
3. If you are on more than one job, pick **which job**. Choose the **category**, type the **amount** from the receipt and the **GST** shown on it, and add a note if it helps.
4. Choose who paid: **Company card** (the default) or **My own money**. The line under the buttons says what happens: a company-card purchase is a job cost with nothing to pay back; your own money is paid back once approved.
5. Tap **Claim $…**. The claim appears in your list with **submitted** until the office decides. Approved claims read **approved**, then **paid** once the office has paid you back (own money) — a company-card claim stays **approved**, because there is nothing to pay out.

### Asking before you buy
6. Over $100? Tap **Ask before I buy**, say what you need and roughly what it costs, and send. The office's answer — a yes with a spending cap, or a no — shows on the same tab. A claim inside the cap goes through without the flag.

## What the colours and labels mean
- **submitted** (amber) — with the office.
- **approved** (cyan) — the office agreed. If you paid yourself, the money is on its way.
- **paid** (green) — paid back to you.
- **rejected** (clay) — the office said no; ring them if you think that is wrong.
- **over the threshold without pre-approval** — more than $100 and you did not ask first; the office looks at it more closely.

## If something goes wrong
- **"Attach the receipt — no photo, no claim."** The photo did not attach. Retake it; keep it under the size limit.
- **The claim sends but says who paid did not save.** The office sees it as paid by you and will check; nothing is lost.
- **You cannot see the Expenses tab.** Your login may be set up as a contractor rather than an employee — ask the office.

## Related
- [Your assigned jobs, accepting one, and your calendar](../scheduling/employee.md)
- [Run a job from the first tick to the customer's signature](../work-orders/employee.md)
