# Employed painters — Session 0 report (read-only diagnostic)

**Date:** 17 Sep 2026 · **Branch:** `feat/employed-painters` (worktree `paint-group-platform-employees`, off `origin/main` at `139d2d9`) · **Source files changed:** none.
**Brief:** `docs/briefs/claude-code-brief-employed-painters.md` (v2). This report is the artefact §6 Session 0 asks for. **Tom confirms before Session 1 writes anything.**

Every file:line below was read in this session. Where the brief and the repo disagree, the repo is quoted and the brief's wording is called out under §1 and §7.

---

## 1. Reference-file reconciliation (stop-and-report rule)

| Brief reference | Found? | Where it actually is |
|---|---|---|
| `CLAUDE.md` | yes | repo root |
| "Scheduling + contractor portal build docs (phases A–F)" | **not as a doc set** | Phase entries in `PROJECT_STATUS.md:39-47`; design rationale in `docs/ARCHITECTURE.md` §"Contractor portal, scheduling and onboarding" (line 511), §"Projects console: the schedule moves in" (119), §"Booking → work order: the calendar comes first" (1040), §"Reoffer, job kind, and staff-side ticking" (1102). Each migration carries its phase in its header. |
| `claude-code-brief-wo-loop-pc-command.md` + `work-order-completion-workflow.md` | yes | `docs/briefs/` |
| `claude-code-brief-remediation-server-boundary.md` | yes | `docs/briefs/` |
| `claude-code-brief-invoicing-payments.md` §6.5, 6b, 6c | yes | `docs/briefs/`; the code is `supabase/migrations/20261127000000_contractor_expenses.sql`, `app/portal/money/Expenses.tsx`, `app/invoicing/PayablesCosts.tsx` |
| `acceptance-to-paid-workflow.md` | yes | `docs/briefs/` |
| `claude-code-brief-customer-portal.md` | yes | `docs/briefs/` |
| `claude-code-brief-help-content-foundation.md` | yes | `docs/briefs/` |
| **`lib/invoicing/attention.ts` + "the PC Command attention queue"** | **does not exist** | The CLAUDE.md-mandated queue is `lib/crm/work-queue.ts`. The PC Command page renders a **second** evaluator, `lib/workorder/console.ts::buildQueue` (line 153). See ⚑C. |
| Role-view rulings (`view=` param) | partly | `?view=` exists only on the staff quote builder (`app/quote/page.tsx:59`). Painter-facing routes have **no view contract**; the WO family uses a `variant: "contractor" \| "crew"` prop (`app/w/WorkOrderDoc.tsx:41-48`). See §4. |
| Trade portal v2 brief, Session 0 | yes | `docs/briefs/claude-code-brief-trade-portal-v2.md` §3 — pattern followed here |

Nothing was built around. The two missing references are recorded as rulings ⚑C and ⚑D.

---

## 2. The shipped model in one screen

