# Manual test — pay before send, deposit scope lines, aligned amounts (17 Sep 2026)

Paste first, in order, and read each read-back:
1. `20270155000000_invoice_pay_before_send.sql` → expect `fn_ok t, staff_may_call t, issues_drafts t`.
2. `20270156000000_invoice_deposit_scope_lines.sql` → expect `column_ok t, helper_ok t, final_uses_helper t, recompute_ignores t, trigger_ok t`. `draft_deposits_still_bare` = deposits whose estimate has no sent snapshot (imported jobs) — nothing to list for them. `deposits_with_scope` = the drafts that were backfilled.

Then merge the PR. (The app tolerates the paste landing first; it does not tolerate the deploy landing first for 20270156's column — the lines read is written to survive it, but paste first anyway.)

## A. Record a payment on a draft (no send)
1. Invoicing → a job with a **Draft (unnumbered) · Deposit**. Open **Invoices** tab.
2. The draft card shows **Record payment** beside **Issue & send**. Press it.
3. Bank · amount = the deposit · reference `TEST` · **Record**.
4. Expect: card reads **Paid in full**, the invoice has an INV number, and the activity feed shows *Issued* then *Payment received* — and NO "sent". The customer receives only the receipt email.
5. Open the invoice → **Preview as customer**: "Paid in full — thank you".

## B. Deposit invoice lists the scope
1. Open any draft deposit invoice (a job that came through the estimator, not an import).
2. Expect a group **Contract works — from accepted estimate · for information — not part of this invoice's total**, listing Preparation, each area and line item, then **This claim → Deposit — 50% …**.
3. Scope lines have no pencil; the deposit line does. **Amend the amount** still changes only the deposit figure — subtotal/GST/total follow, the scope lines don't move.
4. **Preview as customer**: same lines under *Contract works — from your accepted estimate*, then *This invoice*, Total = the deposit.
5. Accept a fresh estimate (test) → its new deposit draft already carries the scope.

## C. Amounts in a line
On any invoice, the figures beside each line end on the same right edge as Subtotal / GST / Total, with or without the edit pencil.
