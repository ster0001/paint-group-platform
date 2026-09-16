# Claude Code build brief — Employed painters in the painter portal

**Status:** v2 — Tom's rulings applied 16 Sep 2026. Two items still open (§6). Commit to `docs/briefs/` the same day → kickoff with Session 0.
**Owner:** Tom Roman, Paint Group
**Supersedes:** v1 of this brief. Extends the shipped scheduling + contractor portal (phases A–F) and the WO completion loop (v4, six stages).
**Size:** medium. Seven build sessions plus a read-only Session 0. Most of the work is reuse with capability switches; the two places that can go wrong are the money contract and the calendar change — both are gated by tests before anything ships.

---

## 0. Read first

Kickoff ritual applies: commit this brief, then **confirm the file list back before writing any code**. Stop-and-report rule applies to every reference below — if a file is not in the repo, halt and say so; do not guess its contents.

Reference files (all in `docs/briefs/` unless noted):

| File | Why it matters here |
|---|---|
| `CLAUDE.md` (repo root) | Engineering standards: server boundary, money server-side, migrations between gate runs, missing-reference = STOP |
| Scheduling + contractor portal build docs (phases A–F) and the shipped screens under the contractor portal routes | The thing we are extending. Offer / accept / decline / propose, 24h SLA, customer confirmation after acceptance, self-invoicing |
| `claude-code-brief-wo-loop-pc-command.md` (v4) + `work-order-completion-workflow.md` | Six-stage WO model, `wo_events` as source of truth, ticks, variations, QA, walkthrough, sign-off. **Unchanged by this brief** |
| `claude-code-brief-remediation-server-boundary.md` | SECURITY DEFINER RPCs, zod'd server actions, revoked client writes on money/status columns — every new mutation here follows it |
| `claude-code-brief-invoicing-payments.md` §6.5 + session 6c (contractor expenses) and 6b (snap receipt + reimbursements) | Expense claims, pre-approval threshold, reimbursement queue. Employees reuse this, not self-invoicing |
| `acceptance-to-paid-workflow.md` v2 | Contractor payables mirror — employees must NOT appear there except as reimbursements |
| `claude-code-brief-customer-portal.md` | Where customers see "who's painting" — lead painter only |
| `claude-code-brief-help-content-foundation.md` | Help file per feature per role is part of definition of done — employee variant needed |
| `lib/invoicing/attention.ts` + the PC Command attention queue | One work-queue evaluator. New employee attention items go here, nowhere else |
| Role-view rulings (contractor / customer / PC each own a rendered view via RLS + explicit `view=` param, never role-inferred) | Employee view follows the same contract |
| Trade portal v2 brief, Session 0 (read-only colour-register diagnostic) | The pattern Session 0 of this brief copies: read, map, report, no code |

---

## 1. What we are building — in one paragraph

Paint Group is adding **employed painters** (PAYG staff) alongside the existing **contractors**. Both live in the same painter portal and run the same work order, ticks, photos, daily updates, QA, walkthrough and sign-off. The difference is at the edges: an employee's job is **assigned**, not offered — it lands in their calendar and they tap **Accept** once to confirm they've seen it, with no clock, no decline and no re-offer; they **never see a dollar figure** anywhere; their money tab is **expenses only**; their settings page drops insurance and crew-count; **more than one employee can be scheduled to the same job**, each with their own dates, with exactly **one marked as lead painter** whose details the customer sees. Employees also **clock on and off per job**, which gives every employee job a real labour cost and gives the pricing engine its first source of real worked hours.

### What does NOT change (recorded so no session revisits it)

