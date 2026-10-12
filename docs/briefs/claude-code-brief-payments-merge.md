# Claude Code brief: Payments, merged into one page

**Status:** approved design, 12 Oct 2026. Tom signed off the mockup ("good to go") after three rounds.
**Mockup (build to this):** `design/reference/payments-merged-v3-mockup.html`. It is built on live figures read on 12 Oct and contains real customer and supplier names. Commit it to the private repo only.
**Commit this brief to** `docs/briefs/claude-code-brief-payments-merge.md` the day it is received (standing rule: briefs that live only in chat get lost).
**This brief owns:** the layout and actions of the Payments page and the job money panel. **It does not own** the ledger, the invoice state machine, GST, Stripe or the intake pipeline. Those stay exactly as `claude-code-brief-invoicing-payments.md` defines them. If the two disagree on screens, this file wins. On data model and server rules, the older brief wins. Report any contradiction, do not resolve it silently.

---

## 0. What this is, in one paragraph

Today money is spread over a Payments page with three tabs (Receivables, Payables, Activity), a separate invoice list, and a job money view with three more tabs (Payments, Invoices, Costs). Receivables lists 86 invoice rows, 48 of them drafts, under four rows of filters. Recording one bank payment takes about six clicks. This build replaces all of that with **one Payments page** showing customers, contractors and materials side by side, **one row per job**, and **one-press actions**. Nothing changes in how money is calculated. This is a new face on the existing ledger, plus a small number of new actions.

## 1. Reference files: read first, confirm back (kickoff ritual)

Read all of these before writing code and list them back with one line each. **If any is missing, stop and report** (standing rule).

| File | Why |
|---|---|
| `design/reference/payments-merged-v3-mockup.html` | The approved design. Open it at 390 px and at 1440 px. Click every button. |
| `docs/briefs/claude-code-brief-invoicing-payments.md` | Ledger, state machine, server rules §4, existing screens §7 |
| `docs/briefs/acceptance-to-paid-workflow.md` | Chase ladder semantics. Still wins on chase behaviour |
| `docs/briefs/claude-code-brief-cost-capture.md` | Intake queue, snap receipt, vendor memory |
| `docs/briefs/claude-code-brief-wo-loop-pc-command.md` | Work-order stages and the Project Progress board |
| `lib/invoicing/ledger.ts`, `lib/invoicing/gst.ts`, `lib/invoicing/attention.ts` | The single sources this page must read |
| Route `/invoicing` (titled "Payments") and its Receivables, Payables, Activity tabs | What is being replaced |
| Route `/invoices` (the "invoice list →" link) | **Unknown to this brief.** Report what it shows that the new page does not |
| Routes `/invoicing/job/[id]` and `/invoicing/inv/[id]` | Job money view (replaced by the job panel) and invoice document (kept) |
| Route `/pc/flow` and the work-order stage source | The seven lanes this page mirrors |
| The Customer chats panel component (bottom-left "chat" button) | Message follow-up opens this |
| `CLAUDE.md` | Standing engineering rules |

At kickoff also report: the existing RPC names for record payment, issue, send, void, approve contractor invoice, mark contractor paid, confirm intake, reject intake; and whether any payment reversal exists today.

## 2. Rulings from Tom (12 Oct 2026). Settled, do not re-open

**The page**
- R1. One Payments page. It replaces the Receivables and Payables tabs. Four blocks across the top, each showing its live total and acting as the tab: **Customers owe us**, **Contractors**, **Materials**, **Activity**.
- R2. A headline sentence at the top, written from live data on every load. Never hard-coded.
- R3. Amounts owing are the loudest thing on the page: bold, in coloured blocks. Paid amounts are quiet.
- R4. **Overdue goes first everywhere**: first section in To chase, a pinned band at the top of All jobs, first card in each board lane, and shown in red on the stage strip and on the block totals.

