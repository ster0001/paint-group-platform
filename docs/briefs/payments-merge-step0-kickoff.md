# Payments merge — Step 0 kickoff report (12 Oct 2026)

Brief: `docs/briefs/claude-code-brief-payments-merge.md`. Branch `feat/payments-merge`, worktree `../paint-group-platform-payments`. No app code changed in this step.

## 1. Reference files

| File | Found | One line |
|---|---|---|
| `design/reference/payments-merged-v3-mockup.html` | **In the worktree, NOT committed** | Real customer names; the repo is **public**, so committing it breaks the brief ("private repo only") and CLAUDE.md (no real customer data). Excluded from git until Tom says where it lives. Clicked through at 390 px (no sideways scroll) and 1440 px. |
| `docs/briefs/claude-code-brief-invoicing-payments.md` | yes | Ledger, state machine, server rules §4, screens §7. Contradictions in §4 below. |
| `docs/briefs/acceptance-to-paid-workflow.md` | yes | Chase ladder G-phases. |
| `docs/briefs/claude-code-brief-cost-capture.md` | yes | Intake queue, four doors, vendor memory. |
| `docs/briefs/claude-code-brief-wo-loop-pc-command.md` | yes | WO stages and the board. |
| `lib/invoicing/ledger.ts` | yes | `isOverdue()` l.127 is the one overdue rule (open status, due date passed, balance > 0, Melbourne date). |
| `lib/invoicing/gst.ts` | yes | GST rounding. |
| `lib/invoicing/attention.ts` | **MISSING** | Never built. See §4 item 9. |
| `/invoicing` | yes | `app/invoicing/page.tsx` + `Dashboard.tsx` (tiles l.257, Receivables l.287, Payables l.395, Activity l.491), `PayablesCosts.tsx`, `data.ts`, `actions.ts`. |
| `/invoices` | yes | `app/(app)/invoices/page.tsx`. See §2. |
| `/invoicing/job/[estimateId]` | yes (param is `estimateId`) | `MoneyView.tsx` with tabs Payments / Invoices / Costs; "Est-vs-actual bars arrive with 6b." is at `MoneyView.tsx:379`. |
| `/invoicing/inv/[id]` | yes | `InvoiceDoc.tsx`. Stays as it is. |
| `/pc/flow` + stage source | yes | `lib/workorder/stages.ts`: `LANES`, `LANE_LABELS`, `laneFor(stage, startDate, today)`. Pure, importable server-side. |
| Customer chats panel | yes | `app/components/StaffChatDock.tsx`. See §3. |
| `CLAUDE.md` | yes | Read. |

## 2. What `/invoices` shows

It shows one row per job: address, customer, one chip per invoice (number · kind · total · status, **including void and written-off**), job total, open balance, and a **Revise scope →** link. It has the filters active / all / draft / awaiting / overdue / paid and searches by name or address. It has no actions or export.

**Unique to it, compared with the new page:** void and written-off invoices on the job line, and the Revise scope link. The new job panel already carries Revise scope (§4.7). Void and written-off invoices need a home on the panel's Money in tab; then `/invoices` can redirect (⚑P16).

## 3. Answers to the §1 unknowns

**RPC names**

| Action | RPC (latest migration) | Server action |
|---|---|---|
| Record payment | `invoice_record_payment(invoice, method, amount, reference, received_on)` (`20270155`): issues a draft silently, ≤ balance × 1.05 | `recordPaymentAction`. Receipt goes out immediately in `after()` |
| Issue | `invoice_issue(id)` (`20261112`): number, `due_on` = today + terms | `issueInvoiceAction`, `issueAndSendAction` |
| Send | `invoice_send(id, channel)`, recorded only after the email/SMS actually went | `finishSend` |
| Void | `invoice_void(id, reason)`; paid → `error:paid_use_credit_note` | `voidInvoiceAction` |
| Approve contractor invoice | `contractor_invoice_approve(id)` (`20270218`) | `approveContractorInvoiceAction` |
| Mark contractor paid | `contractor_invoice_mark_paid(id, ref, paid_on)` (`20261127`), then remittance PDF + email | `markContractorInvoicePaidAction` |
| Confirm intake | `cost_intake_confirm(…13 params)` (`20261122`), writes **no event** | `confirmIntakeAction` |
| Reject intake | `cost_intake_reject(id)`, writes **no event** | `rejectIntakeAction` |
| Also | `invoice_request_payment` (progress % or $), `invoice_create_final`, `invoice_set_draft_total` (cents only; **no percentage RPC**), `invoice_draft_deposit` (import), `invoice_extend_due` (issued only; revoked from authenticated, unused) | |