- Work order layout, elevation grouping, level of finish, colour chips — identical.
- Six-stage WO model (Offer → Pre-start → In progress → QA → Walkthrough → Closed) — no new enum values. See §3.4 for the label-only change.
- Per-surface TO DO → PREPPED → DONE ticks, before-photos-before-first-tick rule, PC-approved daily updates drafted from ticks, zero-tick-day catch.
- QA checks, completion checklist popping at the tail of in_progress, walkthrough booking through the scheduling calendar, Mode A sign-off on the painter's device, Mode B fallback gating.
- Variation raising card and the office → customer approval path.
- `wo_events` as the only source of truth; attention queue built from the model, never typed statuses.
- Everything contractors have today. Their screens, offers, SLA, self-invoicing and tests are untouched.

---

## 2. Tom's rulings (binding)

1. Employee jobs go straight into the calendar. No decline, no propose, no 24h SLA, no re-offer.
2. Employees tap **Accept** once on an assigned job. It is an acknowledgement, not approval: it timestamps that they have seen it, nothing waits on it. If the dates change, the acknowledgement resets and they accept again.
3. Employees see no pricing of any kind — no offered price, no estimate value, no variation value. They **do** see allocated days and hours as a time budget, never with a rate.
4. Employee money tab = expenses only. No self-invoicing, no RCTI.
5. Employee settings page has no insurance fields and no crew-count alert. It holds white card and working-at-heights with expiry reminders, nothing else.
6. One job can be scheduled to several employees. **Exactly one is marked lead painter** with a button on the job. Everyone assigned can update scope (tick, photo, raise variations); **only the lead painter's details are shown to the customer.**
7. Work order, walkthrough and sign-off behave exactly as they do for contractors.
8. Employees can raise variations. When approved they see **"Variation approved"** with the added scope lines and hours — never a price. No accept step.
9. Multi-assign is employees only in v1. Contractor jobs stay single-contractor. Mixed crews are a later brief.
10. Timesheets ship in v1 (Session 6). Each employee has an internal cost rate (base + 12% super + 8% WorkCover + allowances ÷ hours, Settings-editable). The platform exports a payroll CSV and never calculates pay.
11. Leave and RDOs: employee requests, PC approves. Sick day: employee marks it, no approval, it raises a Reassign attention item. Employees can also flag "can't make it" on any assignment with a reason — this raises the same item and never changes the assignment itself.
12. New-painter QA schedule applies to new employees, same cadence.
13. Expense pre-approval threshold is the same $100 as contractors; "who paid" defaults to company card.
14. Bonus reporting (jobs completed within allocated hours per employee per month) is a later read-only report, not v1.
15. Marking a painter as employee or contractor is a **simple tick box** in the painters list (Settings → Painters), one per row. Ticked = employee, unticked = contractor. No separate "add employee" or "convert" screens.

---

## 3. Design

### 3.1 One painter identity, two employment types — not a fourth role

Do not add a new auth role. Add `employment_type` (`contractor` | `employee`) to the painter record and derive every behavioural difference from **one capability function**:

```
lib/painters/capabilities.ts
  painterCapabilities(painter) → {
    acceptsOffers: boolean,        // contractor true (accept/decline/propose + SLA)
    acknowledgesAssignments: boolean, // employee true (one-tap Accept, no clock)
    seesMoney: boolean,            // contractor true, employee false
    seesTimeBudget: boolean,       // both true
    canSelfInvoice: boolean,       // contractor true, employee false
    canClaimExpenses: boolean,     // both true
    requiresInsurance: boolean,    // contractor true, employee false
    hasCrewCount: boolean,         // contractor true, employee false
    multiAssignable: boolean,      // employee true, contractor false (v1)
    clocksOn: boolean,             // employee true, contractor false
  }
```

No component, RPC or policy may check `employment_type` directly. They call the capability function. If a session finds it needs a check the function can't express, it stops and reports rather than branching inline.

**Capability matrix (the artefact every session tests against)**