**Customers**
- R5. One row per job, not per invoice.
- R6. Every job shows its Project Progress stage. Same seven lanes, same source as `/pc/flow`.
- R7. A job in Booking confirmed or Pre-start with the deposit unpaid goes to the top and glows orange.
- R8. Closed jobs with money still to come are the next group.
- R9. A job whose invoices are all paid leaves the active views. It stays findable under "Show paid jobs" and the "Paid in full" filter.
- R10. Three views: **To chase** (default), **By job stage** (board), **All jobs** (one line per job with Deposit, Progress, Final columns).
- R11. **One-press record payment** on any sent invoice: full amount owing, bank transfer, today. "Cash or part" opens the longer form.
- R12. **Quick deposit adjust** on the row for a draft deposit: 10 / 20 / 30 / 50 % buttons and a dollar box.
- R13. The due date is editable before an invoice is sent and locked after.
- R14. **Cash:** when a payment is recorded as cash against an unsent invoice, the invoice is not sent to the customer. A "Send notification of payment" switch decides whether the customer is emailed a confirmation.
- R15. **Message** on every job opens that customer's Customer chats thread with a payment message already written. Staff edit and send. Nothing sends by itself.

**Contractors and materials**
- R16. Payables is split into Contractors and Materials on the same page.
- R17. Materials: every row can open the original captured document (**View**). Rows that are not relevant can be **deleted**. A **Snap a receipt** button on the Materials block opens the existing capture flow.

**Job panel**
- R18. Two tabs only: **Money in** (invoices with their payments underneath) and **Money out and profit**. No separate Payments tab.
- R19. Money out shows every cost and the gross profit from actual costs: contractor, own painters, materials from the supplier invoices logged against the job, and expenses.

## 3. Server rules that still apply (from the invoicing brief §4, restated because this build adds actions)

1. Every money change is a SECURITY DEFINER RPC with zod input. No client writes to money tables.
2. The browser never supplies an amount as truth, with the one existing exception of an operator-entered payment amount, bounded as today. "Set deposit to 20 %" sends the percentage. The server computes cents.
3. Issued invoices are immutable. Changing a sent amount is void plus reissue.
4. Every figure on this page comes from `lib/invoicing`. No arithmetic in components. The grep audit must stay clean.
5. One source for attention: anything this page calls urgent must come from the same function PC Command uses (`lib/invoicing/attention.ts`), so the two can never disagree.
6. Migrations run between gate runs, never during.

## 3A. Data safety and clean code. Non-negotiable

**This is a redesign, not a rebuild.** Existing invoices, invoice numbers, payments, receipts, PDFs, contractor invoices, supplier documents, costs and event history stay exactly as they are. The new page reads the same tables through the same functions.

**Data**
1. **Migrations are additive only.** New tables and new nullable columns are allowed. No `DROP`, no column type change, no `DELETE` or bulk `UPDATE` on any existing money, document or event row. If a step seems to need one, **stop and report**.
2. **Nothing is ever hard-deleted by this build.** Undo on a payment writes a reversal event. Delete on a supplier document is a status change with Restore. Voids burn the number as today.
3. **Tidying is by rule, not by removal.** The leftover drafts in §6 are hidden by the derived row. Do not delete or alter them in the database. If removing them is worthwhile, list them with ids and amounts and wait for Tom's approval.
4. **Reconcile before and after.** Before Step 1, record from production: number of invoices by state, total invoiced, total paid, total outstanding, contractor invoices by state with totals, supplier documents by state. After every step the same query must return the same figures. For reference, on 12 Oct the live page showed 86 invoices, $36,819.33 outstanding on 7 sent invoices, $17,226.71 in 5 contractor invoices to approve. Any difference stops the build.
5. **Test project first.** Every migration runs on the test Supabase project and passes its gate before Tom is handed the SQL for production. Tom confirms a backup or restore point exists before running it.
6. **Reverting is always safe.** Because migrations only add, rolling the code back to the previous commit must leave a fully working old page with no data stranded.

**Code**
7. **Work on a feature branch** (`feat/payments-merge`) in its own worktree. The current Payments page keeps working on main until Step 8.
8. **Reuse, do not duplicate.** Use the existing RPCs, `lib/invoicing` functions, chat panel, intake pipeline and design tokens. No second copy of a helper, no parallel list or badge logic, no new status field where a derived one exists.
9. **Remove what is replaced.** In Step 8 the old Receivables and Payables tabs, the three job tabs, the pulse tiles and the filter rows are deleted from the codebase, not left behind unused. Report the files removed.
10. **Same gates as every build:** type check, lint, tests and the money grep audits green; diff approved before commit; `CLAUDE.md` and the session ledger updated at the end of each session.

