---
feature: self-invoicing
role: contractor
title: Invoice Paint Group for a job
summary: How your invoices are drafted for you in the portal, how to send a progress claim at any time, how to check and submit the sign-off invoice, and how to see when it has been approved and paid.
walkthrough: media/contractor-walkthrough.gif
sources: app/portal/money, app/portal/profile, lib/workorder/contractorPay.ts
verified_at_commit: d96f549a5a
---

## What this is for
You invoice Paint Group from the **Invoicing** tab of the portal, not from your own accounting software. The platform drafts the figures for you: the agreed amount for the job, plus any approved variations, minus anything you and the office have squared off. You check it and submit in one tap. You can also send a progress payment claim at any point while the job is running. Every invoice carries your own company details, so the document is yours.

## Before you start
- Your company profile must be complete: trading name, ABN, business address and bank details. Until it is, **Invoicing** shows an amber **NOT READY TO INVOICE** card and submitting is held.
- If you are registered for GST, switch on **I'm registered for GST** in your profile. Your invoices then read **TAX INVOICE** and 10% GST is **added on top** of the agreed amount: the agreed figure (for example 38.5 hours at $65 = $2,502.50) is the ex-GST subtotal, and the invoice total is $2,752.75. If you are not registered, they read **INVOICE** with "No GST — not registered" and the total is the agreed amount only.
- The job must have an agreed amount and be yours (accepted through **Requests**). A job with nothing left to invoice does not appear in the claim list.

## Steps

### Finish your profile first
1. Open **Invoicing**. If you see **NOT READY TO INVOICE**, it names what is missing (for example "Still missing ABN"). Tap **Finish my company profile**.
   ![](media/contractor-01.png)
2. Under **Company details** fill in your trading name, ABN, business address, the number of painters on your crew and, if you like, an invoice prefix. Further down, enter your mobile, your bank BSB and account number under **Where you get paid**, and keep your public liability and WorkCover certificates current under **Insurance & licences** (WorkCover is required if anyone works with you; public liability is what unlocks offers). To add a certificate: pick the document type, enter its **expiry date** (a certificate cannot be saved without one), **Choose file**, then **Upload**. A certificate already on file with no date shows a **Save expiry** box beside it.
   ![](media/contractor-02.png)

### Send a progress claim while the job is running
3. Back on **Invoicing**, the **Invoice Paint Group** card now shows **+ NEW INVOICE** whenever one of your jobs has money owing. Below it, **Expenses** is where you claim purchases with a receipt photo. Tap **+ NEW INVOICE**.
   ![](media/contractor-03.png)
4. Pick the job if you have more than one. The card shows the contract amount (ex GST) and how much is left to invoice. Choose **25%**, **50%**, **Custom %**, **$ amount** or **Line items** — every figure you enter is ex GST. The button updates to show the exact figure, for example **Send invoice — $1,245.00** (or **$1,245.00 + GST** when you are registered). Set an invoice date if you want it different from today, then tap the button.
   ![](media/contractor-04.png)
5. You land on the invoice itself. It has a number (for example CI-0042), the chip **WITH THE OFFICE**, one line "Progress payment claim — (25% of contract)", then **Subtotal (ex GST)**, **GST (10%)** and **Total (inc GST)** if you are registered (just the total and "No GST — not registered" if you are not), and the payment due date. Tap **Download invoice PDF** to keep a copy.
   ![](media/contractor-05.png)

### Check and submit the sign-off invoice
6. When a job signs off, the final invoice is drafted for you. On **Invoicing** it appears with an amber **READY TO SUBMIT** chip and "Draft — no number until you submit". Tap it.
   ![](media/contractor-06.png)
7. Check each line: **Contract work** is the agreed amount (ex GST), **Approved variations** adds extras the office approved, **Less —** lines take off scope that came out (a deduction the office set says "set by the office" and has their note), and **Less previously invoiced** takes off the ex-GST figure of any progress claims already sent. If you are registered, **GST (10%)** is then added and the **Total (inc GST)** is what you are submitting; if not, the **Total** is the agreed amount. When it is right, tap **Submit invoice**. Submitting locks the figures and sends the invoice to the office under your company details.
   ![](media/contractor-07.png)
8. The invoice now has a number and the chip **WITH THE OFFICE**. The office reviews and approves it, then pays by bank transfer.
   ![](media/contractor-08.png)

### Getting paid
9. When the office pays, the chip turns green **PAID** and the page shows the payment date, the bank reference and the remittance number. Tap **Download remittance advice** for the record.
   ![](media/contractor-09.png)
10. **Invoicing** lists every invoice with its status, amount, number, job reference and due date. **Approved — payment coming** means the office has approved it and it is in their payment run.
    ![](media/contractor-10.png)

### Your bonus
1. When Paint Group approves a bonus for your clean work on Green you get a text with the amount, and **Invoicing** shows **Bonus approved $X — Claim now**.
2. Tap **Claim now**. An invoice for the bonus is raised and submitted for you, marked **· bonus** in your list. It is approved and paid like any other invoice, with the normal payment terms, and the remittance advice comes the same way. GST is added if you are registered.
3. The claim needs a complete profile (company name, ABN, bank details) — the same as any invoice.

## What the colours and labels mean
- **NOT READY TO INVOICE** (amber) — your profile is missing something; submitting is held until it is in.
- **READY TO SUBMIT** / **READY TO CHECK & SUBMIT** (amber) — a draft waiting on you.
- **WITH THE OFFICE** (amber) — submitted and numbered; the office has not approved it yet.
- **Approved — payment coming** (blue) — approved; payment is being arranged.
- **PAID** (green) — paid, with the bank reference and remittance shown.
- **INVOICE** vs **TAX INVOICE** — the heading follows your GST registration at the time you submit. Registered: GST is added on top of the agreed amount. Not registered: the agreed amount only.
- **RCTI** (grey) — Paint Group issues this invoice on your behalf under a signed agreement; you do not need to submit it.

## If something goes wrong
- **"Submitting is held until your company profile has …"** Open **Profile** and fill in what it names, then come back. The button appears once everything is in.
- **"The office is finalising a pay adjustment on this job."** A credit on a variation still needs the office to set the figure. Wait for it to appear on the draft, or call them to settle it.
- **The claim is refused as more than what is left.** A claim can never exceed the amount still to invoice on that job. Lower the percentage or amount.
- **A figure looks wrong.** Do not submit. Call the office: the draft comes from the agreed offer and the approved variations, so the fix is on the job, not on the invoice.
- **No invoice appeared after sign-off.** Pull down to refresh **Invoicing**. If it is still missing, call the office.

## Related
- [Answer a job offer and manage your booked dates](../scheduling/contractor.md)