| Capability | Contractor (as shipped) | Employee (this brief) |
|---|---|---|
| Job arrives as | Offer: accept / decline / propose, 24h SLA | Assignment: in calendar immediately; one-tap **Accept** timestamps "seen"; no decline, no clock |
| Sees price | Fixed offer (hours × $60) | Never. Allocated days and hours only, no rate |
| Customer confirmation | After contractor accepts | On assignment (same transaction) — see open item ⚑A |
| Painters per job | One (states crew count) | Many, each with own dates; exactly one **lead painter** |
| Customer sees | The contractor | The **lead painter only** |
| Work order | Same | Same |
| Ticks / photos / daily updates | Same | Same; every assigned painter can tick |
| Variations | Raise → office prices → customer approves → adjusted offer at hours × $60, one tap | Raise → office prices → customer approves → "Variation approved" + scope lines + hours, no $, no accept step |
| QA / walkthrough / sign-off | Same | Same; walkthrough prompt goes to the lead, any assigned painter can run it |
| Money tab | Self-invoice + expenses | Expenses only |
| Expense payout | Rides the contractor invoice as at-cost reimbursement lines | Reimbursement queue (company card vs personal) |
| Settings | Company details, insurance, crew count, notifications | Contact, notifications, white card + working at heights. No insurance, no crew count |
| Payables view | Contractor invoices to approve / pay | Never appears except as reimbursements |
| Unavailability | (not built) | Leave / RDO (request + approve), sick (self-marked) |
| Timesheet | No | Start day / Finish day per job |
| Help docs | `contractor` role | `employee` variant of each affected page |

### 3.2 Scheduling — assignment, acknowledgement, lead painter

**Data.** Introduce `job_assignments` (or extend the existing booking entity — Session 0 recommends which after reading the shipped schema, and reports it before Session 1 writes anything):

```
job_assignments
  id, work_order_id, painter_id,
  starts_on, ends_on,              -- per person, may differ from the job span
  is_lead boolean,                 -- exactly one true per work order (DB constraint)
  status: 'assigned' | 'accepted' | 'released',
  assigned_by, assigned_at,
  accepted_at,                     -- set by the painter's Accept tap; cleared when dates change
  released_at
```

Preferred: when a contractor accepts an offer, one `job_assignments` row is also written (`is_lead=true`, `status='accepted'`) so the calendar and the customer-facing "who's painting" read one table for both types. Session 0 confirms this is safe.

**RPC `assign_job(work_order_id, painters[{painter_id, starts_on, ends_on}], lead_painter_id)`** — SECURITY DEFINER, transactional:

1. Reject if any painter is a contractor (ruling 9).
2. Reject with a named conflict if an employee already has an overlapping assignment or an unavailability block on those dates. PC may override with a logged reason.
3. Insert assignments; `lead_painter_id` gets `is_lead=true`. Exactly one lead — the constraint refuses zero or two.
4. Transition the WO out of stage 1 exactly as contractor acceptance does today — same `wo_events` entry type, actor = PC, `acceptance_mode: 'assigned'`.
5. Fire customer confirmation in the same transaction (open item ⚑A confirms this timing).
6. Queue painter notifications: job assigned, dates, address, "open your work order and tap Accept".

**RPC `acknowledge_assignment(assignment_id)`** — called by the painter's Accept tap. Sets `accepted_at`, writes a `wo_events` entry (`assignment_acknowledged`, actor = painter). Idempotent. Nothing downstream waits on it.

**RPC `reassign_dates(assignment_id, starts_on, ends_on)`** — updates the row, clears `accepted_at`, logs the event, notifies the painter to accept again. Never creates an offer.

**RPC `set_lead_painter(work_order_id, painter_id)`** — the **Lead painter button** on the PC's job view and on the calendar card. Moves `is_lead` in one transaction, logs `lead_painter_changed`, and the customer-facing views re-read the lead on next load. Allowed at any stage before Closed. Releasing the current lead is refused until another lead is named.