## 4. What to build

### 4.1 One derived row per job (server, no UI)

Add one function in `lib/invoicing` (suggested `jobMoney.ts`) that returns, for every job with an accepted estimate:

- job id, address, customer, work-order ref, contractor, **stage** (from the work-order model), start date where booked
- contract, variations, paid, balance
- three **payment slots**, each with a state: `deposit`, `progress`, `final`
- the **next invoice** needing attention and the amount collectable now
- a **health** value used for ordering and colour

**Slot rule.** The first payment request on a job sits in the deposit slot even when the invoice is labelled Progress. This is live today on PS-3153, PS-3102 and PS-3613. Final invoices sit in the final slot. Everything else is progress.

**Slot states**, worst wins when a slot holds several invoices:

| State | Meaning | Colour |
|---|---|---|
| `over` | sent, unpaid, past due | solid red |
| `need` | deposit slot unpaid and the job is Booking confirmed through Walkthrough | solid orange |
| `sent` | sent, unpaid, not yet due | blue edge |
| `draft` | not sent | grey edge |
| `paid` | nothing owing in this slot | quiet green |
| `later` | not invoiced yet, job still open | dashed |
| `uninv` | job is Closed and part of the balance is on no invoice | dashed orange |
| `noinv` | job is booked and has no invoice at all | dashed orange |

**Ordering** used everywhere: `over`, then `need`, then `sent`, then `draft`, then the rest. Within `need`: jobs already under way first, then soonest start.

**Headline** is one function over these rows. Template, with every clause dropped when its count is zero:
"`{n} jobs have no deposit in. {a} start within three days and {b} are already under way. {c} customer invoices are overdue, {$}.`" If nothing is overdue it says "Nothing is overdue." If contractor invoices are past their pay-by date, a further sentence says so.

**Totals** for the four blocks and the seven-stage strip come from the same rows.

Golden tests: build fixtures from the 12 Oct cases listed in §6 and assert slot states, ordering and the headline.

### 4.2 Page shell and the Customers block

Build to the mockup, 1:1, at phone and desktop widths.

- Headline, then the four blocks. The selected block is the tab. Selection is a query param so links are shareable.
- **Stage strip:** seven cells in Project Progress order. Each shows job count, money to collect and any overdue amount. Pressing a cell filters all three views.
- **To chase.** Sections in this order: Overdue · Deposit not in · Closed jobs with money still to come · Other invoices waiting to be paid · Accepted, not booked in yet (collapsed). A closing line counts jobs with nothing to collect.
- **Job row** (the same component in every view): address, customer, contractor; the amount block with its state and due text; a context line (start timing, times the invoice was opened, last messaged); the **rail** (seven stage segments with the three payment dots on it); slot pills; actions.
- **By job stage:** seven lanes, cards with D / P / F lights and the amount block, worst first in each lane, lane header with total and overdue.
- **All jobs:** grouped by stage with the pinned Overdue band on top; columns Job · Job stage · Deposit · Progress · Final · Still owing · actions. Filters: All, Overdue, Deposit not in, Final unpaid, Paid in full. "Show paid jobs" toggle.
- Search by address, customer, contractor or work-order ref.
- **Removed:** the four pulse tiles and the VIEWS / STATUS / MILESTONE / DUE filter rows.
- **Orange glow:** every `need` row has the orange border. Rows starting within a week or already under way also pulse. Respect reduced motion. (⚑P1)

### 4.3 Quick actions