- **Painter record** = `public.contractors` (`20260813000000_initial_schema.sql:71`), one row per painter, keyed to `profiles.role = 'contractor'` (enum `user_role` = staff | customer | contractor). There is **no `is_contractor()`**; the idiom is `contractor_id = public.current_contractor_id()` (25 policies). TS model `lib/contractor/model.ts` pins the column list (`CONTRACTOR_COLUMNS`, line 49); a new column is invisible to the app until added there, and unwritable until column-granted (`20261221000000_contractor_weekend_availability.sql:11-15`).
- **Compliance** is `contractor_documents` with `contractor_doc_kind = insurance | licence | other`. **No white card or working-at-heights column exists anywhere.** `contractors.offerable` is trigger-computed from a verified, unexpired insurance doc (`20260831000000_compliance_hardening.sql:58-72`).
- **Booking** = `booking_offers` (`20260826000000_booking_offers.sql:29-53`) with enum `offer_state` = offered | proposed | accepted | declined | expired | withdrawn (+ cancelled). One live offer per job is the partial unique index `booking_offers_one_live` (line 61). SLA = `expires_at = now() + 24h` set in `send_offer` (`20260909000000_offer_requires_compliance.sql:83`). Dates are `start_date` / `end_date` on `booking_offers`, mirrored to `work_orders` by trigger `wo_stage_follows_offer()` (`20261011000000_wo_booking_dates.sql:55-104`).
- **Acceptance** (`respond_to_offer`, `20260826000000:101`): offer → accepted, then the trigger calls `wo_set_stage(wo, 'pre_start', 'system', {offer_id, via:'booking_accepted'})`. The `wo_events` row is `type='stage_changed'`, meta keys `offer_id`, `via`. **`acceptance_mode` exists nowhere yet** — it would be a new meta key on this event, no enum change (matches brief §3.4).
- **Customer confirmation** fires client-side after the RPC returns: `OfferBar.tsx:55-62` / `OfferCard.tsx:100-104` → `POST /api/appointments/confirm` → `sendAppointmentConfirmation()` (`lib/workorder/appointmentEmail.ts:23`), idempotent per booking start date via `appt_confirm_sent` events. **It is not in the same transaction today** (brief §3.2 step 5 asks for same-transaction; see ⚑A).
- **Offer price** is never computed at offer time: `send_offer` copies `work_orders.contractor_payment_cents`, which `issue_work_order` took from the builder snapshot, which `lib/pricing/estimate.ts:535-537` computed (`hours × contractorHourlyCents × offerPct`, default $60).
- **Calendar** = `app/pc/schedule/page.tsx` → `lib/scheduling/board.ts::loadBoard` → `app/pc/schedule/ScheduleBoard.tsx` (1334 lines, pointer-drag, drop opens a confirm sheet, then `sendOfferAction` / `moveBookingAction` / `reassignOfferAction` in `app/pc/schedule/actions.ts`). Lanes are contractors; `Block.kind` = accepted | in_progress | offered | proposed | unavailable. "Unscheduled" tray at `ScheduleBoard.tsx:783`.
- **Unavailability** = `contractor_unavailability(start_date, end_date, reason, source: contractor|staff)` (`20260827000000`). No kinds, no approval, no requested_by/approved_by. Dropping onto a blocked day warns, never refuses (`contractor_is_free()` was dropped as unused).
- **"Who's painting"** resolves through `work_orders.contractor_id → contractors.profiles.name` at exactly four read sites: `lib/portal/data.ts:293-318` (portal, first name), `lib/workorder/appointmentEmail.ts:74-103`, `lib/workorder/walkthroughInvite.ts:100-136`, and the promise copy at `app/e/[token]/CustomerEstimate.tsx:580` ("your lead painter's name").
- **Google Calendar** (`lib/gcal/sync.ts`) is a reconciler over *committed* bookings (`committedIds()` in `lib/contractor/jobs.ts:135-148`), not a push.
- **Stage labels** live in one place, `STAGE_LANES` in `lib/workorder/stages.ts:75-84` (`offered → "Offer"`), read by `app/pc/wo/[id]/page.tsx:313`, `StageAdvance.tsx`, `app/pc/flow/page.tsx:44`, `app/invoicing/page.tsx:196`, `app/w/WorkOrderDoc.tsx:74`. **One rogue copy**: `app/account/(portal)/properties/[id]/page.tsx:19` hardcodes `RAIL = ["Offer", …]`. The stage-1 checklist title "Ready to offer" is at `app/pc/wo/[id]/page.tsx:470-478`.
- **Migrations**: 199 files, highest `20270152000000_import_provenance.sql`. Next is `20270153000000_*`. Every file ends with the `_prod_migrations` self-register line.

---

## 3. Schema decision — `job_assignments`

**Recommendation: a new table, and do NOT mirror contractor acceptances into it in v1.**