**Calendar.** Employee lanes sit alongside contractor lanes. One job with three employees appears in three lanes with the same job colour, a "1 of 3" chip, and a small lead marker on the lead's lane. Dragging onto an employee lane calls `assign_job` (first employee dropped becomes lead by default, changeable with the button); dragging onto a contractor lane keeps today's booking-request flow. Unaccepted assignments show a hollow outline until Accept is tapped.

**Unavailability.** `painter_unavailability(painter_id, starts_on, ends_on, kind: 'leave'|'rdo'|'sick', requested_by, approved_by, approved_at)`. Leave/RDO need PC approval; sick is self-marked and approved implicitly. Blocks show grey-hatched on the lane. `assign_job` refuses to schedule over them without an override. A sick block landing on a scheduled day raises the Reassign attention item for that job.

### 3.3 Money visibility — a server contract, not a hidden `<div>`

Add `view=employee` to the response contract for every job, WO, variation and schedule payload.

- Every `*_cents` field, every margin, every rate, every offer amount, the estimate document, invoices and payables are **absent** from an employee payload — not zeroed, not nulled, absent. The zod schema for `view=employee` must not have those keys.
- Allocated hours and days are present as `time_budget: { days, hours }` with no rate anywhere near them.
- RLS: employees have no SELECT on `estimates`, `invoices`, `invoice_lines`, offer rows, `rate_items`, or any table holding cents. Access is only through the employee RPCs / views.
- Golden adversarial test: fetch every employee endpoint as a real employee test account and assert no key matching `/cents|price|rate|margin|amount|offer/i` exists anywhere in the JSON tree. This runs in CI and gates every session in this brief.

### 3.4 Work order — one label, nothing else

Stage 1 is called **Offer** for contractors. For employees the gate is **"ready to assign"** and the stage label reads **Assigned**. This is a label derived from `acceptance_mode` — the enum value does not change and no migration is written for it. Stage 1 PC ticks (scope-matches-estimate, finish/standards shown) still apply before assignment.

Pre-start checklist, colours-TBC chip, materials ordering, equipment movements, new-painter QA schedule: identical.

**Multi-painter mechanics**
- Ticks: every assigned painter may tick; `wo_events.actor_id` already records who. Progress is job-level.
- Before-photos rule: satisfied once, by whoever ticks first.
- Daily update draft: one per job per day, built from all painters' ticks. The customer-facing update names the lead painter only.
- Completion checklist and walkthrough booking: lead's responsibility by default; any assigned painter can complete items.
- Walkthrough Mode A: served into whichever assigned painter's session opens it — scoped, time-boxed RPC as today. Prompt goes to the lead.
- Completion report: the internal version lists every painter with their days; the customer version shows the lead.
- Releasing a painter removes future days only; their past ticks and events stay.

### 3.5 Variations — same card in, different card out

Employee raises the same structured variation card. Office prices it, customer approves it as a mini-estimate — unchanged.

Employee side after approval: a card titled **Variation approved** listing the added / changed scope lines (surface, area, what to do) and the added hours, so the work can be done. No accept step, no adjusted offer, no dollar figure. Declined variations show **Not going ahead** with the office's note. Both are `wo_events` entries, so the completion report picks them up as today. Contractor path untouched.

### 3.6 Money tab — expenses only

Reuse session 6c with the invoice half removed:
- Receipt photo required, category, amount **AUD inc. GST**, which job, who paid (company card default, or personal).
- Pre-approval required over $100 (Settings value, shared with contractors).
- Approved personal-card expenses go to the **reimbursement queue** on `/invoicing` Payables, not onto any invoice. Company-card expenses are job costs with no payout.
- Tab header is "Expenses", never "Invoices". `canSelfInvoice=false` hides every self-invoicing route and the RCTI text.

### 3.7 Settings page — drop, keep

| Field group | Contractor | Employee |
|---|---|---|
| Company details (ABN, entity, banking for RCTI) | Keep | Remove |
| Insurance (public liability, expiry, certificate) | Keep | Remove |
| Crew count + alert | Keep | Remove |
| Contact, mobile, emergency contact | Keep | Keep |
| Compliance: white card, working at heights (expiry + reminder) | as today | Keep, nothing else |
| Notification preferences | Keep | Keep |
| Quality standards / onboarding acknowledgements | Keep | Keep |