| Action | Where | Behaviour |
|---|---|---|
| **✓ Paid $X** | any sent, unpaid invoice | One press. Records full amount owing, bank transfer, today, `recorded_by`. Confirmation shows **Undo** and **Change** for 8 seconds. |
| **Undo** | the confirmation | Reverses that payment. Money rows are never deleted: write a reversal event with reason `undo`. The receipt must not have gone out (⚑P2). |
| **Cash or part** / **Already paid** | sent / draft invoice | Opens the form: which invoice, amount (bounded as today), date, method Bank · Cash · Other. |
| **Cash rule** | the form | Cash against a draft: issue the invoice without sending (the live form already says it does this), mark paid, show "Paid in cash, not sent". Switch "Send notification of payment", default on (⚑P4). Off sends nothing. |
| **Send** | draft invoice | Small confirm showing amount and due date. Deposit drafts also show the adjust buttons. Default due date: 7 days from sending, or the day before the start date when the job starts sooner. Warn when the due date falls on or after the start. |
| **Deposit adjust** | draft deposit, on the row and in the panel | 10 / 20 / 30 / 50 % or a dollar amount. Server recomputes. Values come from Settings (⚑P5). |
| **Change amount** | sent, unpaid deposit, job panel only | One confirm. One RPC that voids the invoice and issues and sends a corrected one in the same transaction. The old number is burnt as the rules require. (⚑P6) |
| **Due date** | draft invoice | Editable in the send confirm and on the job panel. Locked at send. |
| **Create deposit / final invoice** | `noinv` and `uninv` rows | Drafts the missing invoice from the ledger. |

### 4.4 Message follow-up

- **Message** opens the existing Customer chats panel on that customer's thread for that job, with the composer pre-filled.
- Templates, chosen by situation: Deposit reminder · Friendly reminder (progress or final) · Overdue (pre-selected when the invoice is overdue) · Payment received. Seed text is in Appendix A. Customer copy is in an **English tone, not Australian**.
- Templates are stored in Settings and editable, like the other messages (⚑P8).
- The pay link for the invoice is inserted by the server.
- After sending, the row shows "last messaged N days ago" from the message log.
- Nothing sends without a person pressing Send. This matches the chase-ladder ruling that every nudge is drafted for approval.
- How the message reaches a customer who is not on the site is ⚑P7. Build behind the existing messaging adapter and stop to ask if the adapter cannot deliver from this panel.

### 4.5 Contractors block

- Sections: Past the pay-by date · To approve · Approved, to pay · With the contractor · Paid (collapsed).
- Row: contractor, invoice number and claim note, job address (opens the job panel), job stage, and **what the customer has paid on that job** ("paid nothing yet" in orange, "paid in full" in green, otherwise "$X of $Y"). Amount block and actions.
- **Approve** is one press with Undo. It starts the existing 7-day pay-by timer.
- **✓ Paid $X** is one press with Undo. It records only: no money moves through the platform (existing ruling). Remittance goes out as today.
- **Query** opens a message to the contractor.
- **By contractor** switch groups open invoices by contractor with a total, "Approve all" and one "✓ Paid" for everything approved.

### 4.6 Materials block

- A line of open totals per supplier, and **Snap a receipt** (opens the existing capture flow).
- **To check** (the intake queue). Each row: supplier, invoice number, date, what the supplier wrote as the reference, the suggested job if one was found, the amount.
  - Job found: **Confirm** · **Other job** · **Delete** · **View**
  - No job found: **Pick a job** (searchable job list) · **Not for a job** · **Delete** · **View**
  - Possible duplicate: **View** · **Dismiss**
  - Section button: "Confirm the N with a job found".
- **On a job, to approve:** **Approve** · **Delete** · **View**, and "Approve all N".
- **Approved, to pay:** grouped by supplier, one **✓ Paid $X** per supplier with Undo (⚑P10).
- **Deleted** (collapsed): the row and its document are kept, nothing is counted, **Restore** puts it back where it was. Delete is the existing Reject made reversible. It is never a hard delete (⚑P11).
- **View** opens the original PDF or photo beside the fields that were read from it, with the row's actions underneath. Every cost row in the job panel has the same View.
- **Confirm** means checked and approved in one press (⚑P9). If Tom rules against that, Confirm lands the row in "to approve" as it does today.

### 4.7 Job panel

Opens from any row. Side panel on desktop so the list stays in place. Full screen on a phone. It replaces the three tabs of `/invoicing/job/[id]`. Keep the route working and render the same component there.

- Header: address, customer, contractor, link to the work order.
- Stage box: the rail with all seven stage names, and the slot pills.
- Job total · Paid · Still owing.
- **Money in:** the same actions as the row; links to Request a payment, Invoice in full and Revise scope (all unchanged); one card per invoice with its payments listed underneath, the amount block, the due-date editor and deposit adjuster on drafts; a Messages line that opens the chat.
- **Money out and profit:** gross profit in dollars and per cent with a bar showing where each dollar went; then Job value excluding GST, Contractor (offer plus variations), Own painters, Materials, Contractor expenses, Total costs, Gross profit; then the contractor invoices on the job with status and Approve / Paid; then the supplier invoices on the job with status and View; then Add a cost.
- When a job that has started shows no materials, say so: "No materials are recorded against this job yet, so this profit is too high until the supplier invoices are matched."
- Remove the staff-facing placeholder "Est-vs-actual bars arrive with 6b".

