# Contractor expenses 6c — migration + eyeball script (Tom)

One migration to paste, then a short look around. Until the SQL runs, the
deployed code is inert: the portal Money page just shows no Expenses card
and the Payables sections for claims/asks stay empty.

## 1. Paste the migration

Supabase SQL editor → paste the whole of
`supabase/migrations/20261127000000_contractor_expenses.sql` → Run.

**Read-backs (printed at the bottom of the run) — expect:**

1. Both tables with `relrowsecurity = true`:
   `contractor_expenses`, `expense_preapprovals`
2. **5 functions**, all `security definer = true` — and note
   `contractor_expense_attach` must NOT appear (it is dropped and replaced
   by `contractor_expense_sweep`):
   `contractor_expense_decide`, `contractor_expense_submit`,
   `contractor_expense_sweep`, `expense_preapproval_decide`,
   `expense_preapproval_request`
3. Two columns on `contractor_invoices`:
   `reimbursement_cents`, `reimbursement_lines`
4. **4 policies** on cost-docs storage:
   `cost_docs_objects_delete`, `cost_docs_objects_read`,
   `cost_docs_objects_read_own`, `cost_docs_objects_write`

If any read-back differs: stop and tell the session — never patch around it.

## 2. Eyeball script (after the next deploy)

**As a contractor** (portal → Money):

1. An **Expenses** card sits under the invoice/claim section. It has two
   parts: an amber "Buying something over $100? Ask first" box, and a
   "Claim an expense" form.
2. Submit a claim: pick the job, a category chip (tip fees / sundries /
   materials top-up / parking / other), the amount, and attach a **photo or
   PDF of the receipt** — no receipt, no submit button.
3. Try an amount over $100 without asking first: it still submits, but
   warns you it will land flagged for the office.
4. The ask-first box: describe the purchase + rough cost → it appears as
   "requested" until the office answers.

**As staff** (Invoicing → Pay tab):

5. "Ask-first — over-threshold purchases" section: Approve… prompts for the
   cap in dollars; Decline just declines. Approving also drops the card
   from the PC queue.
6. "Contractor expense claims" section: each claim shows the receipt link,
   amber "over threshold — was not pre-approved" where relevant, and
   Approve / Reject buttons.
7. PC Command home: an amber card "wants to buy — about $X" per open ask,
   linking to the Pay tab.

**The money loop** (the part that must reconcile):

8. Approve a claim, then have the contractor send their next invoice/claim
   from the portal. The invoice (and its PDF) carries each approved expense
   as its own "Reimbursement — …at cost" line, added on top of the claim
   amount to the cent.
9. Mark that invoice paid → the expense chips flip to **paid** in the
   portal, and the remittance PDF itemises the reimbursements.
10. Reimbursements do NOT eat the job: a $500 job with $80 of expenses
    reimbursed still shows the full labour remainder claimable.

## Notes

- The over-threshold flag defaults to **$100** (`expenseThresholdCents` in
  the `cost_intake` settings row); categories come from
  `claimableCategories` in the same row.
- Approved-expense reimbursements also appear on the job's money view →
  Costs tab, under "Contractor expense reimbursements".
- Staff reimbursements ride the 6a "+ Add cost" flow: pay with **personal
  card** on the form and the cost records who to reimburse.