### 3.8 Timesheets and job cost (Session 6, v1)

Why: a contractor job carries its labour cost (the offer). An employee job carries none unless something records it — without this, every employee job reports inflated gross margin. And the pricing engine's calibration gate against real worked hours is still unmet; employee clock-on/off is the first clean source.

Shape: `timesheet_entries(painter_id, work_order_id, work_date, started_at, finished_at, break_minutes, source: 'painter'|'pc', approved_by, approved_at)`. Two taps in the portal (**Start day / Finish day**, defaulting to today's assigned job), PC approval alongside daily updates, approved hours × the employee's cost rate posted as one labour-cost line on the job ledger, weekly **CSV export for payroll/MYOB**. The platform never shows or calculates pay. Allocated-vs-actual per job is a read-only report; the monthly bonus view comes later (ruling 14).

`employee_cost_rates(painter_id, cents_per_hour, effective_from)` — Settings-editable, history kept. Rates never appear in any employee payload (covered by the §3.3 test).

### 3.9 Notifications and attention items

Messaging goes through the one messaging adapter. New templates: job assigned (tap Accept), dates changed (accept again), released from job, lead painter changed, variation approved (employee wording), expense approved / paid, leave approved / declined.

New attention items in `lib/invoicing/attention.ts` (shared with PC Command, one evaluator):
- Assignment not accepted with start within 24h — amber, primary action "Call painter".
- Employee sick or "can't make it" on a scheduled day — critical, primary action "Reassign".
- Leave request awaiting approval — info.
- Timesheet awaiting approval > 24h — info.

### 3.10 Admin — one tick box per painter

Settings → Painters gets an **Employee** column: a tick box on each row. Ticked = `employment_type=employee`, unticked = `contractor`. The same tick box sits on the "Add painter" form, so there is no separate add-employee screen. Self-registration (the Facebook form) still creates contractors only; the PC ticks the box afterwards if needed.

The tick box is simple on the surface and guarded underneath. It calls one RPC, `set_employment_type(painter_id, type)`, which:

- **Refuses, with a plain-English reason shown next to the box,** if the painter has anything in flight that belongs to the other type: an open offer or active booking (contractor → employee), an unpaid invoice or unpaid expense reimbursement (either way), or an active assignment (employee → contractor). Example: *"Can't change yet — Marco has an open offer on 14 Elm St. Withdraw it or wait for it to close."* Closed history is never a blocker.
- Logs the change as an event with who ticked it and when. History from the previous type (invoices, offers, insurance details) is kept read-only; nothing is deleted.
- Works in **both directions**. Un-ticking an employee makes them a contractor again, and their profile goes to "details needed" (insurance, company details) until they complete it — the existing rule that a contractor can't be offered jobs without insurance applies from that moment.
- Takes effect immediately in the portal on their next load: the capability function reads the new type, so their tab, settings and job cards switch without any other change.

Un-ticking never exposes money retrospectively: jobs completed as an employee stay under the employee view contract in history.

---

## 4. Schema summary

New: `job_assignments`, `painter_unavailability`, `timesheet_entries`, `employee_cost_rates`.
Altered: painter record + `employment_type` (default `contractor`, NOT NULL after backfill); WO acceptance event gains `acceptance_mode`.
Unchanged: WO stage enum, `wo_events` shape, `contractor_expenses` (reused), variation tables.
All DDL delivered as pasteable SQL for Tom, run between gate runs, on the test project first.

---

## 5. Clean-build rules — this is an extension, not a rewrite

Tom's instruction: **a clean build in line with the existing build, with no mess-ups.** The wizard failure (15 defects, never run end-to-end, diverged from mockups) is the cautionary tale. These rules are how we avoid repeating it.

1. **Session 0 is read-only.** Before any code, Claude Code reads the shipped scheduling, contractor portal, WO loop and expenses code and reports: the file map it will touch, the schema decision for `job_assignments`, every place money is currently rendered to painters, and any contractor test it expects to be affected (expected answer: none). Tom confirms before Session 1.
2. **Reuse, don't fork.** Employee screens are the contractor components with capability props. If a component genuinely needs a separate employee version, stop and report with the reason. No `EmployeeJobCard.tsx` next to `JobCard.tsx`.
3. **Contractor regression suite green every session.** If any existing contractor test needs changing, stop and report before changing it. Contractors in production must not notice this build happening.
4. **Feature-gated until done.** `employment_type=employee` is only reachable behind a Settings flag (`employees_enabled`, default off in production) until Session 7's full-loop e2e passes in both roles. Production contractors are never exposed to a half-built path.
5. **e2e first, as a real employee**, on the test Supabase project, before any session is called done. Not "the unit tests pass".
6. **One of everything.** One capability function, one calendar table, one attention evaluator, one messaging adapter. No module builds its own list or badge.
7. **Money server-side, always.** The adversarial money test is written in Session 1 and runs in CI from then on. A hidden element is a failure.
8. **Migrations between gate runs**, pasteable SQL for Tom, test project first, production second.
9. **Missing reference = STOP.** Ledger updated at the end of every session (`employed-painters-progress.md`).
10. **Isolated worktree**, separate port, own npm install, if any other session is running.
11. **Running alongside the CRM build.** This branch owns the painter record, `job_assignments`, the schedule/calendar view and the painter portal routes. The CRM branch owns `crm_events`, the segment evaluator, the four CRM tabs and the Airtable import. Shared files both will touch — `lib/invoicing/attention.ts`, the messaging adapter, the WO stage-1 gate — are edited additively only (new items, new templates, never restructuring); whichever branch merges second rebases onto main before its gate run. Migrations from both branches go into one ordered list that Tom applies between gate runs, never two at once. Only one CI run against the test Supabase project at a time until the teardown/sweep/row-count tripwires (C7b, C7c) are confirmed live. Session 2 of this brief (calendar) does not start until the CRM import's schedule-view piece (jobs landing in the Unscheduled folder) has merged, so the calendar is changed once, not twice.

---

## 6. Sessions (copyable Claude Code steps)

Feature branch `feat/employed-painters`. Each session: walking skeleton first, e2e in the real employee role on the test project, help file for touched screens, ledger updated.

### Session 0 — Read-only diagnostic (no code)
- Read scheduling phases A–F, contractor portal routes, WO loop v4, expenses 6b/6c, attention evaluator, messaging adapter. Produce the file map, the `job_assignments` schema recommendation, the money-render inventory, and the list of contractor tests expected to be untouched.
- **Accept:** report committed as `docs/briefs/employed-painters-session-0.md`; Tom confirms; no source files changed.

### Session 1 — Identity + capability function + money contract
- `employment_type` migration and backfill; `lib/painters/capabilities.ts`; `view=employee` zod contract; RLS revocations; `employees_enabled` flag; employee e2e account.
- **Accept:** capability function unit-tested for both types; adversarial money test green (no money-shaped key anywhere in employee JSON; every direct read of `estimates`/`invoices`/offer rows as an employee is denied at API level); contractor suite unchanged and green.

### Session 2 — Assignments, Accept, lead painter, calendar, unavailability
- `job_assignments` with the one-lead constraint, `painter_unavailability`, RPCs `assign_job` / `acknowledge_assignment` / `reassign_dates` / `set_lead_painter`, calendar lanes and drag behaviour, Lead painter button, conflict refusal with override, customer confirmation in the same transaction.
- **Accept:** three employees on one job → three lanes, one lead marker, one WO transition event, one customer confirmation; second lead refused by the DB; releasing the lead refused until another is named; Accept tap sets `accepted_at` and logs the event; date change clears it and re-notifies; overlap refused with the conflicting job named; PC override logged; contractor drag still creates a booking request (regression test); no employee action ever creates an offer.

### Session 3 — Employee portal views
- Job list + calendar + job detail from `view=employee`; Accept button (no decline, no timer); time budget display; WO screens reused unchanged; Assigned label from `acceptance_mode`; "can't make it" flag.
- **Accept:** e2e as employee — open assignment → tap Accept → WO opens → tick a surface after before-photos → daily update draft appears for PC with the employee as actor; no price string in any rendered DOM (Playwright text assertion on `$`, `AUD`, `/hr`); "can't make it" raises the Reassign item and leaves the assignment unchanged.

### Session 4 — Variations, employee side
- Approved / declined cards per §3.5; contractor adjusted-offer path proven untouched.
- **Accept:** employee raises variation → office prices → customer approves → employee sees "Variation approved" with scope lines and hours, no $; contractor e2e still shows the adjusted offer with a dollar figure; both land in `wo_events` and the completion report.

### Session 5 — Money tab (expenses only), settings, admin, customer-facing lead
- Expenses tab from 6c with self-invoicing removed; reimbursement queue routing; settings field groups per §3.7; Employee tick box in Settings → Painters and on Add painter, backed by `set_employment_type`; customer portal, daily updates and completion report show the lead painter only.
- **Accept:** employee submits a $140 inc. GST personal-card expense → pre-approval prompt → PC approves → appears in Payables reimbursements, not on any invoice, and as a job cost; self-invoicing routes 404 for employees; contractor settings unchanged; ticking the box on a contractor with an open offer is refused with the reason shown inline; ticking it on a clean contractor flips their portal to the employee view on next load and logs the event; un-ticking an employee sends their profile to "details needed" and they receive no offers until insurance is entered; changing the lead with the button changes the name the customer sees on next load.

### Session 6 — Timesheets + job cost
- `timesheet_entries`, `employee_cost_rates`, Start/Finish day, PC approval, cost posting to the job ledger, payroll CSV export, allocated-vs-actual report.
- **Accept:** a 7.6h approved entry at the employee's cost rate posts one labour-cost line on the job money view; business dashboard GP for that job moves accordingly; CSV export matches approved entries exactly; no pay or rate figure reaches the painter (money test extended to cover the new tables).

### Session 7 — Attention items, notifications, help, full-loop e2e, flag on
- Attention items per §3.9; templates through the adapter; employee help files; full loop as employee: assigned → Accept → pre-start → ticks by two painters → variation → QA → walkthrough Mode A on the lead's device → sign-off → closed → internal report lists both painters, customer report shows the lead. Then `employees_enabled` on in production.
- **Accept:** full-loop e2e green in the employee role and the contractor role in the same CI run; attention items appear and clear from model state only; every touched screen has its employee help file; flag flipped only after that run.

---

## 7. Open items (2) — the rest are ruled in §2

| # | Item | Default if Tom says nothing |
|---|---|---|
| ⚑A | **When is the customer confirmed** on an employee job — at assignment (PC has committed the job) or only after the employee taps Accept? Ruling 1 says jobs need no approval, so the default is assignment. | At assignment. Accept is visibility for the PC, never a gate. |
| ⚑B | **Lead painter change mid-job**: allowed at any stage before Closed, customer sees the new name on next load, no customer notification. | As stated. Add a customer notification only if Tom wants one. |

---

## 8. Definition of done

Both painter types complete the full WO loop in one CI run; the adversarial money test is green and covers timesheets and cost rates; an employee job shows real labour cost on its money view; the customer sees one lead painter throughout; every contractor test is unchanged; employee help files exist for calendar, job, expenses, timesheet and settings; `employees_enabled` is on in production only after Session 7's run; this brief, the Session 0 report and the ledger are committed.
