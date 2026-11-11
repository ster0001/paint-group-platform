# Claude Code brief — Estimates tab rebuild & funnel tracking
**paint-group-platform · brief v1 · 5 Nov 2026**
Owner: Tom Roman · Design: Claude · Build: Claude Code

> One sentence: make the Estimates tab the place where staff see every estimate, where each customer is in the funnel, where people are dropping out, and everything that has happened on an estimate — all read from one event log, with nothing stored twice.

---

## 0. Read first, confirm the file list back, then code

Kickoff ritual (standing rule): commit these files, confirm the list back before writing a line.

| File | Why |
|---|---|
| `docs/briefs/customer-funnel-map-and-automation-plan.md` (v3) | **Master.** Stage list, events, rulings R1–R16, views. This brief implements §2, §3 and §5 of it. |
| `design/reference/estimates-tab-and-automations-mockup.html` | Approved phone mockup 5 Nov. Build matches it. |
| `docs/briefs/claude-code-brief-crm-retargeting.md` rev 2 | `crm_events` shape, derived-stage principle, segment evaluator contract. Reuse, don't fork. |
| `docs/briefs/wizard-progress-crm-buckets-brief.md` | `wizard_sessions`, heartbeat, buckets A/B/C/C+/D, "Online now" label ruling. |
| `docs/briefs/claude-code-brief-home-dashboard-v2.md` | Phase 0 columns on estimates (`sent_by`, `presentation_id`, `expires_at`, `lead_source`) and the "Where estimates go" section — the Funnel view feeds it. |
| `docs/briefs/claude-code-brief-visit-booking.md` + addendum A | `visit.*` events, zones, SLAs. |
| `docs/briefs/claude-code-brief-wizard-mobile-v5.md` + `build-plan-wizard-mobile-v5.md` | Step keys. Every v5 screen is a `step_key`. |
| `docs/briefs/messaging-automations-inventory.md` | What already sends; activity log must show those sends too. |
| `CLAUDE.md` | Stop-and-report on missing references; migrations between gate runs; e2e in real role; money server-side. |

If any file is missing: **stop and report**, do not infer.

---

## 1. Rulings (binding — do not re-litigate)

From the master plan, the ones this brief touches:

- **R2 / R14** — the current estimates list keeps working exactly as it does: same search, filters, status pills, sort, behaviour. UI additions only (brand filter, view count, came-back tag). Nothing removed or re-ordered. An e2e covering the existing list runs green before and after.
- **R11** — All estimates is the first chip and the default view.
- **R12** — view count is never collapsed; shown on rows, cards and the estimate header.
- **R13** — "dropped out then came back" is an event (`wizard.session_resumed`) with the channel that brought them back; shown as a tag, a section in Online now, a line in the activity log, and a return-rate-by-channel figure in Funnel.
- **R16** — the estimate page shows a full activity log, newest first, rendered from `crm_events` filtered to that estimate. Not a second table.
- **R3** — brand logo in the estimate header from `estimates.brand`.
- **R7** — range low/high stored on `wizard.range_shown` and on any drop-out after it; Funnel shows drop-out by price band.
- **Stage is derived, never stored.** No drag-to-stage. Temperature and snooze are separate staff-set columns.
- **One event log, one segment evaluator, one work-queue evaluator.** This module builds no list of its own.
- **"Online now"** is the only label for a live wizard session — never "In progress".
- Money in integer cents, shown as AUD inc. GST, ranges never exact.
- English (not Australian) tone in anything customer-facing; staff UI can be plain.

---

## 2. Scope

**In:** events, stage derivation, six views, estimate activity log, view counter, return tracking, Funnel report + price bands, CSV export, role visibility.
**Out (next brief):** the automation engine, the message builder, sending. This brief makes the "Last sent / Next due" fields on cards **read** from an `automation_runs` table that the next brief writes to; until then they render "—".

---