**Payment reversal:** none exists for manual payments. There is no RPC, no column and no status; payments are not client-writable. The only one is the Stripe `record_stripe_refund`, which sets `payments.status = 'refunded'` and leaves the invoice status alone. `credit_notes` is a table with no RPC and no UI.

**Customer chats panel:** it **cannot** be opened on a chosen thread or pre-filled today. Its open/closed state and the selected thread are local `useState`, and there is no event, context or URL hook. It only lists threads with a customer message in the last 3 days. Step 4 therefore needs new code in the dock: an `open(estimateId, draft)` window event, and support for estimate threads that are not in the inbox list. Delivery already exists. `replyToEstimateChatAction` → `postStaffChatReply` writes `estimate_messages`, and the `estimate_chat_reply` automation sends **email and SMS** with a link back to the chat. "Last messaged" can come from `messages` (by `estimate_id`). ⚑P7 is still Tom's ruling, but the adapter can deliver from the panel.

**Cash "issue without send":** this exists (draft branch of `invoice_record_payment`). There is no "Send notification of payment" switch. The receipt is gated only by the `payment_receipt` automation.

## 4. Contradictions and conflicts (reported, not resolved)

1. **Deposit legal cap.** The invoicing brief ⚑2 says warn in amber when a deposit exceeds the Vic DBCA cap (10% under $20k, 5% at or over). The new brief ⚑P5 says "no cap", and the mockup shows **50% deposits on every job**, all of which would exceed that cap.
2. **Deleting drafts.** The invoicing brief §3.2 allows deleting a draft, and `invoice_draft_final` already deletes and replaces an existing final draft. The new brief §3A.2 says nothing is hard-deleted, yet §6.2 says "clear the deposit draft at the moment a final is drafted". Is that clearing a delete (old rule) or a hide (new rule)?
3. **Due date default.** The old brief says 7 days from *issue*, with finals due 7 days after sign-off; `invoice_issue` does this. The new brief says 7 days from *sending*, or the day before the start. Drafts have no `due_on` today, and `invoice_issue` overwrites it, so a due date edited on a draft needs `invoice_issue` changed (`create or replace`).
4. **Dashboard tab and aged-receivables bar.** The old brief §7.2 makes these the default. Neither is on the new page. The screens rule says the new brief wins; I'm noting that both are dropped.
5. **Confirm = approve.** The new ⚑P9 says Confirm also approves. The old ⚑24 says "approval of the resulting payable stays PC/Tom". Also, `material_costs` has **no status column**, so the "On a job, to approve" and "Approved, to pay" sections for materials need new nullable columns.
6. **Undo of a payment.** The old model has no reversal state, and refunds deliberately never un-pay an invoice. The new Undo has to un-pay it, which means a reversal row or status, plus `invoice_ledger`, `lib/invoicing/ledger.ts` and the status write all learning about it.
7. **"Change amount" is atomic and also sends.** Void plus reissue can be one transaction. Sending is an email outside the database, so it has to follow the commit. If the send fails, the result is a corrected invoice that is issued but not sent.
8. **"Overdue must use the same function the chase ladder uses."** It doesn't today. The chase sweep (`lib/automations/sweeps/moneySignoff.ts:70`) has its own rule, past midday on the due date. `isOverdue` flips the next day. The sweep also skips invoices on hold and anything more than 60 days overdue. Which rule wins?
9. **`lib/invoicing/attention.ts` and "the function PC Command uses".** There is no attention.ts, and **PC Command shows no customer-invoice attention at all**. Invoice urgency lives in the CRM work queue (`buildInvoiceItems`, `lib/crm/work-queue.ts:780`). CLAUDE.md's **One work queue** rule makes `lib/crm/work-queue.ts` the only "what needs attention" source and calls a second implementation a single-source violation. So building a new attention.ts would break CLAUDE.md. Proposal: urgency comes from `isOverdue` and the work-queue invoice source, shared, with no new attention.ts.
10. **Stage source.** `/pc/flow` drops closed jobs 30 days after they close, but Payments must keep closed jobs that still owe money. Plan: call `laneFor` directly on `work_orders`, without the 30-day filter. Jobs that are accepted but have no work order are not on the board; the mockup's "Accepted, not booked in yet" group handles them.

## 5. Defects found in passing (not in the brief's §6)

