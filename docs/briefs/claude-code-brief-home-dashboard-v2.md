# Claude Code brief — Home dashboard v2: build plan + data-capture changes

**Status:** approved for build · 19 Sep 2026 · supersedes v1 (`claude-code-brief-home-dashboard.md`) — this is now the single build source.
**Visual references:** `home-dashboard-light-mockup.html` (light mode, role switcher — build to this) and `owner-dashboard-mockup.html` (revenue/margin chart only).
**Route:** `/home`, the landing page for every staff login.

---

## Part A — The plan in plain English

The dashboard is a reader. It doesn't create anything — it turns what the other modules already record into numbers, lists, a timeline and CSV exports. That means two things:

1. **Most of the work is making sure the data is being captured in the first place.** Part B lists every piece of data a tile needs, whether it exists today, and the small change to an existing module that captures it. These changes are cheap and should ship first, so data starts accumulating while the dashboard itself is built.
2. **Sections light up as their source modules land.** Nothing on the page fakes a number. A section whose module isn't live yet shows an honest "switches on when X ships" state.

**Order of work**

| Phase | What | Depends on | Why this order |
|---|---|---|---|
| 0 | Data-capture changes (Part B) — one small session per touched module | nothing | Data accrues from day one; every later session reads it |
| 1 | Reporting core + roles + `/home` shell + needs-doing strip | Phase 0 | Everything else plugs into it |
| 2 | PC Command + Contractors | WO loop (built), scheduling (built) | These sources already exist — first sections that are real |
| 3 | Sales + Where estimates go + Activity | estimate events (built), `wizard_sessions` (wizard-progress brief) | Wizard live mid-Sep; estimates already flowing |
| 4 | Invoicing | invoicing module (in build) | Reads `ledger.ts`; lights up when invoicing ships |
| 5 | P&L + Marketing | Phase 4 + cost capture + lead source from 5 Sep | Needs money and costs both landing |
| 6 | Polish, help files, full-loop e2e, performance gate | all above | Definition of done |

What "switches on" when:

- **Day one (Phase 2):** PC Command tiles, contractor scorecard, needs-doing strip, activity for job events.
- **Wizard proving window (Phase 3):** sales tiles, target tile, funnel, activity for estimate events.
- **Invoicing ships (Phase 4):** received / outstanding / overdue / contractor payables / unsent invoices / payment types.
- **After one month of cost capture (Phase 5):** materials est vs actual, gross margin actual, P&L on Settings basis, marketing by source.
- **After MYOB:** net margin and marketing spend from actuals instead of Settings — no dashboard change needed, the inputs swap.

---

## Part B — Data-capture changes to existing modules

Each row is a change to a module or brief that already exists. "Amend" means edit the named brief and its migration so the next session on that module includes it. Rows marked **now** are small enough to do in Phase 0 as one session per module; rows marked **with module** go into that module's next session.