> **RULED 11 Nov 2026 (Tom), session 0 rulings E‑A…E‑R. These override §3–§6 where they differ.**
> - **E‑A** Event names keep underscores (the `crm_events` CHECK rejects dots). Reuse the existing types in `lib/crm/events.ts`; add only the missing ones (`wizard_step_completed`, `wizard_gate_submitted`, `wizard_session_resumed`, form-wizard `wizard_started`), and give `estimate_revised` a writer.
> - **E‑B** `crm_events` gains nullable `wizard_draft_id` (FK + index). Anonymous wizard events are written with no account instead of being dropped.
> - **E‑C** `wizard_sessions` = **`wizard_drafts`**. Missing fields are added there. No `estimates.wizard_session_id` (`wizard_drafts.estimate_id` is the link).
> - **E‑D** `estimates.brand` already exists as `paintgroup|painthome`. No migration, no backfill.
> - **E‑E** Temperature (`hot|warm|cold`) and snooze stay on `accounts`, via `crm_set_temperature` / `crm_snooze`.
> - **E‑F** Expiry is `valid_until`. `sent_by` is `sent_by_user_id`.
> - **E‑G** Estimate stage is a new pure module `lib/crm/estimateStage.ts`, using the account vocabulary in `lib/crm/stage.ts` where meanings match. `stageFor` stays the account stage.
> - **E‑H** Work-queue items are new kinds in `lib/crm/work-queue.ts`, ranked by its existing ranking. No `workQueue.ts`, no `value × age`.
> - **E‑I** The six chips sit above the list; **All estimates** keeps today's nine tabs inside it.
> - **E‑J** Pipeline, Online now and Work queue share the existing card, bucket and queue code.
> - **E‑K** Estimate detail additions go on `/quote?id=`; no `/estimates/[id]`.
> - **E‑L** Activity moves to `crm_events` (R16), after a comparison on real estimates shows nothing currently displayed is lost.
> - **E‑M** Funnel extends `lib/reporting/metrics/funnel.ts` (the home card's module); no `lib/reports/`.
> - **E‑N** Pipeline and Funnel are hidden from PCs through the `staff_access` screen map. This is a screen gate, not a database wall; real roles are a separate piece of work.
> - **E‑O** Every PR opens with its failing anonymous-customer spec (CLAUDE.md testing law), not only session 7.
> - **E‑P** Help is `docs/help/estimates-tab/<role>.md`.
> - **E‑Q** The regression spec tests the sort that exists: fixed newest-first.
> - **E‑R** v2 of the master plan plus the two briefs is the full set; R11–R16 are as the briefs quote them.
>
> **Session 1 becomes:** catalogue additions; `crm_events.wizard_draft_id`; anonymous events kept; step-completed / gate-submitted / resumed events from both wizard vocabularies (with a step-key map); `estimate_revised` writer; view-count fix (one view per visit, not per mount; `view_count` derived from `estimate_views`, never a separate counter). **Session 2:** `lib/crm/estimateStage.ts` + golden tests, new work-queue kinds, funnel extension.

## 3. Data

### 3.1 `crm_events` — new event types (append-only; existing shape from the CRM brief)

| `type` | Fired by | Payload (jsonb) |
|---|---|---|
| `wizard.session_started` | wizard, address accepted | `session_id, brand, job_type, device, lead_source{utm_*, referrer}` |
| `wizard.step_viewed` | every screen | `session_id, step_key, step_index, device` |
| `wizard.step_completed` | screen advanced | `session_id, step_key, time_on_step_ms, back_count, answer_summary` (no PII) |
| `wizard.help_requested` | Contact button / help | `session_id, step_key, message?` |
| `wizard.message_sent` | "Send us a message" | `session_id, thread_id` |
| `wizard.gate_submitted` | details entered | `session_id, consent_marketing bool` |
| `wizard.range_shown` | range screen | `session_id, range_low_cents, range_high_cents, view_no` |
| `wizard.tighten_started` / `wizard.tighten_completed` | | `session_id, rooms_total`; completed adds `range_low_cents, range_high_cents` |
| `wizard.session_idle` | sweep | `session_id, last_step_key, idle_minutes, range_low_cents?, range_high_cents?` |
| `wizard.session_resumed` | any return after idle | `session_id, via: cookie\|magic_link\|sms_link\|chat_link\|direct, previous_last_step, idle_minutes, automation_key?` |
| `visit.requested` / `visit.booked` / `visit.completed` / `visit.cancelled` / `visit.no_show` | visit booking | `visit_id, zone, slot_at, estimator_id` |
| `call.requested` / `call.completed` | range screen / staff log | `phone_closable bool`; completed adds `outcome, reason?` |
| `estimate.sent` / `estimate.viewed` / `estimate.question` / `estimate.revised` / `estimate.accepted` / `estimate.declined` / `estimate.expired` | estimate view, token link, sweep | `estimate_id, version, view_no` on viewed; `reason` on declined |
| `staff.action` | staff UI | `action: call_logged\|note\|temperature_set\|snoozed\|visit_booked\|revision_sent, detail` |

Every event carries `account_id?`, `estimate_id?`, `wizard_session_id?`, `brand`, `actor` (`customer\|staff:<id>\|system`), `occurred_at`. One of `estimate_id` / `wizard_session_id` is always present so the activity log can filter.

**Link rule:** when a wizard session becomes an estimate (gate submitted → estimate row created/attached), write `estimates.wizard_session_id`. The activity log for an estimate = events where `estimate_id = X OR wizard_session_id = estimates.wizard_session_id`.

### 3.2 Columns

- `estimates.brand` enum `paint_group|paint_home` NOT NULL (backfill: all existing = `paint_group`; new rows from the host domain).
- `estimates.view_count int` — denormalised counter, incremented by the same RPC that writes `estimate.viewed`. Source of truth remains the events; the column is for list sorting only. Golden test: column == count(events).
- `estimates.resume_count int` — same pattern from `wizard.session_resumed`.
- `estimates.temperature enum hot|warm|cool|null`, `estimates.snoozed_until timestamptz` — staff-set, never derived.
- `wizard_sessions.last_step_key`, `last_seen_at`, `resume_count` — already partly in the buckets brief; align.

### 3.3 Stage derivation — `lib/crm/stage.ts`

Pure function `deriveStage(events: CrmEvent[], now: Date): Stage` returning one of:

`online_now | dropped_anon | details_captured | range_no_action | needs_help | tightening | tightened_no_action | visit_requested | visit_booked | call_requested | visit_done | estimate_sent | estimate_viewed | question_asked | revised | declined | expired | accepted | booked | in_progress | signed_off | paid | cold`

Rules = §2 tables of the master plan. Idle thresholds: 45 min before details, 30 min after range (Settings values `crm.idle_minutes_anon`, `crm.idle_minutes_lead`). `cold` = 90 days no event after a terminal-ish stage.

**Golden tests:** one test per row of the master plan's stage tables (≈30), plus: returning after idle moves `dropped_anon` → the step's stage; a staff reply clears `needs_help`; `estimate.revised` resets the viewed clock; snooze does not change stage.

The segment evaluator from the CRM brief calls this function; it does not re-implement it.

### 3.4 Work-queue evaluator — `lib/crm/workQueue.ts`

Pure function over (stage, age, value, open staff tasks, SLA settings) → ranked items. Ranking = `value_cents × age_hours` with SLA breaches pinned to the top. Settings: `crm.reply_sla_working_minutes = 120`, `crm.visit_to_estimate_days = 2`, `crm.visit_request_reply_working_days = 1`, working hours `Mon–Fri 08:00–17:00`, public holidays (VIC) = out of hours ⚑2.

Staff tasks created by automations (L8, E3, E6) arrive via `automation_runs` in the next brief; the evaluator reads them if present.

---

## 4. Screens (match the mockup)

Route `/estimates` with chips in this order: **All estimates · Pipeline · Online now · Work queue · Funnel · Campaigns › Automations**. Default = All estimates. Chip order and default are not configurable.

### 4.1 All estimates (existing page)
- Existing component kept. Additions only: brand filter chip, `viewed N×` on each row, green `came back ×N` tag when `resume_count > 0`, brand dot colour.
- **Regression guard:** `e2e/estimates-list.spec.ts` written against the *current* page first (search, each status pill, sort, open estimate), green before any change, green after.

### 4.2 Pipeline
- Horizontal lanes, one per stage from `range_no_action` → `revised` (B2–C5). Lane header: count and total value.
- Card: name, address, brand badge, job type, range or price, stage age, `viewed N×`, `came back` tag, temperature (left border), last/next automation (from `automation_runs`, "—" until built), snooze.
- No drag. Tap → estimate detail. Long-press/menu: set temperature, snooze (1/3/7 days, custom).
- Mobile: lanes snap-scroll; desktop: lanes side by side.

### 4.3 Online now & dropped
Sections in order: Online now (live heartbeat < 5 min) · Needs help · **Came back after dropping out** · Priced, no request · Dropped (no details, anonymous — suburb + last step only, today).
Each row: name or suburb, job type, `last_step_key` label, time on step / idle, brand badge, return channel where relevant.

### 4.4 Work queue
From the evaluator. Card = title, why (SLA / task key), one primary action, one secondary. Out-of-hours banner reads from Settings working hours and shows "call-back and help requests are texting Robyn and Tom until 08:00" when the staff-alert adapter (next brief) is in after-hours mode — until then the banner reads the Settings only.

### 4.5 Funnel
Filters: date range, brand, device, job type, lead source. Three KPI tiles (started / gave details / accepted).
Chart 1 **Where they stop**: per `step_key` in wizard order — views, completions, % to next, median time, back-taps; worst three amber. Tap → device split.
Chart 2 **Drop-out by price band**: bands `$2–4k, 4–6k, 6–9k, 9–12k, 12–18k, 18k+` (Settings-editable) — sessions that saw the range vs took an action; lowest band clay.
Chart 3 **Came back**: resumes by `via` channel and by `automation_key`, with what they did next.
CSV export on each chart (standing rule: list data exportable).
One query module `lib/reports/funnel.ts` — the home dashboard "Where estimates go" section imports it; no second query.

### 4.6 Estimate detail additions
- Header: brand logo (SVG per brand), `#id`, source (wizard / staff), `viewed N×`, `came back ×N`.
- Stage strip: ordered stages with the current one highlighted and its age.
- Conversation: existing thread component (the one shared portal timeline) — all messages, automated and manual, each with channel, brand, sent/opened times. Read-only here until the next brief; the Reply button posts a manual chat message via the existing thread RPC.
- **Activity** (R16): newest first, every event from §3.1 for this estimate + its wizard session, rendered with a label map (`lib/crm/eventLabels.ts`). Collapsed to 10 with "show all". Filter chips: All · Messages · Wizard · Staff.
- Wizard path: collapsed single line of step → time, slow steps bold.
- Footer actions: Reply · Book visit · Build estimate (existing).

### 4.7 Campaigns › Automations chip
Links to the existing CRM Campaigns tab, Automations sub-tab (next brief). Until then the chip opens Campaigns.

---

## 5. Roles

Owner, admin, sales see all six. PC sees All estimates and Work queue (their items only). Finance sees All estimates. Contractors and customers: nothing here. Enforced by the existing `staff_role` from the dashboard brief, RLS on the read RPCs, explicit `view=` param — never role-inferred.

---

## 6. Sessions (walking skeleton first)

| # | Session | Done when |
|---|---|---|
| 0 | **Read-only diagnostic.** What events exist today in `crm_events`, what `wizard_sessions` holds, what the current list page does (document its behaviour for the regression e2e), what the thread component exposes. Report, no code. | Report committed to `docs/briefs/estimates-tab-session-0.md` |
| 1 | Migration: `estimates.brand/view_count/resume_count/temperature/snoozed_until`, `wizard_session_id`; event types; RPCs that write events + counters; wizard fires `step_viewed/completed/range_shown/idle/resumed`; estimate view fires `viewed` with `view_no`. | Events visible in prod for a real wizard run; counter == events test green |
| 2 | `lib/crm/stage.ts` + golden tests; `lib/crm/workQueue.ts` + tests; `lib/reports/funnel.ts` + tests on seeded events. | All tests green; one estimate's stage shown in a dev route |
| 3 | `/estimates` shell with chips; **All estimates** regression e2e green; additions (brand filter, view count, came-back). | e2e green before/after; Tom checks list on phone |
| 4 | Pipeline + Online now + Work queue views. | Phone check against mockup |
| 5 | Funnel view (three charts, bands from Settings, CSV). Home dashboard section wired to the same module. | Numbers match a hand count on seeded data |
| 6 | Estimate detail: brand header, stage strip, activity log, wizard path, role views. | Activity log shows every event type from §3.1 for a seeded estimate |
| 7 | Full-loop e2e as anonymous customer → wizard → drop → return via link → gate → range → staff view; ledger + help file. | e2e green; `estimator-v2-progress.md` updated; `docs/help/estimates-tab.md` written |

Each session ends with the ledger updated and a one-line note in this file's "Status" section.

---

## 7. Acceptance criteria

- [ ] Existing estimates list behaves identically (regression e2e) with the three additions.
- [ ] All estimates is the default view; chip order as specified.
- [ ] A real anonymous wizard run produces `session_started`, a `step_viewed/completed` per screen with correct `step_key`, `range_shown` with cents, and `session_idle` after the threshold.
- [ ] Returning via a magic/SMS/chat link after idle writes `session_resumed` with the right `via`, increments `resume_count`, shows "came back" on the row/card/header and in Online now.
- [ ] `estimates.view_count` equals the count of `estimate.viewed` events for every estimate (test + nightly tripwire).
- [ ] `deriveStage` passes every golden test; no stage value is stored anywhere.
- [ ] Pipeline lanes sum to the Pipeline chip count; no drag handles exist.
- [ ] Funnel step chart: views ≥ completions for every step; bands editable in Settings; CSV downloads; the dashboard "Where estimates go" section shows the same numbers.
- [ ] Estimate activity log lists every event for that estimate and its wizard session, newest first, with human labels; nothing from another estimate leaks (RLS test).
- [ ] Brand logo in the header matches `estimates.brand`; a Paint Home estimate never shows Paint Group marks.
- [ ] Roles: PC cannot open Pipeline or Funnel (API-level test, not just hidden nav).
- [ ] No module introduced its own list/badge/queue — grep for new count queries outside `lib/crm` and `lib/reports` returns none.
- [ ] Typecheck, lint, unit, e2e green; migrations applied between gate runs only.

---

## 8. Decisions for Tom ⚑

| ⚑ | Decision | Default if unanswered |
|---|---|---|
| 1 | Idle thresholds: 45 min anonymous / 30 min after range — keep? | Keep, Settings-editable |
| 2 | Working hours + VIC public holidays for SLA clocks | Mon–Fri 08:00–17:00, holidays out of hours |
| 3 | Price bands for the Funnel | $2–4k / 4–6k / 6–9k / 9–12k / 12–18k / 18k+ |
| 4 | Which roles see margins on Pipeline cards (cards show price/range only by default) | Owner + admin |
| 5 | Snooze options | 1 / 3 / 7 days / custom |

---

## 9. Status
_(updated at the end of every session)_

- 5 Nov 2026 — brief written; awaiting session 0.
- 6 Nov 2026 — session 0 done: `docs/briefs/estimates-tab-session-0.md`. Session 1 waits on rulings E-A to E-R; master supplied is v2, not v3.
- 11 Nov 2026 — all session 0 rulings E‑A…E‑R ruled by Tom as proposed (block above §3). Session 1 rescoped.
- 11 Nov 2026 — session 1 merged (#448, 20270310 live). Session 2 built: `lib/crm/estimateStage.ts` + golden tests, `estimate_after_visit` work item, funnel step/price-band counts, dev route `/estimates/stage/[id]`.
- 11 Nov 2026 — session 2 merged (#449). Session 3 built: the six-chip shell (`?view=`), `Viewed N×` and `Came back ×N` on every row, `e2e/estimates-list.spec.ts` regression guard. Pipeline / Online now / Work queue / Funnel are placeholders until sessions 4–5; the PC screen gate (E‑N) lands with the views it hides.
- 11 Nov 2026 — session 3 merged (#451). Session 4 built: Pipeline (lanes B2 → C5 by derived stage, temperature/snooze menu, no drag), Online now (five sections), Work queue (the one queue cut to estimates, out-of-hours line), E‑N view gate in the staff access map. Funnel = session 5.
- 11 Nov 2026 — session 4 merged (#452). Session 5 built: Funnel view (three tiles = the home card's steps, where they stop + device split, price bands from Settings `funnel_price_bands`, came back), three CSVs through the export route with the filters; hand count pinned in `funnelView.test.ts`. Not recorded yet: back-taps, return channel / automation key.