## 5. Build order. One step per session, gate green before the next

### Step 0. Kickoff (no code)

    Read docs/briefs/claude-code-brief-payments-merge.md fully, §3A twice. Open the mockup
    at 390px and 1440px and click through it. Confirm the §1 reference list
    back, one line each. Report: what /invoices shows; the RPC names asked for
    in §1; whether a payment reversal exists; how the Customer chats panel is
    opened from code and whether its composer can be pre-filled. List anything
    in this brief that contradicts the invoicing brief. Run and save the
    §3A.4 reconciliation query as the baseline. List every migration you
    expect to need and confirm each is additive. Do not write code.

**Accept:** every reference found or reported missing · unknowns answered · baseline figures saved · planned migrations listed and all additive · no code changed.

### Step 1. The job money row and the headline

    Build §4.1: the derived per-job row, slot rule, slot states, ordering,
    block totals, stage-strip totals and the headline function, all in
    lib/invoicing. Fixtures from the §6 cases. No UI beyond a raw JSON route
    for checking. Overdue must use the same derived function the chase ladder
    uses. Urgency must come from lib/invoicing/attention.ts.

**Accept:** golden tests cover every state in the §4.1 table · the first-payment-labelled-Progress case lands in the deposit slot · block totals reconcile to the sum of job ledgers on the test data · the headline for the fixture set matches the expected string exactly · no new arithmetic outside lib/invoicing.

### Step 2. Page shell and the Customers block

    Build §4.2 from the mockup: headline, four blocks, stage strip, To chase,
    By job stage, All jobs, the job row with rail and pills, search, filters as
    query params. Read only from Step 1. Actions render but are wired in
    Step 3. Remove the pulse tiles and the four filter rows. Staff-only RLS.

**Accept:** visual parity with the mockup at 390px and 1440px, no sideways scroll · overdue is first in all three views and on the strip · a job with every invoice paid appears only under Show paid jobs or Paid in full · stage shown always equals the stage on /pc/flow · zero client-computed money (grep clean) · keyboard reachable, reduced motion respected.

### Step 3. Quick actions

    Build §4.3. One-press paid with Undo and Change. The cash-or-part form
    with the cash rule and the notification switch. The send confirm with due
    date. Deposit adjust on drafts. Change amount on a sent deposit as a single
    void-and-reissue RPC. Create-missing-invoice on noinv and uninv rows.
    E2e AS STAFF for each.

**Accept:** one press records exactly one payment row with recorded_by · Undo leaves an event trail and no receipt reaches the customer · a second press cannot double-record · cash against a draft issues without sending and sends nothing when the switch is off · a sent invoice's due date cannot change · deposit percentage is computed on the server · change-amount is atomic: a failure leaves the original invoice untouched · every action updates the headline, blocks and strip from data alone.

### Step 4. Message follow-up

    Build §4.4. Message opens the customer's thread with the right template
    pre-filled and the pay link inserted server-side. Templates seeded from
    Appendix A into Settings. "Last messaged" from the message log.

**Accept:** nothing sends without a press of Send · the template picked matches the invoice state · template edits in Settings appear on the next open · the sent message is in the thread and the event log · customer copy reads in an English tone.

### Step 5. Contractors block

    Build §4.5 over the existing contractor invoice flow. One-press Approve and
    Paid with Undo. Customer-paid line from the Step 1 row. By-contractor
    grouping with bulk actions. Pay-by overdue from the existing 7-day rule.

**Accept:** "to approve" total equals the old Payables tile on the same data · the customer-paid line matches the job panel · bulk actions write one event per invoice · no money moves, records only · the contractor still sees only their own invoices.

### Step 6. Materials block

    Build §4.6 over the existing intake pipeline. Confirm, Other job, Pick a
    job, Not for a job, Delete with Restore, View, Dismiss duplicate, bulk
    confirm and approve, pay by supplier, Snap a receipt entry. Fix the three
    §6 materials defects in this step.

