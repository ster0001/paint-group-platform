# Eyeball script — Step 5: contractor invoicing (5 minutes)

Run after migration `20261119_contractor_invoicing.sql` is live.

1. **Sign off any test job** (or reuse one already closed after the migration).
   Open `/invoicing?tab=pay` — a row appears for the contractor: "Draft
   (unnumbered) · WO-… · address", amount = offer + accepted variations −
   deductions.

2. **As the contractor** (portal → Money): the invoice card is there. Open it —
   the heading reads **INVOICE** (their GST toggle is off) or **TAX INVOICE**
   (on), every deduction is listed with the office's note, and the Submit
   button shows the total. If their profile is missing ABN/address/bank, the
   button is replaced by the reason.

3. **Submit** → the card flips to "With the office" and gains a CI-number.

4. **Back on `/invoicing?tab=pay`**: the To-approve tile carries the amount.
   **Approve** → the row moves to "Approved · due in N days" (sign-off + 7).
   **Mark paid** → type the bank reference → the row reads Paid; a minute
   later the contractor's page shows the REM-number and a **Download
   remittance advice** button, and (with email configured) the remittance
   lands in their inbox.

5. **RCTI**: on the Contractors page, flip **RCTI: on** for a test contractor
   (confirm dialog). Their next signed-off job's draft shows an RCTI chip on
   the Payables row and **Approve** works straight from draft — no contractor
   submit step.

What can go wrong:
- Row missing after sign-off → the job had no contractor assigned
  (`skip:no_contractor` — by design).
- "Deduction pending" on submit → a removal on started work is still waiting
  for your figure on the PC job page. That's ⚑10 working.
