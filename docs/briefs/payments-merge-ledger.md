# Payments merge — session ledger

Brief: `docs/briefs/claude-code-brief-payments-merge.md`. Branch `feat/payments-merge` (worktree `../paint-group-platform-payments`). One entry per session, newest last.

## Step 0 — kickoff (12 Oct 2026)
- Report: `docs/briefs/payments-merge-step0-kickoff.md`. No app code changed.
- Baseline (§3A.4), production, read 12 Oct 11:37 UTC with `scripts/diag/payments-baseline.mjs --prod`. It matches the brief's figures: 86 invoices, $36,819.33 outstanding on 7, $17,226.71 in 5 contractor invoices to approve. The JSON is kept OUTSIDE the repo (live business totals; the repo is public), in `~/Documents/paint-group-private/payments-merge/`.
- Mockup: the original has real customer names, so it stays outside git (private folder, with the name map). The anonymised copy at `design/reference/payments-merged-v3-mockup.html` is committed (Tom, 13 Oct).

## Tom's rulings (12 Oct 2026), answering the kickoff's open items
1. Urgency: no new `lib/invoicing/attention.ts`. Urgency comes from the one shared overdue rule plus the CRM work queue (CLAUDE.md "one work queue").
2. **Overdue = midday Melbourne on the day after the due date.** Shipped in PR #260 (`ledger.ts` `overdueFrom` / `isOverdue(invoice, now)`). The chase sweep, CRM, portal and reporting all call it.
3. Deposit: **50% standard, adjustable** (Step 3). The old brief's DBCA-cap warning is not built; the legal check stays an open ⚑ for the final PR.
4. Drafts may be **edited or deleted before they are sent**. The leftover drafts (§6.1–6.2) are still hidden by rule until Tom approves deleting a listed set.
5. The mockup lives outside git; the anonymised copy is in the repo (Tom, 13 Oct).
7. **One switch-over at Step 8** (Tom, 13 Oct): no side-by-side preview. Steps 1–7 stay on `feat/payments-merge`; `main` keeps the current Payments page until Step 8 replaces it.
6. Prework fixes merged first (PR #260, `20270255` LIVE on production 12 Oct 11:59 UTC): definer guards, Pause/Resume reminders via an RPC, money deep links, Melbourne dates.

## Step 1 — the job money row and the headline (12 Oct 2026)
- `lib/invoicing/jobMoney.ts` is pure:
  - `jobMoneyRow`: contract, paid, balance, the three slots and their states, the next action, what is collectable now, health, section, and the hidden leftovers.
  - `compareRows`: the one ordering.
  - `jobMoneyPage`: the rows, the four blocks, the seven-lane strip and the headline figures.
  - `headlineSentences`: the sentence.
- Supporting files:
  - Loader: `app/invoicing/jobMoneyData.ts` (paged reads; a failed read returns a failure, never an empty page).
  - Raw JSON for checking: `GET /api/invoicing/job-money` (staff only).
  - Audit: `lib/invoicing/jobMoney.boundary.test.ts`, no cents arithmetic in the page's own files.
- Rules as built:
  - Slot rule: deposit-kind invoices go in the deposit slot, else the first Progress invoice; finals go in the final slot; everything else is progress.
  - Leftover drafts are hidden by rule: $0 drafts, and deposit drafts beside a final.
  - `need` = deposit slot unpaid on Booking confirmed through Walkthrough.
  - `noinv` = booked with no invoice. `uninv` = closed with contract on no invoice.
  - `none` (added) = a slot the job doesn't use.
  - A job with no work order sits in the Offer lane.
  - Draft-only jobs outside Offer and the deposit rule fall under "Other invoices waiting to be paid", rather than being silently dropped as "nothing to collect".
- Gate:
  - 28 golden and audit tests, built from the §6 cases with fictional names. Every slot state is covered, the first-Progress case lands in deposit, and the headline matches exactly.
  - Full unit suite 3,532 passing. Typecheck clean. Lint within the CI ceiling.
- Reconciled on the test project: all 795 jobs' contract, paid and balance equal `public.invoice_ledger` (0 mismatches). The strip sums to the rows, and the Customers block equals the C1 baseline ($66,110.00 on 45 invoices).
- Not run: the JSON route in a browser (the test stack's :3101 was held by another session); it is a thin wrapper over the loader, which the reconciliation exercised.
- No migration. Production figures untouched: Step 1 only reads.

## Step 2 — page shell and the Customers block (13 Oct 2026)
- Page: `/invoicing/payments` (`app/invoicing/payments/`), staff-only behind the invoicing layout. It becomes `/invoicing` at Step 8, the one switch-over.
  - Components: `page.tsx`, `Views.tsx` (To chase · By job stage · All jobs), `JobPieces.tsx` (card, rail, pills, actions, lights), `labels.ts` (words only), `Tools.tsx` (search and Show paid, the only client code).
  - Selection lives in the URL: `tab`, `view`, `stage`, `q`, `paid`, `f`.
  - Actions render but are inert until Step 3 (`data-step` marks the step that wires each one).
- CSS: `payments.css` is the mockup's `<style>`, ported 1:1 by `scripts/design/scope-mockup-css.py` (scoped `.pm`, light theme via the shell's `data-theme`). Regenerate it rather than hand-editing.
  - The old `invoicing.css` used the same short class names (`.r`, `.d`, `.lane`, `.sheet`…), so its page rules are now guarded with `:not(:has(.pm))`. The shell (header, logo, theme button, tokens) is not guarded.
  - The guard adds equal specificity to every old rule, so the current pages render as before.
  - Step 8 deletes the old rules and the guard.
- `lib/invoicing/jobMoney.ts` grew what the page reads:
  - each slot's `lead` (state, days overdue/due, % of contract, views)
  - `next.lead`, `pulse`, `laneTone` / `StageCell.tone`
  - `matchRows`, `tableFilter`, `totalNowCents` / `totalCollectableCents` / `totalOverdueCents`, `headlineParts`

  The loader reads customer view counts (`invoice_events` `viewed`).
- Gate:
  - 34 job-money unit tests and the no-cents-arithmetic audit (now covering the page directory). Full unit suite 3,538 passing.
  - Typecheck clean. Lint within the CI ceiling. Help index current.
  - e2e `e2e/payments-page.spec.ts` 4/4 on C1: anonymous refused (page and JSON); overdue first, the deposit-not-in card orange and pulsing; paid only under Show paid / Paid in full; search, board and table; the stage link; no sideways scroll at 390 px in all three views.
  - Regression: `invoicing`, `contractor-invoicing`, `cost-intake`, `invoicing-read-failure` and `dashboard-invoicing` all pass, 38/38 on the CSS-guarded old page.
- Visual check on C1 at 1440 and 390 px against the mockup: headline, blocks, strip, cards, board and table match.
  - The shell header stays 1080 px wide over the 1280 px page (Step 8 widens it).
  - The Customer chats dock can open over the page, as on every staff page.
- Fixed in passing: `e2e/dashboard-invoicing.spec.ts` built its due dates from the UTC day, so it failed every morning before 10–11am Melbourne (17 days overdue against an expected 16). It now uses `melbourneDatePlus`. The spec is on `main` too, so main's copy stays wrong until this branch merges at Step 8.
- Not done here, by design:
  - Help file: the page is not live until Step 8, which writes the help from the real screens.
  - The headline follows the brief (a zero clause is dropped) rather than the mockup's "Every booked job has its deposit in."
  - Show paid jobs appears on By job stage and All jobs, not on To chase, which never lists paid jobs.

## Step 3 — quick actions (13 Oct 2026)
- ⚑P2 ruled by Tom (13 Oct): **the receipt goes when the 8-second Undo window closes.**
- Migration `20270256000000_payments_quick_actions.sql` is additive: payment status `reversed`; nullable `payments.reversed_at/by/reversal_reason/receipt_sent_at/invoice_status_before`; seven Undo step-back rows in `invoice_transitions` (mirrored in `stateMachine.ts`, contract-tested); new definer RPCs; `create or replace invoice_issue` (keeps a draft's due date when it is today or later). Applied on C1, read-back 12/12. **LIVE on production** (ledger 12 Oct 20:39 UTC; production read-back 12/12 matched). Production check, read-only: 0 of 48 drafts carry a due date, so the `invoice_issue` change does not touch the current page.
  - New RPCs: `invoice_record_full_payment`, `invoice_payment_undo`, `payment_claim_receipt` (service), `invoice_set_deposit`, `invoice_set_draft_due`, `invoice_change_amount`.
  - Grant: `invoice_draft_deposit` regains authenticated (its staff guard is from 20270255).
- How the rules came out:
  - One press: the amount is the balance, computed in SQL under the row lock, so a second press answers `already_paid`.
  - Undo:
    - The payment row is kept as `reversed` and the invoice steps back, to its pre-payment status where recorded, else derived from events.
    - A `payment_reversed` event is written.
    - Refused after 10 minutes, or once the receipt is claimed.
  - Receipt: `after()` waits for the window plus 1.5 s, then `payment_claim_receipt` stamps it and the email goes. A claim and an Undo can never both happen.
  - Cash against a draft issues it without sending. The "Send notification of payment" switch (⚑P4, default on) off sends no receipt.
  - Send confirm: due date defaults to 7 days from today, or the day before a sooner start. It warns when the date falls on or after the start, and locks once sent.
  - Deposit adjust: 10/20/30/50% (`settings.invoicing.depositOptionsPct`, ⚑P5) or a dollar amount; the server computes the cents.
  - Change amount: void and reissue in one transaction. The UI arrives with the job panel (Step 7, as the brief places it); the action `changeDepositAction` exists now.
  - Create deposit / create final on noinv and uninv rows.
- Settings values, read with fallbacks in `lib/invoicing/settings.ts` `paymentsSettings`: `depositOptionsPct`, `undoSeconds` (8), `notifyPaymentDefault` (true), `paymentTermsDays`. No Settings UI yet: listed for the final PR.
- Code:
  - `app/invoicing/actions.ts`: `quickPayAction`, `undoPaymentAction`, `sendWithDueAction`, `setDepositAction`, `changeDepositAction`, `createDepositAction`; `recordPaymentAction` gains `notify`; receipts go through `sendClaimedReceipt`.
  - `app/invoicing/payments/ActionsClient.tsx`: provider, sheets, toast, row buttons, deposit adjuster. It renders inside `.pm` so the scoped styles reach it.
  - `lib/invoicing/jobMoney.ts`: `suggestedDue`, `parseDollarsToCents`, `depositPreview`, `centsAsInput`.
- Gate:
  - Unit 3,543 passing. Typecheck clean. Lint within the CI ceiling.
  - e2e `payments-actions` 8/8 + `payments-page` 4/4 on C1.
  - Regression 22/22: `invoicing`, `invoicing-read-failure`, `ledger-parity`, `invoice-final-variation-once`, `dashboard-invoicing`, `portal-money`.
- Fixed while testing:
  - The page fixture had set `work_orders.status` to a stage name. That enum differs, so the update failed silently and Step 2's stage-filter check passed for the wrong reason. Shared fixture now: `e2e/fixtures/paymentsJobs.ts`.
  - The fixture's dates are now Melbourne days.
- Noted, not changed: a CRM "invoice paid" event emitted at the payment stays in the customer's CRM history after an Undo. The CRM facts recompute from the invoice status, so the customer's state is right.

## Step 4 — message follow-up (13 Oct 2026)
- ⚑P7 ruled by Tom (13 Oct): **text and email.** The existing estimate-chat reply already does both:
  - an email carrying the whole message
  - a text (`chatReplySms`) with a link to the chat. It does not carry the message itself.
- Migration `20270257000000_payments_message_log.sql`, additive: `invoice_log_message` (staff) writes a `nudge_sent` event on the invoice. Applied on C1, read-back 2/2. **LIVE on production** (ledger 12 Oct 20:57 UTC; production read-back 2/2 matched). Tom, 13 Oct: keep the text as a link to the chat.
- The dock is reused, not copied:
  - `app/components/staffDockBus.ts` `openEstimateChat()` fires `pg:open-estimate-chat`.
  - `StaffChatDock` opens on that estimate's thread (a synthesised row when it isn't in the inbox) with a compose mode: template chips, a multi-line box pre-filled, "Written for you. Edit it, then send."
  - Send uses `replyToEstimateChatAction`, now with an optional `invoiceId` and `template`, which it logs.
- Drafts come from `paymentMessageDraftAction` (`app/invoicing/actions.ts`), on the server:
  - Template choice: Deposit reminder for the deposit slot, Friendly reminder otherwise, then Overdue (pre-selected when the invoice is overdue), then Payment received.
  - Filled in: the amount (balance), address, due and start dates (long form), first name, and the pay link `/i/<token>`.
  - A draft invoice gets no link, because the token page opens issued invoices only.
- Templates live in the `messaging` settings row as `paymentMsgDeposit`, `paymentMsgReminder`, `paymentMsgOverdue` and `paymentMsgReceived`, seeded from Appendix A. They are editable under Settings → Automations → "Payment messages from Payments" (a manual entry). New placeholder: `{{pay_link}}`, added to `TemplateVars` and `SAMPLE_VARS`.
- "Last messaged": the newest staff line on the job's chat (`estimate_messages`) gives `row.lastMessagedDays`, shown on the card's context line.
- Fixed while testing: the deferred receipt now claims BEFORE building the PDF. Headless Chromium can take seconds, and Undo must close when the window does.
- Gate:
  - Unit 3,548 passing, including `lib/messaging/paymentMessages.test.ts` (Appendix A wording, English tone, placeholders, the Settings entry).
  - Typecheck clean. Lint within the ceiling. Help index current.
  - e2e on C1: `payments-message` 3/3, `payments-actions` 8/8, `payments-page` 4/4.
  - Regression 20/20: estimate chat, customer asks, settings automations, dock specs.

## Step 5 — the Contractors block (13 Oct 2026)
- Migration `20270258000000_payments_contractor_actions.sql`, additive:
  - nullable `contractor_invoices.remittance_sent_at`;
  - `contractor_invoice_unapprove` and `contractor_invoice_unpay` (staff, 10 minutes, an event each);
  - `contractor_invoice_claim_remittance` (service);
  - a `create or replace` of `contractor_invoice_guard`: the 20261119 body, plus the two step-backs approved→submitted and paid→approved, admitted ONLY while `app.ci_undo` is set transaction-locally by the Undo functions (mirrored as `CI_UNDO_TRANSITIONS`, contract-tested).

  Applied on C1, read-back 7/7. **LIVE on production** (ledger 12 Oct 22:17 UTC; production read-back 7/7 matched).
- Rules as built:
  - Undo of Paid puts the carried expenses back to approved and keeps the remittance number for the re-pay. It is refused for a bonus invoice (painter_bonuses has one writer) and once the remittance has been claimed.
  - The pay-by date stays the existing rule (sign-off + terms, Green fast terms). Approve does not move it, as the brief says. The mockup's "due seven days after approval" note is not built.
  - The remittance waits for the Undo window and is claimed before the PDF and email (`sendClaimedRemittance`). The old Payables "Mark paid" path uses the same claim, so `remittance_sent_at` is stamped everywhere.
- Code:
  - `lib/invoicing/jobMoney.ts`: `contractorRows`, `contractorGroups`, `matchCiRows`, `totalCiCents`. The customer-paid line is the job panel's own row.
  - Loader: the Payables tab's `loadContractorInvoices` is now exported and shared (CI_SELECT gains `contractor_id, work_order_id`).
  - Page: the Contractors tab (`ContractorsView.tsx`), By invoice / By contractor (`cby`), search.
  - Actions: `approveCiQuickAction`, `payCiQuickAction`, `unapproveCiAction`, `unpayCiAction`.
  - Query links to the painter's message thread on the work order.
- Gate:
  - Unit 3,555 passing. Typecheck clean. Lint within the ceiling. Help index current.
  - e2e `payments-contractors` 4/4: sections, the customer line, Approve and Paid with Undo, the remittance after the window, Approve all = one event per invoice, the To approve total = the old tile, the contractor sees only their own invoices.
  - Regression 47/48: contractor-invoicing, contractor-expenses, painter-status(-screens), status-offers-payment-bonus, payments-actions/page/message.
- The one red, unrelated: `status-offers-payment-bonus` "a Red painter gets no offer…" expects `error:no_reason` from `painter_clear_red` and gets `error:not_owner`. The C1 staff login isn't the owner; nothing in this build touches that function or staff roles.

## Step 6 — the Materials block (13 Oct 2026)
- Production shape (read-only, 13 Oct):
  - Six vendor rows for three suppliers (Dulux ×2, Haymes ×3, Viponds).
  - Ten supplier invoices filed as job costs `other`, all recorded: §6.9.
  - Twelve `material_costs`, all on jobs.
  - Fifteen documents pending plus one duplicate, with the old tile saying 0: §6.8.
- Migration `20270259000000_payments_materials.sql`, additive. Applied on C1, read-back 10/10. **LIVE on production** (production read-back 10/10 matched, 13 Oct).
  - Enums: `job_cost_category` += `materials`; `job_cost_status` += `void`.
  - Nullable `material_costs.overhead`.
  - New functions: `cost_intake_confirm_materials` (figures from the EXTRACTED fields, then approve: ⚑P9 default, Settings `confirmApproves`), `cost_intake_not_for_job`, `cost_intake_restore`, `job_cost_void` / `job_cost_restore`, `job_cost_unpay` (10 minutes).
- `lib/invoicing/materials.ts` (pure):
  - One supplier, one name (§6.10): vendors joined by shared sender domain, by the same clean name, or by one clean name inside another; the display name is the shortest clean one. No vendor row is renamed.
  - Supplier invoices are materials (§6.9): category `materials`, or `other` from a vendor that vendor memory knows sells materials. The ten `other` rows are NOT re-categorised (that would be a bulk update, §3A.3); they count as materials by rule.
  - The block counts the queue (§6.8): To check = pending + undismissed duplicates. Duplicates are shown but never counted.
  - Lists: To check, On a job to approve, Approved to pay (grouped by supplier), Paid, Deleted.
- Rules as built:
  - Delete is the existing `cost_intake_reject` (a document) or `void` (a cost waiting for approval). Restore puts it back. The document is always kept.
  - Dismiss on a duplicate is the same reject.
  - Not for a job writes a `material_costs` row with `overhead = true`. `materialsToMatch` (the old tile and the home dashboard) now skips overhead.
- Page: `MaterialsView.tsx`.
  - Supplier totals line; Confirm / Other job / Pick a job / Not for a job / Delete / View; "Confirm the N with a job found"; "Approve all N"; ✓ Paid per supplier with Undo; Deleted with Restore.
  - View opens the original document (signed link, looked up by row id) beside what was read.
  - Snap a receipt picks a job, then opens it with Add cost ready (`/invoicing/job/[id]?addcost=1`): the existing capture.
- Gate:
  - Unit 3,563 passing. Typecheck clean. Lint within the ceiling. Help index current.
  - e2e `payments-materials` 2/2.
  - Regression 42/43: cost-intake, dashboard-invoicing, invoicing, payments-page / actions / message / contractors.
  - The one red was `invoicing.spec` "Settings → Invoicing card payments": the TEST passed, its afterAll timed out on a test-project network drop (ETIMEDOUT). That same drop crashed the run's teardown before the e2e lock was released.
  - The re-run was REFUSED by the lock: holder "an e2e run, started locally at 22:35Z" = this session's crashed run, a dead pooler connection that clears when the server notices. No retry loop, per the rule.
- Not done: Undo on Confirm/Approve. The brief asks for Undo only on Paid. Delete has Undo via Restore.

## Step 7 — the job panel (13 Oct 2026)
- No migration.
- `lib/invoicing/jobProfit.ts` (pure): Money out and profit (R19).
  - Gross profit = job value ex GST − contractor (offer + accepted variations, ex GST) − own painters (labour, approved or paid) − materials (the Materials rule's job costs + `material_costs` not overhead, ex GST) − other trades and costs − approved expenses.
  - Every line carries the rows it adds up (`sources`). A voided cost counts nowhere.
  - A started job with no materials says the profit reads too high.
  - `pctOfContract` joins `jobMoney.ts` (the boundary test caught it in the page files).
- `app/invoicing/payments/panelData.ts` reads the SAME page model as the row (`jobMoneyPage`), so the panel and the row cannot disagree. It adds every invoice with its payments (`loadJobMoney`) and the job's costs (`loadJobCosts`).
- `JobPanel.tsx` (server) + `PanelClient.tsx` (client), built to the mockup's drawer.
  - Stage box, Job total / Paid / Still owing, two tabs (`jt=in|out`).
  - Money in: the row's actions; Request a payment / Invoice in full / Revise scope; one card per invoice with its payments. Draft: due date (`setDraftDueAction` → `invoice_set_draft_due`), Check, Delete draft, Already paid, Send. Sent: Change amount (deposit), Pause/Resume reminders, Void, Open, Cash or part, ✓ Paid. Messages line opens the chat.
  - Money out: the profit box, split bar and sum; contractor invoices with Approve / ✓ Paid; supplier invoices with View; the cost rows behind the lines; Add a cost (restyled sheet, gains a Materials category).
- Where it opens:
  - `/invoicing/payments?job=<id>` opens it over the view as a drawer (scrim closes it). Every address on the page goes there through `OpenJobLink`, keeping the tab, filters and search.
  - `/invoicing/job/[id]` is the same component, full page. `from` sets the back link; `addcost=1` opens Add cost; old `?tab=costs` links open Money out.
  - The old MoneyView renders only for a job outside the payments model, until Step 8 deletes it.
  - The "Est-vs-actual bars arrive with 6b" text is gone.
- Behaviour change: opened bare, the back link says Payments (it said PC Command). The work order is its own button beside it.
- Specs moved onto the panel (same journeys, the panel's buttons): `invoicing`, `cost-intake`, `employee-timesheet`, `payments-prework`. `revision-builder` is unchanged (the Revise scope link keeps its test id).
- Stale assertions fixed on the way:
  - `payments-prework`: `invoice_draft_deposit` refuses non-staff with `error:not_staff` since Step 3 (20270256 re-granted it for Create deposit).
  - `employee-timesheet`: asserted two labour lines, then one.
- Gate:
  - Unit 3,569 passing. Typecheck clean. Lint 3 warnings (ceiling 4). Help index current.
  - e2e `payments-panel` 1/1: row → panel with the same figures; a draft's due date; profit to the cent ($3,779.92, 37.8%) with a voided cost ignored; the contractor invoice = the Contractors block; the full page = the same panel; no sideways scroll at 390 px.
  - `invoicing` 13/13 (the re-run owed from Step 6, now on the panel). payments-page / actions / message / contractors / materials 22/22. cost-intake + revision-builder green; payments-prework 4/4.
- Red, unrelated: `employee-timesheet` "the payroll CSV…" expects the header without `bonus_cents`. The CSV gained it with the bonus build (8–9 Oct). Nothing here touches payroll. 4 later tests in that serial file did not run.
- ⚑ for Step 8: non-materials job costs (scaffold, rubbish…) are approved and paid only on the old Payables tab. The panel lists them but has no Approve / Paid for them. Payables is deleted in Step 8, so they need a home first.

## Step 8 — split in four (Tom, 13 Oct)
The inventory before deleting found the old Payables tab is the only screen for: expense claims, ask-first pre-approvals, employee reimbursements, Green fast-terms hold/release, approving a draft RCTI, the paid reference/date, non-materials costs (approve/pay, intake category, unread documents with typed amounts) and materials with no job. "Remove what is replaced" (brief rule 9) means they move first.
- Tom ruled: **port them into Payments**, then delete. Of the old customer filters, bring back **invoice-number search** and the **aged-receivables bar**; the rest stay replaced by the three views (⚑P17).
- 8a: §6.3/6.4/6.5/6.7 + cost rows + search + aged bar. 8b: Contractors (hold/release, RCTI, reference/date) + Expenses. 8c: Costs (any category, typed amounts, no-job materials). 8d: switch-over, delete, links, full loop, help, CLAUDE.md.

## Step 8a (13 Oct 2026)
- Migration `20270260000000_payments_final_redraft.sql`, additive. Applied on C1, read-back 5/5 (the first read-back caught `anon` holding EXECUTE through PUBLIC; the file now revokes it).
  - Trigger `invoices_redraft_final`: an invoice other than the final leaving draft (or voided after issue) re-drafts a standing DRAFT final through `invoice_draft_final`. A sent final is never touched.
  - `invoice_redraft_final(estimate)`, staff only: the panel's Redraft.
- §6.3 (4/20 Cockatoo St) closed: the final was drafted while the deposit was a draft (drafts aren't invoiced), the deposit was then paid, nothing re-worked the final. Now the trigger does; drafts already stale show "…charges too much. Redraft" on the card (`finalDraftIsStale`: the invoiced total moved since the `drafted` event recorded it — an intentional edit is not staleness).
- §6.4 (INV-0049) closed: the staff invoice page took "Less previously invoiced" straight from the ledger, which includes the invoice itself once issued. `previouslyInvoicedCents` backs it out — the rule `invoice_by_token` already used for the customer's copy. Also fixes "Remaining payable after this deposit".
- §6.5 closed by name: lane 07 is "Closed — signed off" (it is reached at sign-off; the final's state shows on the pills). PC Command, help and `wo-sign-return` follow.
- §6.7 closed: the Activity tab is built (`lib/invoicing/activity.ts`), views of one invoice fold into one line with a count and a date range.
- Found and fixed on the way: a card's "Already paid" on a deposit draft the row hides by rule (§6.2) paid the FINAL — the card's own invoice is now always the sheet's first target.
- Money out: cost rows (scaffold, rubbish, other trades, materials not listed as supplier invoices) get Approve, then ✓ Paid with Undo. Labour has none (payroll, Tom 9 Oct).
- Search matches every invoice number on the job; the aged-receivables bar (old buckets: not overdue · 1–7 · 8–14 · 15–30 · 30+) sits under the Customers views, from the old `agedBucketsCents`.
- Gate: unit (invoicing) 257 passing; typecheck clean; lint 3 warnings. e2e `payments-page` 5/5, `payments-panel` 3/3.

## Step 8b — Contractors: terms, RCTI, paid reference, Expenses (13 Oct 2026)
- No migration. Every action is an existing staff RPC the old Payables tab called.
- Contractor invoices:
  - `ciAwaitsApproval` (derive.ts), one rule for the Contractors block, the old Payables tile and the home dashboard: submitted, or a draft RCTI (recipient-created, so it waits on the office). The old tile counted only submitted while its own list approved draft RCTIs. `lib/reporting/load.ts` now passes `rcti`.
  - Draft RCTIs sit under To approve ("drafted for them, figures set when you approve"), with Approve.
  - Chips: RCTI · Bonus · Green · 3 business days · Held — reason. Hold fast payment (reason) and Release (`holdFastTermsAction` / `releaseFastTermsAction`).
  - "Paid, with reference…" beside one-press ✓ Paid: bank reference + date paid (default today, never later). Same path as ✓ Paid (`payCiQuickAction` gains optional `reference` / `paidOn`), so Undo and the remittance-after-Undo hold.
  - A refused approve now says why (`eachCi` returns the function's reason; `nothing_remaining` worded).
- Expenses on the Contractors tab (`ExpensesView.tsx`, `lib/invoicing/expenses.ts`, `expensesData.ts`): claims (Approve / Reject + receipt), ask-first (Approve up to a typed cap / Decline), owed back to employees (Paid back). The Contractors card adds "N expenses to decide · $X owed back".
  - `loadExpenseQueues` (data.ts) is the one read for the old tab and the new page, and now reports a failed reimbursements read (the old loader dropped it).
- Gate:
  - Unit 3,547 (lib) passing. Typecheck clean. Lint 3 warnings.
  - e2e `payments-expenses` 2/2: RCTI approve, Hold + Release, Paid with reference (bank_reference and paid date stored), claim approve, ask-first approve with a $650 cap; an anonymous session is refused.
  - Regression 38/39: payments-contractors, contractor-invoicing, dashboard-invoicing, cost-intake, contractor-expenses, employee-money-tab.
- The one red, unrelated: `employee-money-tab` "changing the lead…" expects `ok:lead` from the lead function, which answers `ok:lead_set` since 20270230 (8 Oct). Stale assertion; nothing here touches it.
- Not covered by e2e here: Paid back (needs an employed-painter fixture). `employee-money-tab` covers it on the old tab and is repointed in 8d.

## Step 8c — Materials: any category, typed amounts, no job yet (13 Oct 2026)
- No migration. The writes are the old Payables tab's own functions (`cost_intake_confirm`, `material_cost_assign`).
- "Record as a cost…" on every To check row (the primary button when the reading failed): the old confirm panel as a sheet.
  - Category chips (materials, scaffold, render, carpentry, rubbish, equipment, permit, traffic, other).
  - The job (the one found is preselected) and the total inc GST + GST, typed when needed; GST prefills to a tenth (`gstFromIncCents`).
  - `confirmCostAction`: zod-validated cents, refuses GST ≥ total, derives ex GST on the server, files a job cost with the document attached.
  - An unread document is no longer stuck at Delete / View.
- "No job yet" (`materialsView.noJob`, the home tile's own `needsMatching` predicate): materials recorded with no job and not overhead, with Assign to a job. Counted on the Materials card ("N with no job"), not in what's owed — they are recorded costs.
- The page's money guard (`jobMoney.boundary.test.ts`) missed `s + r.amountCents` (a property on the right of the operator). Widened; the only hit was this step's own total, now `block.noJobCents` in the lib.
- Gate:
  - Unit 3,548 (lib) passing. Typecheck clean. Lint within the ceiling.
  - e2e `payments-materials` 3/3: an unread docket recorded as rubbish, $220 typed, GST prefilled to $20, stored as $200 + $20 with the document; a no-job material assigned to its job.
  - Regression 19/19: cost-intake, dashboard-invoicing, payments-panel, payments-page.
- Tom, 13 Oct: keep the GST and the confidence % from the old intake card; the accuracy readout goes. To check rows now show "GST $x" with the invoice number, and "Job found from the order reference, read with N% confidence" when the job came from the reference (the old card's own rule). e2e checks the GST; unit tests both.