Why not extend `booking_offers`:
1. `booking_offers_one_live` (one live offer per job) is the direct negation of "several painters per job". It is one of the two rules the file header says the database enforces, and `wo_stage_follows_offer()`, `expire_booking_offers()`, `wo_booking()`, `committedIds()` and `lib/scheduling/offers.ts` all branch on `offer_state`.
2. `booking_offers` carries `payment_cents` and `hours_allowance`. Putting employee rows in a table with a cents column puts money one policy away from the group that must never see it, and §3.3 asserts money keys are *absent*, not null.
3. `assigned | accepted | released` does not map onto `offer_state`; `accepted` already means a contract, not an acknowledgement.

Why not mirror on contractor accept (the brief's "preferred"):
- The write would have to go inside `respond_to_offer` or the trigger, both of which `20261011000000_wo_booking_dates.sql:17-22` fences off ("reconstructing one of them from memory is how `send_offer` lost its compliance check"). Clean-build rule 3 says contractors must not notice this build.
- Nine paths make or unmake a contractor commitment (accept, decline, resolve ×2, withdraw, cancel, move, reassign, reoffer, expiry). A mirror must stay true on all of them or the calendar and the customer's painter name diverge silently. `committedIds()` exists because "committed" is subtler than `state='accepted'`.
- The benefit (one read surface) is had for free with a read-only union: a `wo_painters(work_order_id)` SECURITY DEFINER function in the `wo_booking()` style that returns contractor bookings ∪ employee assignments. One read surface, one write surface per type, no second copy.

**Proposed shape** (Session 2 writes the DDL; nothing here is written yet):
```
job_assignments   -- ⚑E: this NAME COLLIDES, see below
  id uuid pk
  work_order_id uuid not null → work_orders on delete cascade
  contractor_id uuid not null → contractors            -- the painter row (employment_type = employee)
  start_date date not null, end_date date not null, check (end_date >= start_date)   -- house spelling, not starts_on/ends_on
  is_lead boolean not null default false
  status text/enum: assigned | accepted | released
  assigned_by uuid, assigned_at timestamptz not null default now()
  accepted_at timestamptz, released_at timestamptz
  unique index (work_order_id) where is_lead and status <> 'released'     -- exactly one lead, same shape as booking_offers_one_live
  unique (work_order_id, contractor_id) where status <> 'released'
  indexes on work_order_id, contractor_id, (contractor_id, start_date, end_date)
  RLS: staff all; painter select own rows only; every write via RPC; insert/update/delete revoked from authenticated
```
`painter_unavailability` → **extend `contractor_unavailability`** rather than add a sibling: add `kind (leave|rdo|sick|other)`, `requested_by`, `approved_by`, `approved_at`; the existing `blockOutAction` insert path and the `unavailable` lane block keep working. One calendar table for both types (clean-build rule 6).

**⚑E — name collision.** `public.job_assignments` **already exists** (`20260813000000_initial_schema.sql:311-323`, enum `assignment_status`, on the legacy `jobs` table, with `offer_cents`). No TS reads it, but `jobs_contractor_select` RLS (line 526) and `scripts/c1/reset.mjs:38` reference it. Session 2 must either (a) drop the legacy table + enum after confirming both are empty on test and prod, or (b) name the new table `wo_assignments` to match the `wo_*` family of the loop tables. **I recommend (b)** — no prod DDL risk, consistent with `wo_variations`, `wo_events`, `wo_signoff`.

---

## 4. Money-render inventory — every place money reaches a painter today

Every painter-facing route reads money tables **directly under RLS**, not through a narrowing RPC. There is no server payload contract on the painter side; the `view=employee` contract of §3.3 is net-new.

| Surface | File:line | What money | Source |
|---|---|---|---|
| `/portal` home | `app/portal/page.tsx:217-221` mounts `OfferCard`; `:61-77` reads `wo_variations.deduction_cents` | offer price via card; GST status `:273` | direct |
| `/portal/requests` | `app/portal/requests/OfferCard.tsx:144-163` | "Calculated labour hours", "Extra prep allowed", **"Your price"** | `booking_offers.payment_cents, hours_allowance` direct (`lib/scheduling/offers.ts:39`) |
| `/portal/jobs` | `app/portal/jobs/page.tsx:54` | per-job contract price | `work_orders.contractor_payment_cents` direct (`lib/contractor/jobs.ts:36`) |
| `/portal/jobs/[id]` | `page.tsx:94,148,152-188,286,472`; `OfferBar.tsx:89-92`; `Variations.tsx:211-243` | sticky offer bar; **Accept $X — N hrs**; "added to your payment" | `work_orders`, `contractor_invoices`, `wo_variations` direct |
| `/portal/money` (tab labelled **INVOICING**, `PortalTabs.tsx:10`) | `page.tsx:36-169`, `RequestClaim.tsx`, `Expenses.tsx:159-265` | invoice totals, claim composer, expense amounts, $100 threshold | `contractor_invoices`, `work_orders`, `wo_variations`, `contractor_expenses`, `expense_preapprovals` direct; setting `expenseThresholdCents` |
| `/portal/money/[id]` + `/pdf` | `page.tsx:35-188`, `SubmitInvoice.tsx:37`, `lib/invoicing/contractorInvoiceHtml.ts` | full RCTI document | `contractor_invoices` direct |
| `/w/[token]` | `app/w/WorkOrderDoc.tsx:329-338` | "Contractor payment for this job" | RPC `get_work_order_by_token` → `wo_snapshot.contractorPaymentCents` |
| `/crew/[token]` | `lib/workorder/crew.ts:59-82` | **none** — whitelist zeroes `contractorPaymentCents` | RPCs by crew token |
| Messages | `lib/messaging/config.ts:225-229` offer email says "the price"; `:219` invoice prompt; `:266-268` remittance carries `{{amount}}` | | |
| Staff Payables | `app/invoicing/Dashboard.tsx:260-305`, `PayablesCosts.tsx:314-362` | contractor invoices + expense claims + ask-first queue | — (ruling 4: employees appear here only as reimbursements) |

RLS today lets a `contractor` role SELECT cents on: `work_orders` (`contractor_payment_cents` + whole `wo_snapshot`), `booking_offers`, `wo_variations` (column-blind — **`price_cents`, the customer figure, is technically selectable by a contractor today**; pre-existing, out of scope, flagged), `contractor_invoices`, `contractor_expenses`, `expense_preapprovals`. `invoices` / `payments` have no contractor policy (correct).

Money formatters are duplicated in 11 files (no shared display-edge module); the adversarial test should grep keys, not formatters. Key list for the test: `payment_cents, contractor_payment_cents, contractorPaymentCents, contractor_delta_cents, deduction_cents, total_inc_cents, offer_cents, variation_delta_cents, subtotal_ex_cents, gst_cents, previously_invoiced_cents, amount_cents, est_cents, cap_cents, adjustedCents, invoicedCents, thresholdCents, hours_allowance, price_cents, priced_lines` plus the regex in §3.3.

**Existing leak tests to copy** (all assert on the raw response body, not the DOM): `e2e/crew-leak.spec.ts:22-87` (strongest — anonymous context, RSC-escaped patterns like `/contractorPaymentCents[^0-9]{0,6}[1-9]/`), `e2e/contractor-portal.spec.ts:34-57`, `e2e/wo-rls.spec.ts:43-130` (each role's own session), `lib/contractor/privacy.test.ts:54-66` (serialise the object, assert absence), `lib/workorder/boundary.test.ts` (grep-as-a-test; already bans hardcoded `6000` and `hours * rate` outside `lib/pricing/`). **Gap: no test today asserts a painter page is free of *contractor pay*; all existing leak tests are about customer pricing.** Session 1's adversarial test closes that.

**Implication for Session 1.** Because the `contractor` role's policies are the leak, `seesMoney=false` cannot be a rendering flag. The employee path needs (a) policies on the six tables above that exclude `employment_type='employee'` rows via a SECURITY DEFINER helper (`is_employee()`), and (b) money-free RPCs / views the portal reads through when `capabilities.seesMoney` is false. The crew whitelist (`lib/workorder/crew.ts`) is the pattern for the WO document.

---

## 5. Shared infrastructure the build plugs into

- **Work queue** — `lib/crm/work-queue.ts`. New kind = four registry edits (`WORK_ITEM_KINDS:36`, `KIND_WEIGHT:172`, `GROUP_OF_KIND:255`, `CUSTOMER_VISIBLE:141`) + one `buildXItems()` source + one spread in `buildWorkQueue` (`:1410`) + one read in the `Promise.all` (`:1202`). Copy `buildHoursPendingItems` (`:1051-1074`) for per-row items, `buildMessageApprovalItem` (`:727`) for aggregates. `SubjectRef.type` already has `work_order`. Exactly one `action` per item.
- **Messaging** — templates are fields on `MessagingSettings` (`lib/messaging/config.ts`) + an entry in `AUTOMATIONS` (`lib/automations/registry.ts`, `audience: "painter"`), sent via `sendAutomation()` (`lib/automations/dispatch.ts`). Painter contact resolution: `lib/contractor/notify.ts::contactFor`. No painter-side preference table exists; painter sends are gated by the office switch only.
- **Admin** — painters are managed at **`/contractors`** (`app/(app)/contractors/ContractorsManager.tsx`, 595 lines), not "Settings → Painters". Add-painter = `sendInvite()` (`:89-112`) → RPC `create_contractor_invite`. Row-toggle RPCs to copy for `set_employment_type`: `set_contractor_requires_qa` (`:131`), `set_contractor_rcti` (`:160`). **There is no Facebook self-registration form**; only `/join/[token]` → `redeem_contractor_invite`.
- **Feature flag** — a `settings` row. Copy `lib/wizard/publicFlag.ts` wholesale → `lib/painters/employeesFlag.ts`, key `employees_enabled`, default `{enabled:false}`; read in `app/(app)/settings/page.tsx:162` style; `e2e/global-setup.ts` force-enables `wizard_public` for the run and should do the same here.
- **Help** — role enum in **two places in lockstep**: `scripts/help-index.ts:26` and `lib/help/content.ts:19`, plus `rolesFor()` (`content.ts:45`) and `helpReader()` (`lib/help/session.ts:14`). Existing contractor files: `docs/help/{work-orders,scheduling,self-invoicing,help-centre}/contractor.md`, `docs/help/_tours/contractor.md`.
- **Completion report** — one generator (`lib/workorder/reportHtml.ts` + `app/s/[token]/CompletionReport.tsx`), assembled in SQL by `wo_generate_report_draft` (`20261028000000:344`). **Neither renders a painter name today.** "Internal lists every painter" needs a migration to the draft builder, not a render change.
- **Daily update draft** — `lib/workorder/draftFromTicks.ts:16`, Melbourne-day scoped; `wo_events.actor` already records who ticked.
- **Walkthrough Mode A** — `wo_start_walkthrough_mode`, `app/portal/jobs/[id]/tickActions.ts:129-145`; served into whichever painter session calls it, so "any assigned painter can run it" is already true once RLS lets the painter see the job.
- **e2e login provisioning** — `e2e/helpers.ts:7-16` `Who = CONTRACTOR | STAFF | CUSTOMER` gains `EMPLOYEE`; `e2e/global-setup.ts` `REQUIRED_IN_CI` gains `E2E_EMPLOYEE_EMAIL/PASSWORD`; fixture `e2e/fixtures/woLoop.ts` (`contractorIdForEmail`, `createLoopFixture`, `destroyLoopFixture`, `rpcAs`) works unchanged if employees stay `contractors` rows. Seed script pattern: `scripts/create-test-contractors.ts`. Anything created must be torn down by marker (CLAUDE.md).

---

## 6. File map — what each session touches

**New files**
- `lib/painters/capabilities.ts` (+ `.test.ts`), `lib/painters/employeesFlag.ts`, `lib/painters/employeeDoc.ts` (money whitelist, crew.ts pattern, + serialise-and-assert test)
- `supabase/migrations/20270153000000_employment_type.sql` (S1), `…_wo_assignments.sql` + `…_unavailability_kinds.sql` (S2), `…_timesheets.sql` (S6), each self-registering and ending with a read-back select
- `e2e/employee-money.spec.ts` (S1, the adversarial test), `e2e/employee-assign.spec.ts` (S2), `e2e/employee-portal.spec.ts` (S3), `e2e/employee-variation.spec.ts` (S4), `e2e/employee-money-tab.spec.ts` + `e2e/painters-employee-tick.spec.ts` (S5), `e2e/employee-timesheet.spec.ts` (S6), `e2e/employee-full-loop.spec.ts` (S7)
- `docs/help/{scheduling,work-orders,expenses,timesheets,portal-settings}/employee.md`, `docs/help/_tours/employee.md`
- `docs/briefs/employed-painters-progress.md` (ledger, created this session)

**Edited additively** (capability props, never a fork)
- S1: `lib/contractor/model.ts` (column), `supabase` policies on the six money tables, `lib/help/content.ts`, `scripts/help-index.ts`, `e2e/helpers.ts`, `e2e/global-setup.ts`, `lib/workorder/boundary.test.ts` (new rule)
- S2: `lib/scheduling/board.ts` (employee lanes, `Block.kind` gains `assigned`), `app/pc/schedule/ScheduleBoard.tsx` + `actions.ts` (drop on employee lane → `assign_job`; lead button), `lib/validation/booking.ts` (assignment schemas, amount-free), `lib/contractor/jobs.ts::committedIds` (union), `lib/gcal/sync.ts` (reads the union), `lib/workorder/appointmentEmail.ts`, `walkthroughInvite.ts`, `lib/portal/data.ts` (lead painter read)
- S3: `app/portal/page.tsx`, `requests/*`, `jobs/page.tsx`, `jobs/[id]/page.tsx` + `OfferBar.tsx`, `PortalTabs.tsx`, `lib/workorder/stages.ts` (`stageLabel(stage, acceptanceMode)`), `app/pc/wo/[id]/page.tsx:470` ("Ready to assign"), `app/account/(portal)/properties/[id]/page.tsx:19` (rogue rail)
- S4: `app/portal/jobs/[id]/Variations.tsx`, `variationActions.ts`
- S5: `app/portal/money/*`, `app/portal/profile/ProfileForm.tsx` (field groups by capability), `app/(app)/contractors/ContractorsManager.tsx` (tick box + inline refusal), `app/invoicing/PayablesCosts.tsx` (reimbursement queue routing), `lib/workorder/reportHtml.ts` + `app/s/[token]/CompletionReport.tsx` + `wo_generate_report_draft` (lead painter line)
- S6: job ledger posting (`lib/invoicing/ledger.ts`), payroll CSV route, `app/(app)/contractors` cost-rate editor
- S7: `lib/crm/work-queue.ts` (four kinds), `lib/messaging/config.ts` + `lib/automations/registry.ts` (seven templates), `lib/contractor/notify.ts`

**Not touched, by rule**: `respond_to_offer`, `send_offer`, `wo_stage_follows_offer`, `booking_offers_one_live`, the `wo_stage` enum, `wo_events` shape, `contractor_expenses`, variation tables.

---

## 7. Contractor tests expected to stay untouched

**Expected answer: none change.** The full list that guards the contractor path (each must stay green every session, unchanged):

`offer-accept`, `wo-booking`, `wo-reoffer`, `wo-reschedule`, `office-accept-email`, `contractor-portal`, `contractor-invoicing`, `contractor-expenses`, `revision-contractor`, `crew-leak`, `wo-rls`, `wo-full-loop`, `wo-stage-advance`, `wo-checklists`, `wo-ticks`, `wo-photos`, `wo-qa`, `wo-qa-ruling`, `wo-prep-questions`, `wo-walkthrough-v3`, `wo-signoff`, `wo-sign-return`, `wo-updates`, `wo-variations`, `variation-auto-release`, `wo-batch3`, `wo-batch4`, `pc-console`, `invoicing`, `ledger-parity`, `cost-intake`, `settings-staff`, `staff-alerts`, `portal-*` (8 customer-portal specs).

Vitest: `lib/workorder/stages.test.ts` (parses the migration; **adding no transition keeps it green**), `boundary.test.ts`, `crew.test.ts`, `contractorPay.test.ts`, `lib/scheduling/*.test.ts`, `lib/contractor/privacy.test.ts`, `lib/crm/work-queue.test.ts`.

Two places where a contractor test *could* be touched, and what avoids it: `lib/workorder/boundary.test.ts` gains a new rule (additive, existing assertions unchanged); `e2e/contractor-portal.spec.ts` is left alone — the employee money spec is a new file.

---

## 8. Rulings needed before Session 1 (⚑)

| # | Question | My default if Tom says nothing |
|---|---|---|
| ⚑A (brief) | Customer confirmation on an employee job — at assignment or after Accept? Today it fires client-side after the accept RPC, not in a transaction. | At assignment. Fire it from the `assign_job` server action after the RPC commits (same shape as today), not inside the SQL transaction — the confirm path sends email and must not roll back a booking. |
| ⚑B (brief) | Lead change mid-job: no customer notification. | As stated. |
| ⚑C | **Two attention evaluators exist**: `lib/crm/work-queue.ts` (CLAUDE.md law) and `lib/workorder/console.ts::buildQueue` (what `/pc` renders). Where do employee items go? | `lib/crm/work-queue.ts` only. `/pc` keeps rendering its own cards untouched; the four employee items appear on the CRM Today queue and badge. Consolidating `console.ts` is a separate parked job. |
| ⚑D | Brief references `lib/invoicing/attention.ts` (absent) and "Settings → Painters" (absent; painters live at `/contractors`). | Read both as `lib/crm/work-queue.ts` and `/contractors`. The tick box goes on the `/contractors` row and the invite form. |
| ⚑E | `job_assignments` name collides with a dead v1 table. | Name the new table `wo_assignments`; leave the legacy table alone. |
| ⚑F | White card / working-at-heights do not exist for contractors either. | Add `white_card` and `working_at_heights` to `contractor_doc_kind` in S1 (additive enum values), so the document card, expiry and verification flow are reused for both types. |
| ⚑G | Brief says `starts_on/ends_on`; every shipped scheduling column is `start_date/end_date`. | Use `start_date/end_date`. |
| ⚑H | `painter_unavailability` as a new table vs extending `contractor_unavailability`. | Extend (kind, requested_by, approved_by, approved_at). One calendar table. |
| ⚑I | No Facebook self-registration form exists; only `/join/[token]`. | Nothing to change; the invite form gets the tick box and `redeem_contractor_invite` keeps creating contractors. |
| ⚑J | Pre-existing: `wo_variations` RLS is column-blind, so a contractor can select `price_cents` (the customer figure). | Out of scope for this brief; logged for the parking lot. The employee policy will not inherit it. |

---

## 9. Baseline

- `origin/main` = `139d2d9`; worktree has its own `node_modules`.
- Unit tests on this worktree, 17 Sep: 247 files, 2585 passed, 2 skipped (`npx vitest run`).
- Highest migration `20270152000000`; next `20270153000000`.
- Settings keys the build expects and which exist: `expenseThresholdCents` ✔ (10000), `wo_loop` ✔, `employees_enabled` ✘ (S1 seeds it, default off).