### B1 Estimates and presentations (source: `estimates`, `estimate_events`, `presentations`)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Who sent the estimate | Not stored per estimate | `estimates.sent_by_user_id` set on the send action; backfill from `estimate_events.actor_id` | now |
| Estimate category | Presentation ticked per job type (presentations brief); not on the estimate | `estimates.presentation_id` set at send; `presentations.category_label` (default = name); `accounts.category` set from the first presentation sent when the account has none (Tom's ruling) | now |
| Sent / viewed / accepted / declined dates | Exist in `estimate_events` | Add `downloaded` event when the customer opens the print/PDF view; add `question_asked` if not already an event | now |
| Expiry | 60-day validity rule | `estimates.expires_at` written at send; the lapse job reads it (airtable-import brief already warned about the lapse window) | now |
| Correction at staff review ($) | Median correction is a proving-window exit criterion; `lib/revision/diff.ts` computes diffs | Persist `estimate_review_corrections (estimate_id, reviewed_by, delta_cents, reason)` when staff fix a wizard estimate before send | with wizard R5 |
| Lead source on the estimate | CRM brief captures it on accounts | Copy `lead_source` onto the estimate at creation (source of truth is the account; copy is for cohort reporting); staff-built estimates get a required lead-source picker; legacy rows = `not_recorded` | now |

### B2 Wizard sessions (source: `wizard_sessions`, wizard-progress brief)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Funnel steps | Buckets A/B/C/C+/D and heartbeat time-on-page | Ensure each step writes a timestamp: `started_at`, `email_captured_at`, `saved_at`, `estimate_id`; add `source` (utm/referrer → lead_source), `device`, `segment` (interior/exterior/commercial) | with wizard-progress brief |
| Self-serve vs visit | Tier decision exists (self-serve / phone / visit) | Store the tier on the estimate as `outcome_tier` so "accepted without a visit" is a filter, not a guess | with wizard R5 |

### B3 Work orders and scheduling (source: `wo_events`, `wo_surfaces`, `wo_qa_checks`, `wo_variations`, `wo_walkthroughs`, bookings)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Finished on time | `wo_surfaces.state_changed_at`; bookings have dates | Derive `all_surfaces_done_at` (write it once as a `wo_events` row when the last surface hits DONE); bookings carry `booked_end_date` and approved extensions write a `booking_extended` event | now |
| QA passed first time | `wo_qa_checks` pass/fail | Add `attempt_no` (1 for the first check on a job, increments after a fail) | now |
| Contractor silent | Events carry `actor_id` | Nothing new — `last_activity_at` is derived across `wo_events`, photos, messages, expenses. Confirm every one of those writes `actor_id`; photos currently may not | now (verify) |
| Offers past SLA / accepted within 24h | Offer accept/decline events exist (24h SLA) | Nothing new | — |
| Hours worked vs estimated | **Not captured** — the Phase-1 gate has been unmet since August for this reason | **Per-contractor opt-in (Tom's ruling 19 Sep).** `contractors.capture_worked_hours` boolean, off by default, switched on per contractor in Settings → Contractors so it can be trialled with a few painters first. When on, the contractor's final DONE tick asks for days on site and hours per day, pre-filled from the booking, stored in `wo_worked_hours (wo_id, contractor_id, days, hours, source = 'entered')` and shown as a reference line on their self-invoice. When off, nothing is asked and the dashboard uses the schedule instead (see the blended rule in Part C). | now |
| Warranty call-backs | No object | `wo_callbacks (wo_id, raised_at, reason, resolved_at)` — the "what does a touch-up request create" ⚑ from trade-portal v2 resolves here: it creates a callback | with trade portal v2 session 5 |
| Reviews requested → received | Request is sent at sign-off | `review_requests (wo_id, sent_at, received_at nullable, rating nullable)`; received is a manual tick by staff until the Google Business Profile API is connected. ⚑B2 | now |

### B4 Messaging (source: threads/messages, Resend + Twilio, messaging inventory)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Customers awaiting reply, first-reply time | Messages exist; inventory in `messaging-automations-inventory.md` | Every message row needs `direction (inbound/outbound)`, `sender_role`, `sent_at`, `read_at`; thread carries `last_inbound_at`, `last_staff_reply_at` (maintained by trigger). Automations (chases, nudges) are `outbound` with `sender_role = system` and **do not** count as a staff reply | now |
| Message read by customer | Email/SMS read tracking is partial | Record `read_at` from the portal thread view (reliable) and from email open pixels (best effort, flagged as such) | now |

### B5 Invoicing and payments (source: `invoices`, `payments`, `contractor_invoices`, `ledger.ts`)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Revenue received | `payments` with `method: stripe_card | bank_transfer` | Add `cash` to the enum (⚑B3); `received_at` is the recognition date; refunds are negative payments | with invoicing session 4 |
| Overdue and ageing | `due_date` on invoices | Nothing new; ageing derived | — |
| Unsent invoices | Deposit drafts, progress requests, finals | Nothing new; states exist in the G0–G7 model | — |
| Contractor payables | `contractor_invoices` approved/paid | Ensure `paid_at` is written on mark-paid | verify |

### B6 Costs (source: `cost_intake`, `job_costs`, `contractor_expenses`)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Materials actual per job | Intake matches to job with category | Ensure `category = materials` is distinct from `sundries`, `pass-through`, `equipment`; unmatched intake carries `job_id null` and is counted, never allocated | with invoicing 6a |
| Materials estimated per job | `wo_snapshot.materials` frozen at acceptance | Nothing new | — |

### B7 Settings and staff (new, owned by this brief)

- `staff_profiles.staff_role` enum `owner | admin | pc | sales | finance` + Settings → Team.
- `contractors.capture_worked_hours` boolean per contractor in Settings → Contractors; `worked_day_hours` Settings value (default 8).
- `sales_targets (month, target_cents, category_label nullable, salesperson_id nullable)`.
- `marketing_spend (month, channel, spend_cents, note)`.
- Settings values: silent-contractor days (3), anomaly threshold (25%), ageing bucket edges (7/30), lead-source list, payment methods shown.

### B8 CRM (source: `crm_events`, `accounts`)

| Dashboard needs | Today | Change | When |
|---|---|---|---|
| Lead source list | Captured, reported from 5 Sep | Fix the list (⚑5 in v1): Google search · Google Ads · Instagram · Facebook · Referral · Repeat customer · Real estate / trade · Word of mouth · Other · Not recorded | with CRM Phase 0 |
| Repeat customer | Account has prior signed-off job | Derived — no change | — |

**Briefs to amend as a result (edit the file, add the migration, commit same day):** presentations brief (B1), wizard-progress brief (B2), WO-loop brief v4 (B3), messaging inventory (B4), invoicing brief §3.1 (B5, B6), CRM brief Phase 0 (B8), trade-portal v2 (B3 callbacks), contractor portal polish (B3 worked hours).

---

## Part C — What the page shows (definitions, condensed)

Kind: **P** = period (changes with the date filter) · **N** = right now (state count, ignores the filter, labelled "right now").

**Needs doing strip** — rendered from the existing evaluators: invoicing `attention.ts` (owner, finance), PC Command queue (owner, PC), sales follow-ups (owner, sales), plus anomaly cards (owner: any P tile ≥ threshold off its comparison). No new list logic.

**Sales (owner, sales)** — Estimates sent P · Sales $ inc GST on acceptance date P · Sales number P · Conversion = accepted ÷ sent, cohort by month sent, "still open" shown P · AOV by `category_label` with median, "Uncategorised" row P · Target: $ and % of `sales_targets` with a pace marker and 12-month chart · By salesperson (`sent_by_user_id`), sales role defaults to "mine".

**Where estimates go (owner, sales)** — wizard started → email captured → saved → sent → viewed → accepted from `wizard_sessions` + `estimate_events`; drop-off labels; self-serve accepted (`outcome_tier`); median sent→accepted; filter by lead source.

**PC Command (owner, PC)** — all N, all click through to console lists: jobs to schedule (accepted, no accepted booking, incl. imported Unscheduled) · in progress (wrapping-up sub-count) · quality check (stage `qa` + checks due/overdue) · variations open (to price / with customer) · customers awaiting reply (`last_inbound_at > last_staff_reply_at`) · awaiting sign-off (stage `walkthrough`) · offers past SLA · starting this week (colours TBC flagged). Card: materials est vs actual on signed-off jobs (from `wo_snapshot.materials` vs `cost_intake` materials), booked work ahead ($ and weeks).

**Contractors (owner, PC)** — finished on time (`all_surfaces_done_at ≤ booked_end_date` incl. extensions) P · silent 3+ days (active job, no `actor_id` event) N · QA passed first time (`attempt_no = 1` passes) P · offers accepted within 24h P · variations per job P · expense claims awaiting approval N · **days and hours** (blended, see below) P.

**Blended rule for hours and days (Tom's ruling 19 Sep).** Every job gets a time figure from one of two sources, and the source is always stored and shown:

- `entered` — the contractor is opted in and typed days and hours at the final DONE tick.
- `schedule` — the contractor is not opted in (or skipped the question), so days = booked days between start and `booked_end_date` (plus approved extensions) and hours = days × standard day length (Settings, default 8), capped at the estimate's hours if the job finished early.

One function, `lib/reporting/workedTime(wo)`, returns `{ days, hours, source }` and everything reads it. Tiles show the blend with its coverage: "Hours vs estimate +6.8% · actual on 4 of 11 jobs, schedule on 7". Drill-throughs carry a source column and a filter. Two things never happen: a tile silently averages entered and schedule figures without saying so, and the **calibration table** (estimated vs actual hours, the Phase-1 gate) uses `entered` rows only — schedule-derived hours are the estimate restated, not evidence. As more contractors are opted in, the coverage line climbs and the blend converges on actual with no dashboard change.

**Invoicing (owner, finance)** — received (customer `payments` in period) P · outstanding N · overdue with 1–7 / 8–30 / 31+ ageing N · contractor invoices to pay (+ to approve) N · received by method P · unsent invoices by stage N · average days to pay a final P · deposits unpaid inside 7 days of start N.

**P&L (owner)** — ex GST; "Settings basis until MYOB" chip. Contracts signed P · revenue received P · gross margin actual vs estimated on signed-off jobs P · net margin = GP − (fixed overhead + weekly marketing) × weeks, or `marketing_spend` rows where the month has them P · margin by size band P · margin and materials % by category P.

**Marketing (owner)** — by lead source: sent → accepted, conversion, AOV, revenue P · cost per accepted job (blended; per channel where spend is recorded) P · spend vs sales % with 12-month trend P · repeat + referral share P · wizard starts by source P.

**Activity (all staff, role-scoped)** — one timeline from `estimate_events`, `crm_events`, messages, `invoice_events`, `wo_events`; PC sees job events, sales sees estimate + message events, finance sees money + message events, owner sees all. Filters: type, person, customer. Export = filtered rows.

Every tile: an "i" reveals its definition (the string lives beside the function). Every list: Export CSV via the one server route.

---

## Part D — Build sessions (copyable)

Kickoff ritual for each: commit the reference files, confirm the list back, stop-and-report on anything missing, migrations between gate runs.

**Session 0a — Capture: estimates + presentations (B1).** Migration for `sent_by_user_id`, `presentation_id`, `expires_at`, `lead_source`, `presentations.category_label`, `accounts.category`; set them on the send action and account creation; `downloaded` event from the print view; backfills from `estimate_events`. Tests: sending an estimate writes all four fields; an account with no category gets the presentation's label on first send and is never overwritten after.

**Session 0b — Capture: messaging (B4).** `direction`, `sender_role`, `read_at` on messages; `last_inbound_at` / `last_staff_reply_at` maintained by trigger; system automations excluded from staff replies. Test: a customer message followed by an automated chase still counts as awaiting reply.

**Session 0c — Capture: work orders (B3).** `all_surfaces_done_at` event, `booked_end_date` + `booking_extended` event, `wo_qa_checks.attempt_no`, `review_requests`, verify `actor_id` on photo uploads. `contractors.capture_worked_hours` flag (Settings → Contractors, per contractor, off by default) and the `wo_worked_hours` table; the final DONE tick asks for days and hours only when the flag is on, pre-filled from the booking. Test: an opted-out contractor's tick never shows the question; an opted-in contractor's entry writes `source = 'entered'`; a job with no entry resolves to `source = 'schedule'` from the booking dates.

**Session 0d — Settings and roles (B7).** `staff_role` + Settings → Team; `sales_targets` and `marketing_spend` tables and screens; Settings values. Owner/admin only.

**Session 1 — Reporting core.** `lib/reporting/`: `PeriodMetric` and `NowMetric` types, one pure function per metric returning `{ value, compare, rows, definition }`, role check inside the function, golden tests on a seeded dataset (60 estimates, 3 categories, 2 salespeople, 20 work orders, 30 payments). `metrics_daily` rollup + nightly cron after `wo-sweep`. Export route `/api/reporting/export` streaming CSV from `rows`. `/home` shell: header (range, comparison), role-driven section list, needs-doing strip wired to the existing evaluators. E2E: four logins land on four different homes; sales calling the P&L function gets 403.

**Session 2 — PC Command + Contractors.** All N tiles from the console evaluator (extend it, never duplicate), materials est vs actual (shared with P&L), contractor metrics with per-contractor drill-through, booked-work-ahead. E2E as PC: every tile opens the right list and the count equals the list length.

**Session 3 — Sales + funnel + activity.** Sales tiles, AOV by category, target tile with pace + 12-month chart, by-salesperson, funnel from `wizard_sessions`, unified activity timeline with role scopes and filters. Golden tests on the seed; e2e as sales with the "mine / team" toggle.

**Session 4 — Invoicing.** Tiles from `ledger.ts`; `cash` method if ruled; ageing; unsent pipeline; days-to-pay. Tripwire test: home tiles equal the /invoicing dashboard pulse tiles at the same instant.

**Session 5 — P&L + Marketing.** Settings-basis P&L with basis chip and per-job est-vs-actual margin table; lead-source table; CPA, spend vs sales, repeat + referral share; anomaly cards into the strip. Owner-only gate tests.

**Session 6 — Finish.** Definitions "i" on every tile, comparison arrows, mobile pass on a real phone against the light mockup, `docs/help/dashboard-<role>.md` per role, full-loop e2e (estimate sent → viewed → accepted → booked → ticks → variation → sign-off → invoice → payment, asserting every affected tile moved by exactly the expected amount for every role), performance gate on the 25k-account seed (home < 1.5 s, 10k-row export streams).

---

## Part E — Acceptance criteria

1. Every tile equals the count or sum of its drill-through rows for the same range and role — tested per metric.
2. Tiles that overlap /invoicing and the PC console show identical values at the same instant (shared functions, tripwire tests).
3. P tiles move with the date filter; N tiles don't and say "right now".
4. Role gating is server-side; each of the five roles has an e2e asserting which sections render and that hidden functions return 403; no margin/P&L/target/marketing figure reachable by PC, sales or finance through any route, export or drill-through.
5. Every list exports through the single route; exported row count equals on-screen count.
6. Adding a presentation adds its category everywhere without code; an account with no category takes the first presentation's label and keeps it.
7. A month with no target shows "no target set", not 0%.
8. Customers-awaiting-reply ignores automated messages; an estimate view shows in Activity within 5 s.
9. Materials est vs actual is one function feeding PC and P&L; unmatched intake is counted, never allocated.
10. Silent-contractor counts only contractors with an in-progress job; threshold from Settings.
11. Money in integer cents; GST basis labelled on every tile.
12. Home < 1.5 s on the seed; no query reads full `wo_snapshot` rows.
13. A metric without a definition string fails a unit test; help file per role exists.
14. Sections whose source module is not live show an honest "switches on when X ships" state, never a zero.
15. Hours and days come from `workedTime()` only; every tile that uses them shows the entered/schedule coverage; the calibration table contains `entered` rows only; toggling a contractor's opt-in flag changes what their next tick asks and nothing retrospectively.

---

## Part F — ⚑ Decisions

Settled since v1: one page with role views · categories by presentation `category_label`, accounts auto-categorised from the first presentation sent · light mode is the build target · all Part B capture changes accepted · worked hours captured per contractor by opt-in flag, with schedule-derived figures for everyone else and the source always shown (was ⚑B1).

Still open (defaults in brackets; only 1–2 block):

- **⚑B1 Standard day length** for schedule-derived hours [8 h, Settings value] and whether an opted-in contractor may skip the question [yes — a skipped entry falls back to schedule and is flagged].
- **⚑B2 Reviews received** — manual tick by staff until Google Business Profile API [yes].
- **⚑B3 Cash payments** — add `cash` as a method, or Paint Group doesn't take cash and the row is dropped [add].
- **⚑1 Staff roles** — owner / admin / pc / sales / finance; can one person hold two [yes, union of sections]. **Blocks session 0d.**
- **⚑2 Who sees $** — only owner/admin see margins, P&L, targets, marketing; PC and sales see job values [confirm]. **Blocks session 1.**
- **⚑3 Conversion attribution** — cohort by month sent [recommend] or by month accepted.
- **⚑4 Lead-source list** — the ten in B8 [confirm].
- **⚑5 Marketing spend** — typed monthly per channel; who enters it [office].
- **⚑6 Finished-on-time clock** — all-surfaces-done vs booked end date incl. approved extensions [recommend]; alternative sign-off date.
- **⚑7 Silent threshold** — 3 calendar days or working days [calendar].
- **⚑8 Anomaly threshold** — 25% [confirm].
- **⚑9 Targets by category/salesperson in v1** — month total only, optional rows later [month total].
- **⚑10 Subscriptions line split** from the P&L reconciliation — moves the marketing figure until MYOB [needed before Phase 5 is trusted].

---

## Part G — Reference files (commit first, confirm back)

- `docs/briefs/claude-code-brief-home-dashboard-v2.md` — this file (v1 kept, marked superseded)
- `design/reference/home-dashboard-light-mockup.html` — build target
- `design/reference/owner-dashboard-mockup.html` — revenue/margin chart reference
- `docs/briefs/claude-code-brief-wo-loop-pc-command.md` (v4) — console evaluator, six stages, `wo_events`
- `docs/briefs/claude-code-brief-invoicing-payments.md` — `ledger.ts`, `attention.ts`, `payments`, `cost_intake`
- `docs/briefs/acceptance-to-paid-workflow.md` — G0–G7
- `docs/briefs/claude-code-brief-crm-retargeting.md`, `wizard-progress-crm-buckets-brief.md` — `crm_events`, `wizard_sessions`, lead source
- `docs/briefs/claude-code-brief-presentations.md` — presentations
- `docs/briefs/messaging-automations-inventory.md` — messages as built
- `docs/briefs/claude-code-brief-customer-portal.md` — identity model, 25k seed
- `docs/briefs/claude-code-brief-trade-portal-v2.md` — touch-up request → callback
- `docs/pl-vs-settings-overhead-calibration.md` — the three Settings overhead figures
- `docs/briefs/claude-code-brief-help-content-foundation.md` — help per role
- `decisions-and-rulings.md`, `CLAUDE.md`
