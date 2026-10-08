# Finish standards, painter status, call backs — Step 7 report (what the colour changes)

**Date:** 8 October 2026 · **Branch:** `feat/status-offers-payment-bonus` · **Brief:** §10 Step 7 · **Before:** `standards-status-callbacks-s6-report.md`

## What was built

| Brief asked | Built |
|---|---|
| Scheduler painter picker: sort and show lights per ⚑7 | Board lanes sort Green → Yellow/New → Orange → Red with the colour in words on each; the re-offer picker sorts the same and leaves an uncleared Red out |
| Block Red in the offer RPC until the owner's clearance (⚑8); block a Red employed painter as lead the same way | `painter_offers_blocked`, `painter_clear_red` (owner, reason, event); enforced in `send_offer`, the `booking_offers` trigger and a `wo_assignments` lead trigger (covers `assign_job` and `set_lead_painter`). The clearance lasts until the colour next changes |
| Green at sign-off → 3 business days (⚑14) | `business_days_after` (Mon–Fri less the Booking-rules public holidays); `contractor_invoice_draft` uses the colour at that moment |
| The PC's hold switches back to default terms, never later (⚑23, §6 rule 6) | `contractor_invoice_hold_fast_terms` / `…_release_fast_terms`; Payables chip + buttons; `payment_hold` card |
| Bonus: PC card + owner notified at the same moment; "Tell Tom"; owner sets the amount (prefilled last bonus or $500) and approves or declines | `bonus_due` card with Tell Tom; `office_bonus_review` alert sent when the writer raises the review; `ContractorStatusPanel` on the painter's page with the amount prefilled from the last approved bonus or the default |
| Approved adds a separate "Bonus" line to the contractor's next payment, or the payroll export for an employed lead | **Changed by Tom, 8 Oct:** the contractor is told the amount and CLAIMS it; `bonus_claim` raises a contractor invoice for the bonus through the normal channel. An employed lead is told it goes on the next pay run; the payroll CSV carries a `bonus_cents` row |
| Do not pay any bonus until ⚑10 / ⚑11: approve behind a Settings switch, OFF | `painter_status_rules.bonusApprovalsEnabled` (false); `bonus_decide` returns `error:approvals_off`; the Approve button is disabled with the reason |
| E2e as PC and owner, one bonus from due to approved | `e2e/status-offers-payment-bonus.spec.ts` — plus the claim as the painter and the paid trigger |

## Acceptance (brief Step 7)
- An offer to a Red painter fails at the RPC without the owner's clearance — and at the table (direct insert refused). In the spec.
- A Green painter's due date is exactly 3 business days after sign-off across a weekend — Fri 9 Oct → Wed 14 Oct, in the spec and the migration read-back.
- A held payment's due date equals the default terms, never later — `least(default, …)`; spec: 14 → 16 Oct and back.
- One bonus row per four qualifying jobs, never two — `unique (painter_id, trigger_wo_id)` (Step 5), unchanged.
- Bonus approval impossible while the switch is off — RPC and UI, in the spec.
- A painter can read a bonus amount only on their own payment record, a customer nothing — **amended by Tom's ruling:** the painter also reads their own APPROVED bonus (the claim card). Customer reads none; another painter's never. In the spec.
- An approved bonus survives a later change to a qualifying job — the writer flags only due / with_owner reviews (Step 5); `bonus_decide` on an approved one returns `error:already_approved`.

## Decisions taken
1. **Tom's bonus payment flow replaces R14's "never an amount" at approval time.** Message 8 now names the amount; the painter sees it on the Money tab until claimed. R14 still holds everywhere else: no amount on My status, no ladder, no counter target beyond "n of 4".
2. **A bonus invoice is its own contractor invoice** (`auto_draft_source 'bonus'`, `claimed_ex_cents 0`), not a line folded into a job invoice — so it never affects a job's remainder and the ledger shows it plainly. GST follows the contractor's registration like every other line until ⚑10 rules otherwise.
3. **The payroll CSV carries one money column, `bonus_cents`,** on bonus rows only (⚑11). The earlier "hours only" rule stands for timesheet rows; the test now pins both.
4. **Red clearance is a column on `painter_status`,** reset by the writer on any colour change (⚑8 "lasts until the colour next changes") — no second table.
5. **Business days come from Booking rules' public-holiday list** (⚑14) — one list, already maintained there.
6. **The lead gate is a trigger** on `wo_assignments.is_lead` rather than edits to `assign_job`'s 120 lines — every path meets it.

## Open for Tom
- Paste `20270230000000_status_offers_payment_bonus.sql`. Read-back: status_cols 3, ci_cols 4, fns 10, triggers 3, offer_gate true, draft_terms true, decide_grant true, approvals false, bonus_policies 2, fri_plus_3 2026-10-14.
- ⚑10 (GST on the bonus) and ⚑11 (payroll) with the accountant; then `bonusApprovalsEnabled: true`.
- Route `office_bonus_review` and `office_painter_red` to yourself under Settings → Staff logins → alerts.

## Not in this step
The Contractors section with counts and the strip (Step 8); the full-loop story (Step 9).