**Accept:** every row opens its original document · a deleted row counts nowhere, keeps its document and restores to its previous state · confirming to a job changes that job's materials total and profit · supplier invoices land under Materials, not Other · the block count equals the intake queue count · one supplier appears under one name.

### Step 7. Job panel

    Build §4.7. Side panel on desktop, full screen on phone, same component on
    /invoicing/job/[id]. Money in and Money out and profit. Remove the 6b
    placeholder text.

**Accept:** gross profit equals job value excluding GST minus the listed costs, to the cent, and every line traces to a cost row · contractor and supplier invoices shown match the Contractors and Materials blocks · the panel and the row never show different amounts for the same job.

### Step 8. Clean-up, retire the old, full loop

    Retire the Receivables and Payables tabs and, if Step 0 found nothing
    unique on it, redirect /invoices here. Repoint every deep link from PC
    Command and the home dashboard. Fix the remaining §6 defects. Full-loop
    e2e in real roles: accept → deposit draft → adjust to 30% → send →
    message → one-press paid → undo → paid again → job under way → supplier
    invoice confirmed → contractor invoice approved and paid → final sent →
    paid in cash with notification off → job leaves the active views →
    profit on the panel reconciles. Update CLAUDE.md and the help content.

**Accept:** no route or link reaches the old tabs · the replaced components are deleted and listed in the PR · the §3A.4 reconciliation figures are unchanged from before Step 1 · both e2e roles green in CI · grep audits clean · the §6 list is closed or each item is reported with a reason.

## 6. Defects and odd data seen live on 12 Oct. Fix or report each

**Customers**
1. `$0.00` draft invoices sit in the list (25 Lorikeet Rd, 5305/568 Boronia St, 13 Wren Cres). Hide them by rule and stop creating new ones. Do not delete the existing rows (§3A.3).
2. Deposit drafts remain on jobs that already have a final invoice (1105/243 Melaleuca St, Avocet Plaza, 31 Kestrel St E, 29A Mudlark St, 87/80 Lyrebird Cres, 13 Wren Cres). Hide them by rule, and from now on clear the deposit draft at the moment a final is drafted. Do not delete the existing rows without Tom's approval (§3A.3).
3. 4/20 Cockatoo St: the draft final shows $4,223.37, the whole contract, though the $2,111.69 deposit is paid. Check whether draft finals net off earlier invoices.
4. INV-0049 (40 Brolga Blvd): the totals show "Less previously invoiced — INV-0037 deposit −$9,009.86", the whole contract. The balance due is right. Check the line above it.
5. The lane is named "Closed — final invoice sent" but holds jobs whose final is a draft, and one job with no invoice at all (1 Egret St, $13,121). Fix the name or the gate.
6. Three jobs are under way with nothing paid and the deposit still a draft: 17 Kite St, 12A Saltbush Ct Interior, 91 Kookaburra St. 77 Stint Rd is booked with no invoice. See ⚑P15.
7. Activity repeats "Invoice viewed by customer" once per view. Fold into one line with a count.

**Materials**
8. The tile says "Materials to match: 0, every supplier invoice is on a job" while 15 documents wait in intake and 10 have no job.
9. Supplier invoices are categorised `other` and land under "Other trades & costs", so most jobs show $0 materials and profit reads too high.
10. One supplier appears under several names (Dulux / Dulux Australia; Haymes Paint / HENRY HAYMES PTY LTD). Use vendor memory to show one name.

**Naming**
11. The page header says Payments, the breadcrumb says Invoicing, the job page says Money view. Use **Payments** for the page and **job panel** for the job.

## 7. Flags for Tom. Defaults below are what the mockup does

Only the two marked BLOCKING stop a step. Build the rest as Settings values with the stated default.