- **Security:** `invoice_draft_deposit` has no `is_staff()` check. The 20270201 blanket re-grant most likely made it executable by any signed-in user, customers and contractors included. Needs checking on prod and fixing in its own small PR.
- `pauseRemindersAction` (`app/invoicing/actions.ts:633`) updates `invoices` directly. UPDATE was revoked from authenticated, so Pause/Resume reminders probably fail. It also breaks the "RPC only" rule.
- Broken deep links: `/invoicing?tab=payables` (work queue l.2163), `/invoicing#payables` (home metrics l.72), `/invoicing/job/…?tab=costs` (PC work order l.783; MoneyView ignores `?tab`), and the staff email link `/invoicing/ci/[id]` (404, only `/pdf` exists).
- `buildInvoiceItems` takes today from `toISOString().slice(0,10)` (UTC). That breaks the Dates rule: before 10am it is a day behind.
- Causes of the §6 defects:
  - **#5:** the Closed lane gate is `stage = 'closed'` only, and every close path drafts the final without issuing it.
  - **#7:** `invoice_mark_viewed` writes a `viewed` event on every open.
  - **#8:** Materials to match counts unmatched `material_costs` only. It never counts pending `cost_intake`.
  - **#9:** `PayablesCosts.tsx:184` sends `category: "other"` for materials, so vendor memory *learns* "other". `job_cost_category` has no `materials` value.
- Snap a receipt (`AddCostSheet.tsx`) has no AI extraction. The `photo` intake source is defined but nothing writes it.

## 6. Baseline (§3A.4)

`scripts/diag/payments-baseline.mjs` is read-only: a `begin read only` transaction, selects only. It reports:
- invoices by status
- invoiced / paid / outstanding totals
- payments by status and method
- contractor invoices by status
- cost intake by status
- material costs on or off a job
- job costs by status and category
- md5 fingerprints of the invoice, payment, contractor-invoice and intake rows

It runs against the test project. **Production was not read:** the session's permission classifier blocks production reads. Tom runs it from the main checkout:

    node ../paint-group-platform-payments/scripts/diag/payments-baseline.mjs --prod > ../paint-group-platform-payments/docs/briefs/payments-merge-baseline-2026-10-12.json

Note: production keeps trading while the build runs, so payments land and statuses move. "The same figures after every step" can only hold for rows the build did not touch. The fingerprint flags a change; diffing by id says whose change it was.

## 7. Migrations expected (all additive: new tables, new nullable columns, new enum values, new functions, `create or replace` of existing functions)

| Step | Migration | Additive? |
|---|---|---|
| 1 | none (TypeScript only) | — |
| 2 | none (staff RLS on existing tables already) | — |
| 3 | `invoice_payment_undo` RPC plus a reversal record (a new `payment_reversals` table, or nullable `reversed_at`/`reversed_by`/`reversal_reason` columns plus a `reversed` value on `payment_status`); receipt hold (nullable `payments.receipt_send_after`, or a held-receipt queue) for ⚑P2; `invoice_set_deposit_pct(id, pct)` RPC; `invoice_set_draft_due(id, date)` RPC, with `invoice_issue` replaced to keep a pre-set `due_on`; `invoice_change_amount(id, pct or cents, reason)` as void plus issue in one transaction; a staff guard on `invoice_draft_deposit` / an RPC to create a missing invoice | Yes. The reversal changes what "paid" sums, and `invoice_issue` is replaced, not dropped |
| 4 | none for data. Templates go into the `messaging` settings row through the seed path, and the pay link uses the existing invoice token | Yes |
| 5 | `contractor_invoice_unapprove` / `contractor_invoice_unpay` RPCs for Undo (each a single-row, action-driven status step back, event-logged); the remittance must be held like the receipt | Yes, but a backward transition is new behaviour (flag) |
| 6 | `cost_intake_restore` and `cost_intake_dismiss_duplicate` RPCs, with a nullable `cost_intake.status_before_reject`; nullable `material_costs.status`/`approved_at`/`paid_at` (approve and pay for materials); nullable `vendors.display_name` or a vendor alias for one supplier name; `materials` added to `job_cost_category` only if Tom wants supplier invoices kept in `job_costs` | Yes. **Moving existing "other" rows to materials is a bulk UPDATE, so it is not done without Tom's approval** |
| 7 | none expected | — |
| 8 | fixes for the remaining §6 items (lane gate or name; one `viewed` event fold, display-only) | Yes |

Every migration ends with its read-back `select` and the `_prod_migrations` insert, runs on the test project first, and goes to Tom in the PR body.

## 8. Decisions needed before Step 1

- Where the mockup lives (it can't go in this public repo).
- Contradictions 1, 2, 8 and 9 above. Item 9 decides where Step 1's urgency comes from.
- Baseline run on production (command in §6).