| ⚑ | Decision | Default built |
|---|---|---|
| P1 | Should every deposit-not-in row pulse, or only those starting within a week or under way? | Only those. All are orange. |
| P2 | One-press default: bank transfer, today, full amount. When does the receipt email go? **BLOCKING for Step 3** | Receipt goes when the 8-second undo window closes |
| P3 | Cash: does it hold back only the invoice the cash paid, or every later invoice on the job? And accountant to confirm "issued but not sent" is acceptable for GST and for MYOB. | Only the invoice the cash clears in full. The invoice is still issued and recorded. |
| P4 | "Send notification of payment" default | On |
| P5 | Deposit buttons and any cap. The invoicing brief's legal check on deposit limits (its ⚑2) is still open. | 10 / 20 / 30 / 50 %, no cap, values in Settings |
| P6 | Who may change a sent deposit (void and reissue)? | Any staff role, event-logged |
| P7 | A chat message to a customer who is not on the site: text, email or both? **BLOCKING for Step 4** | None. Ask. |
| P8 | Wording of the four payment messages | Appendix A, editable in Settings |
| P9 | Supplier invoice: is Confirm also approval? | Yes, one press |
| P10 | Suppliers paid per invoice or per monthly statement? | Grouped by supplier, one Paid per supplier |
| P11 | Deleted supplier documents: is a reason required, and how long are they kept? | No reason, kept until Tom rules |
| P12 | Tom's own test jobs on the board are counted in the headline. Exclude them? | Counted |
| P13 | Which roles see gross profit? Still open from the home dashboard rulings. | All staff |
| P14 | Are contractor offers recorded excluding or including GST? Profit assumes excluding. | Excluding |
| P15 | Jobs imported from PaintScout may have had deposits taken outside the platform. How are those recorded so the headline is right? | Not recorded. The headline counts them as no deposit in. |
| P16 | Retire `/invoices` if Step 0 finds nothing unique on it? | Redirect to Payments |
| P17 | Keep all three views? | Yes |

## 8. Definition of done

1. One Payments page shows customers, contractors and materials. The old Receivables and Payables tabs are gone and nothing links to them.
2. Every figure traces to `lib/invoicing`. No client-computed money. The page, the job panel, PC Command and the home dashboard never disagree.
3. Overdue is first in every view. The headline is computed on every load.
4. Recording a bank payment is one press, with Undo. Adjusting a draft deposit is one press on the row.
5. Every job row can open the customer's chat with a payment message ready.
6. Every supplier document can be viewed, deleted and restored.
7. The job panel has two tabs, and its gross profit reconciles to the cent.
8. The mockup and the build match on a phone and on a desktop.
9. Every ⚑ default is a Settings value, and the open ones are listed in the final PR addressed to Tom.
10. No existing record was deleted or altered: the §3A.4 figures match before and after, every migration was additive, and no dead code from the old page remains.

---

## Appendix A. Seed text for the payment messages (English tone)

`{first}`, `{amount}`, `{address}`, `{due}`, `{start}` and `{pay_link}` are filled by the server.

**Deposit reminder**
> Hello {first}, a quick reminder that the deposit of {amount} for {address} is due on {due}, ahead of our start on {start}. You can pay using the link below, or by bank transfer using the details on the invoice.
>
> {pay_link}
>
> Many thanks,
> Paint Group

**Friendly reminder** (progress or final)
> Hello {first}, thank you again for having us at {address}. A quick reminder that your invoice of {amount} is due on {due}. You can pay using the link below, or by bank transfer using the details on the invoice.
>
> {pay_link}
>
> Many thanks,
> Paint Group

**Overdue**
> Hello {first}, I hope you are well. Our records show the invoice of {amount} for {address} fell due on {due} and is still outstanding. Could you let us know when we might expect payment? You can pay using the link below, or by bank transfer using the details on the invoice.
>
> {pay_link}
>
> Many thanks,
> Paint Group

**Payment received**
> Hello {first}, thank you, we have received your payment for {address}. A receipt is on its way by email.
>
> Many thanks,
> Paint Group

## Appendix B. How this fits the rest of the platform

- **Project Progress** supplies the stage on every row. A job that moves lane moves here with no second status.
- **PC Command** and this page share one attention source, so a deposit card on one is the orange row on the other.
- **Customer chats** carries the follow-up, so payment conversations sit in the same thread as everything else with that customer.
- **Cost capture** (bills@, snap receipt, contractor expenses) feeds the Materials block and each job's profit.
- **Home dashboard** Invoicing and P&L sections read the same rows, so its numbers match this page.
- **MYOB** export and sync are untouched: they still read issued invoices, payments and approved costs.
