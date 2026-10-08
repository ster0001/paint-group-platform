# Finish standards, painter status, call backs — Step 0 report (map the ground, no code)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** `docs/briefs/claude-code-brief-standards-status-callbacks.md`

No application code was written. This report answers §10 Step 0 of the brief. Every path is relative to the repo root and was read in this session. Where the brief and the code disagree, the code is described and the difference is listed in §11.

---

## 1. Reference files (kickoff ritual)

Committed in `d0f4494`:

| File | Path | Check |
|---|---|---|
| The brief | `docs/briefs/claude-code-brief-standards-status-callbacks.md` | byte-identical to the Downloads copy |
| Approved mockup | `design/reference/contractor-status-standards-mockup.html` | 842 lines, single JS-rendered file, light + dark |
| Standards v1 | `docs/standards/finish-standards-v1.json` | **17 surfaces (7 interior, 10 exterior), 53 checks, 159 level rows** — matches the brief's acceptance counts exactly |

Required reading, all present at the paths the brief gives:

`CLAUDE.md` · `docs/ARCHITECTURE.md` · `docs/briefs/claude-code-brief-wo-loop-pc-command.md` · `docs/briefs/work-order-completion-workflow.md` · `design/reference/pc-command-mockup.html` · `docs/briefs/claude-code-brief-employed-painters.md` · `docs/briefs/messaging-automations-inventory.md` · `docs/briefs/claude-code-brief-invoicing-payments.md` · `docs/briefs/acceptance-to-paid-workflow.md` · `docs/briefs/claude-code-brief-home-dashboard-v2.md`

Nothing is missing. The STOP rule for missing files is not triggered.

---

## 2. Contractor portal: routes, layout, navigation, theme, tokens (Step 0 item 1)

**The painter portal is `/portal` (`app/portal/**`).** A painter of either kind is a `contractors` row. Contractor vs employee is decided only through `painterCapabilities()` in `lib/painters/capabilities.ts` (reads `contractors.employment_type`, migration 20270153).

| Route | File | Shows |
|---|---|---|
| `/portal` | `app/portal/page.tsx` | Home: Ready-for-work card, action items, variations waiting, QA "put right", live offers, Your work, Your details |
| `/portal/requests` | `app/portal/requests/page.tsx` | Offers (contractors only) |
| `/portal/jobs`, `/portal/jobs/[id]` | `app/portal/jobs/[id]/page.tsx` (699 lines) | The painter's work order screen (§5 below) |
| `/portal/money`, `/portal/money/[id]` | `app/portal/money/**` | Invoicing (contractor) / Expenses (employee) |
| `/portal/calendar` | `app/portal/calendar/page.tsx` | Booked work, days off, Google sync |
| `/portal/help`, `/portal/help/[feature]` | `app/portal/help/**` | **Existing Help centre**, markdown guides from `docs/help/<feature>/<role>.md` via `lib/help/content.ts` |
| `/portal/profile` | `app/portal/profile/ProfileForm.tsx` | Not a tab; reached from the header name. Holds "Insurance & licences" (`contractor_documents`) |
| `/join/[token]` | `app/join/[token]/**` | Invite sign-up: name, password, mobile. No onboarding steps framework |
| `/w/[token]`, `/crew/[token]` | | Token-only read-only sheet; anonymous crew link |

- **Shell:** `app/portal/layout.tsx` (server) renders `.pt[data-theme]` → header (logo, `ThemeToggle`, name link) → page → `PortalTabs` → `PortalTour`.
- **Bottom tab bar:** `app/portal/PortalTabs.tsx`, `TABS` at lines 17–30, capability-filtered. Contractor sees six tabs (Home, Requests, Jobs, Invoicing, Calendar, Help); employee sees five. Active tab = `usePathname().startsWith(href)`.
- **Theme switch:** cookie `crm_theme` (`lib/theme/cookie.ts:9`, shared with CRM, PC, invoicing), read server-side in `layout.tsx:40`, applied as `data-theme` on `.pt`; toggle is `app/components/ThemeToggle.tsx`. `/join` and `/w/[token]` render dark only.
- **Token files:** `app/portal/portal.css` (dark on `.pt` lines 6–21, light on `.pt[data-theme="light"]` lines 621–640); `app/w/workorder.css` has its own `.wo` tokens with light overrides from line 190. Existing semantic tokens: `--amber`, `--emerald`, `--clay`, `--cyan`, `--paint`; chip classes `.chip.amb/.grn/.cly/.cyn/.gry`. Current usage already matches the brief (amber = waiting, clay = overdue/rectify). **No red, orange, yellow or blue lamp tokens exist**; they go in both theme blocks of `portal.css` and in `workorder.css`.
- **Per-surface standard today:** `FinishChip` (`app/components/FinishChip.tsx`) opens a bottom sheet with the PG-2/3/4 text from `FINISH_LEVELS` in `lib/workorder/finish.ts`. This is the nearest existing pattern to "What we expect" and the text it shows will be superseded by the standards tables.

## 3. Quality checks, walk-through, sign-off, scheduler tick box, PC Command (item 2)

### Quality checks
- **`wo_qa_checks` exists** (`20260927000000_wo_loop_tables.sql:144`): `kind` (`final` | `mid`; `day_one`/`spot` are dead), `result` pass/fail/null, `checked_at`, `retry_of` (20270196; a FAIL auto-creates the re-check row), **`attempt_no` (20270178, trigger-maintained)**, `photo_count`, `thin_record`. **No `trigger`/reason, no `fixed_same_day`.** Waiver is job-level: `work_orders.qa_waived`.
- Items: `wo_qa_items` seeds four fixed generic lines on every check (Cut lines, Coverage, Prep evidence, Site — `20261015000000_wo_qa_items.sql:53–56`). **Not per surface; nothing links an item to a `wo_surfaces` row.**
- RPCs: `wo_record_qa` (latest `20270196…:51`; writes events `qa_pass`/`qa_fail`), `wo_qa_route_passed` (`20270220…:229`), `wo_add_qa_check` (= the real "spot check", kind `mid`), `wo_set_qa_required`, `wo_set_qa_waived`.
- **Scheduling:** `wo_schedule_qa` (`20270197…:33`) → `contractors.qa_mode` (`first_jobs | every_job | none`, 20270171) + `wo_contractor_is_new()` (fewer than `settings.wo_loop.qaCadence.newContractorJobs` = 3 closed jobs). Called as a self-heal from the PC job page, the sweep, and several finish RPCs. `qaCadence.establishedContractors` is seeded but **never read**.
- **PC QA screen:** `app/pc/wo/[id]/QaCheck.tsx` (ticklist, PASS/FAIL, Where/What rectification fields, fail photos), `QaControls.tsx`; actions in `app/pc/actions.ts`.

### Walk-through and sign-off
- **`wo_walkthroughs`** (`20261028…:35`) is a booking record only: `kind pre|final`, `scheduled_date/time`, `status booked|done|missed|cancelled`. **No outcome column.**
- **`wo_signoff`** (one row per WO): `signed_at` (**= sign-off time**), `signed_kind` enum `wo_signoff_kind` = `in_person | remote | deemed | on_device | no_walkthrough | rectified`, `areas jsonb` with per-area `approved_at / flagged_at / flag_withdrawn_at / rectified_at`, `signature`, `customer_token`, `report`.
- The closest thing to the brief's `outcome`: `signed_kind = 'rectified'` ≈ "passed after a fix"; `'no_walkthrough'` = walk-through not required; the rest = clean pass. A failed walk-through is not a record, it is an `area_flagged` event that sends the job back to `in_progress` (`wo_walkthrough_area`, latest `20270164…:34`). "Flag withdrawn" moves `in_progress → walkthrough`. `wo_complete_after_rectification` (painter side only; no PC button) signs as `rectified`.
- **"Walk-through not required"** is `work_orders.walkthrough_required boolean` (20261110), set by `wo_set_walkthrough_required`; closing uses `wo_close_without_walkthrough`. Nothing is stored on bookings.

### Stages and Flow
- Enum `wo_stage` has **seven** values: `offered, pre_start, in_progress, qa, completion_prep, walkthrough, closed` (`20260926…:27`). `closed` exists under that name. Only `wo_set_stage` writes a stage.
- Flow board `app/pc/flow/page.tsx` ("Project Progress") shows seven lanes from `lib/workorder/stages.ts` `LANES`: 01 Offer, 02 Booking confirmed, 03 Pre-start, 04 In progress (completion_prep folded in), 05 Quality check, 06 Walkthrough, 07 Closed. A Call backs column would be an eighth, non-stage column.

### Scheduler tick box
- `app/pc/schedule/ScheduleBoard.tsx:1637–1641`: **"Walkthrough not required — closes straight after the job (and any quality check)"** (`data-testid="offer-no-walkthrough"`), in the tray-drop confirm sheet next to "Quality check required on this job" (line 1634). **There is no painter-picker component**: staff drag a job onto a painter's row; the only `<select>` is "add a painter" in the block detail sheet (lines 1793–1799). Bookings link via `booking_offers.work_order_id` / `wo_assignments.work_order_id`. Pink holds = `schedule_holds` (20270209); extra visits = `wo_appointments`.

### PC Command
- Routes: `/pc` (Dashboard = Command), `/pc/schedule`, `/pc/flow`, `/pc/updates`, `/pc/timesheets`, `/pc/wo/[id]` (+ `/as-contractor`). Nav: `app/pc/PcNav.tsx`. **No Contractors section exists.**
- **Two queue mechanisms on `/pc`** (see §10 cleanup):
  1. "Needs you now" cards: `buildQueue()` in `lib/workorder/console.ts:162`, inline blocks per card kind (offer-sla, unbooked, reschedule, quiet-site, variation-*, colours, extension, signoff-clock, qa-due, update-due, warranty-issue, contact, collect…), severity `critical|warning|info`, dismissed via `wo_dismiss_card` → `wo_events card_dismissed`. No registry.
  2. The registry `lib/crm/work-queue.ts`: `WORK_ITEM_KINDS`, `homeOf(kind)` returns `pc` for `job_checkin`, `job_followup`; `buildPcWorkItems` (line 1789); dismissals in `work_item_dismissals`. CLAUDE.md's standing rule names this one as the single source.
- **Per-job page** (the brief's "property/job page"): `app/pc/wo/[id]/page.tsx` (905 lines): stage rail, money strip, blocker banner, scope/ticks, Next-step card (`StageAdvance.tsx`), Colour/Reference/FinishLevel/Materials/Crew cards, checklists, `WalkthroughCard.tsx`, QA cards, variations, updates, photos, Job facts.

## 4. Reminder automation (item 3)

- **One planner:** `lib/workorder/jobRhythm.ts` (`jobDays`, `dayAt`, `painterUpdateRungs`). Used by the painter texts (`lib/automations/sweeps/jobReminders.ts`) and the office check-ins (`lib/crm/work-queue.ts`).
- **The §4.2 schedule matches the code** for 1, 2, 3–6 and 7+ day jobs (07:30 / 15:30 Melbourne). The brief's STOP rule is not triggered. Nuances: days are **booked working days** (weekends excluded unless `works_saturday/sunday`; public holidays not excluded); half way rounds up (4-day job → day 3); rung ids are `day1, day1_pm, day2, mid, mid30, mid60, last` (not `p30/p60`). Pinned by `jobRhythm.test.ts`.
- **How sends are recorded:** `automation_claims (automation_key, entity_id = WO id, rung, claimed_at)` (20270150) — one claim per job per rung, written **before** the send; plus one `messages` row per text (`lib/messaging/record.ts`). **No per-moment record** (no due_at, sends_count, answered_at, skip reason). A `nobody` (no mobile) or failed send still consumes the claim with no record of why.
- **Engine quirk:** `lib/automations/reminders.ts:63–67` sends only the latest due rung per job per sweep and silently claims earlier ones. Follow-up texts added as rungs of the same ladder would suppress each other; they need their own key or an extended engine.
- **What counts as an update today:** nothing is tied to the reminders. Painter actions all write `wo_events`: `surface_tick` (`wo_tick_surface`, **only while `in_progress`**, first tick needs a before photo), `photo` (`wo_record_photo`, any stage), `checklist_ticked`, `note`. No progress-% field. At the day-1 07:30 moment a job is usually still `pre_start` until the painter presses Start (or the 6 pm autostart sweep).
- **Cron:** `vercel.json` (syd1). Reminders run inside `campaign-sweep` (`*/30`), with `wo-sweep` at 6 pm Melbourne, `crm-sweep`, `wizard-sweep`, `gcal-sweep`, `agent-sweep`, `trade-digest`, `metrics-daily`. All require `Authorization: Bearer $CRON_SECRET`. Quiet hours: weekdays 8–19, Sat 9–17, Sun none; daily cap 3; this automation is `quietExempt`/`capExempt`.
- **No work today / pause:** nothing exists. **Reschedule:** the ladder is recomputed from `start_date/end_date` on each sweep so future moments move implicitly, but claims keyed by rung id are never reset.
- **Messaging registry:** `lib/automations/registry.ts` (65 entries; `Automation` type lines 48–85; placeholders `P`), wording in `lib/messaging/config.ts` (`MessagingSettings`, `DEFAULT_MESSAGING`, `TemplateVars`), samples in `lib/automations/controls.ts` (`SAMPLE_VARS`), Settings UI `app/(app)/settings/AutomationsSettings.tsx` (channel picker only where the entry lists both channels). Adding an automation = registry entry + settings field + default + placeholders + `sendAutomation`. `registry.test.ts` enforces defaults and samples. Staff alerts: `lib/staff/notifyEvents.ts` keys + `lib/staff/notify.ts`.
- **Painter mobile:** `contractors.phone`; `contactFor()` in `lib/contractor/notify.ts:27`.

## 5. Lead painter and employed painters (item 4)

- `contractors.employment_type` (`contractor | employee`), writable only by `set_employment_type` RPC. SQL helper `is_employee()`. Feature switch `settings.employees_enabled`.
- **Lead painter = `wo_assignments.is_lead`** (20270154; unique one lead per WO among non-released rows). `set_lead_painter` also sets **`work_orders.contractor_id`**, so for both kinds "who did the job" = `work_orders.contractor_id` (for contractors it equals `booking_offers.contractor_id` where `state='accepted'`; **note it is written at offer time by `send_offer`, nulled on decline**).
- Payroll CSV: `app/pc/timesheets/export/route.ts` (painter, job, date, start, finish, break, hours). **No bonus column.**
- Staff roles: `profiles.staff_roles staff_role[]` (`owner, admin, pc, sales, finance`, 20270179) with `has_dashboard_role()`, `dashboard_sees_money()`; plus the older `profiles.is_owner` / `is_owner()` (20270106). **No SQL `is_pc()`.** The `settings` table is writable by any staff (`settings_staff_all`), so owner-only values need RPC or RLS gating.

## 6. Existing tables for call backs, status, standards (item 5)

**None exist**: no `wo_callbacks`, `painter_status`, `painter_job_results`, `painter_bonuses`, `standards_*`, no acknowledgement table, nothing bonus-related. Home dashboard v2 Phase 0 was built (20270175–20270179) **without** `wo_callbacks`; it was deferred to "trade portal v2 session 5", which was never built. False positives: `callback_requests` (agent after-hours "call me back"), `error:standards_outstanding` (QA items).

What Phase 0 did add that this build can use: `wo_qa_checks.attempt_no`, `booking_offers.booked_end_date` + `booking_extended` event, `wo_worked_hours`, `review_requests`, `all_surfaces_done` event.

- **Home dashboard Contractor section:** `lib/reporting/metrics/contractors.ts` (finished_on_time, silent, qa_first_time, offers_within_24h, variations_raised, expenses_pending, hours_vs_estimate, days_on_site), loaded by `loadContractorSlice` in `lib/reporting/load.ts:196–250`, attributed via `work_orders.contractor_id`. It has its own queries and no status/call-back source; §8 of the brief ("point the dashboard at the same source") means feeding it from `painter_status` rather than deleting these metrics, which are different measures.
- **Closest acknowledgement patterns:** `contractors.tour_seen_at` via self-only definer RPC `contractor_tour_seen()`; `contractors.rcti_agreement_signed_at`; `contractor_events` (contractor-level log). **There is no contractor-manual read acknowledgement** anywhere in the code.
- **Settings patterns:** `settings(key, value jsonb)`. Cleanest pattern for a typed block with defaults/ranges and a server action: `lib/crm/thresholds.ts` + `app/(app)/settings/crmSettingsActions.ts`. Boolean switch pattern: `lib/wizard/publicFlag.ts` / `lib/painters/employeesFlag.ts`. Nested config read from SQL: `wo_loop_setting(text[])`. **Public holidays exist:** `settings.visit_booking_rules.publicHolidays` (edited at Settings → Booking rules, November work item reminds). Helpers: `lib/time/workingDays.ts` (Mon–Fri minus holidays; **no "add N business days"**), `lib/scheduling/dates.ts` (per-painter weekends, ignores holidays). **No SQL business-day function.**
- **Reimbursement-line pattern:** `contractor_invoices.reimbursement_lines jsonb` + `reimbursement_cents` (20261127), filled by `contractor_expense_sweep` inside `contractor_invoice_request/submit` (latest bodies in 20270218). Excluded from `claimed_ex_cents`. Contractors only; employees are reimbursed through Payables.

## 7. Contractor payment due date and the invoice chase hold (item 6)

- **Due date:** `contractor_invoices.due_on`. Auto-draft at sign-off `contractor_invoice_draft` (`20270218…:92–151`, line 139): `due_on = Melbourne date of wo_signoff.signed_at + settings.invoicing.contractorTermsDays (7)`, **calendar days**, fallback today. Progress claims (`contractor_invoice_request`, line 244) use invoice date + terms. `contractorTermsDays` has **no UI**; DB only. The guard does not freeze `due_on`. Green 3-business-days would replace `+ v_terms` at line 139 with a new SQL `add_business_days(date, n)` reading the holiday list. GST on top (20270218): keep any bonus **out of `claimed_ex_cents`** or it eats the job's remaining claimable amount.
- **Chase hold:** `invoices.chase_hold_reason text` (20270151). Null = chasing runs; any text = paused. **No kind, no enum, no RPC, no event.** Set by a direct update in `pauseRemindersAction` (`app/invoicing/actions.ts:630–643`); respected by `lib/automations/sweeps/moneySignoff.ts` (`invoiceChaseable`, `stillOwing`, deposit filter) and `lib/automations/stillNeeded.ts`. One hold pauses both `invoice_reminder` (all invoice kinds, due+1/4/7/14) and `deposit_reminder`. UI: "Pause/Resume reminders" in `MoneyView.tsx:294–302` only; the Invoicing list shows no badge. Invoices link to the job by `estimate_id` and `work_order_id`.
- **No contractor payment hold exists today** (the brief's ⚑23 hold is new).

## 8. Variation category list (item 7)

Single source `lib/workorder/variations.ts:11–16`: `rot` "Rot / substrate", `damage`, `extra_scope`, `customer_request`. Validated by zod in `app/portal/jobs/[id]/variationActions.ts:20–23`; **no DB check constraint** on `wo_variations.category`. Chips at `app/portal/jobs/[id]/Variations.tsx:165–172`. **Bogging, Stain blocking, Additional coats are absent.** Duplicate label maps to update together: `lib/workorder/console.ts:604–607` (adds `scope_removed`), `lib/portal/timeline.ts:73–78` (customer wording), `app/v/[token]/page.tsx:27`, and hard-coded `scope_removed` strings in `Variations.tsx:220,255`. **Gotcha:** pricing a painter's request through the revision builder overwrites the category with `extra_scope` (`app/quote/revisionActions.ts:259`; `20270222…:148`), so a Bogging chip would be lost at pricing unless that write is changed.

## 9. Where Standards fits in the portal navigation (item 8)

**Recommendation: inside the existing Help tab**, as the brief anticipates ("If the portal already has a Help area, put it there"):
- A pinned "Finish standards" card at the top of `/portal/help`, linking to a new static route `app/portal/help/standards/**` (static segment wins over `[feature]`, so no collision with the markdown guides). Surface pages `/portal/help/standards/[surface]`, rule pages `/portal/help/standards/s/[section]`. The HELP tab stays lit via `startsWith`.
- The Home status card and a "Finish standards · Confirmed 7 Oct · Version 1" card on Home (per the mockup) link there; the confirmed date and version also show on `/portal/profile` and on the staff painter page.
- A seventh bottom tab is not viable: six 61-px tabs already fill the 430-px bar. The mockup's three-tab bar (Home, Job, Standards) is a simplification and does not match the real bar.
- The PDF copy: `contractor_documents` needs a new `contractor_doc_kind` value (e.g. `standards`) and a system-insert path (every row today is painter-uploaded). It would show under "Insurance & licences" / "Your tickets", which would then need a better heading.

## 10. Old code that this build will touch and should clean up (your standing instruction)

Found while mapping; each is in a file a later step edits. None was changed in Step 0.

| Where | What | Step that cleans it |
|---|---|---|
| `lib/workorder/finish.ts` `FINISH_LEVELS` + `FinishChip` | Hard-coded PG-2/3/4 prep/acceptance text that the standards tables replace | 1: `FinishChip` reads the standards level summary; the constant text goes |
| `20261015000000_wo_qa_items.sql` seeds 4 generic QA items | Not per surface; superseded by S12 (check screen links the standards record) | 1/5: decide whether the 4 items stay as a site checklist or are replaced by per-surface rows |
| `settings.wo_loop.qaCadence.establishedContractors`, `contractors.requires_qa`, QA kinds `day_one`/`spot` | Never read / legacy mirror / dead kinds | 5: cadence by status replaces them |
| Two queue mechanisms on `/pc` (`console.ts buildQueue` vs `work-queue.ts` registry) | Violates the one-queue rule in CLAUDE.md | 8: new cards go in the registry; migrating the console cards is a separate parked task to raise, not part of this brief |
| Unused `WORK_ITEM_KINDS`: `signoff_due`, `variation_pending`, `broadcast_incomplete`, `consent_missing` | Declared, never built | 8 |
| `lib/workorder/stages.ts` TRANSITIONS lacks `in_progress → walkthrough` (20270164); test only diffs against 20261124 | Drift | 3 (first step that touches the flag flow) |
| `app/pc/wo/[id]/page.tsx:761–769` "Move to completion prep" copy; `StageAdvance.tsx:280` | Stale: that transition no longer exists | 3 |
| Three duplicate variation label maps + hard-coded `scope_removed` | Single-source violation | 1 (when adding the three chips) |
| `jobReminders.ts:69` builds a date with `toISOString().slice(0,10)` | UTC date bug CLAUDE.md names | 4 |
| `reminders.ts:72` comment says stop reason is stored; registry trigger text says 1–2 day job = "day 2 at 3:30 pm" | Wrong comments | 4 |
| `messaging-automations-inventory.md` | Stale: no row for `contractor_job_update_reminder`; §6.3 says no painter reminders; §5 cron table missing three routes | 4 |
| `app/portal/help/page.tsx:14–15`, `help/[feature]/page.tsx:10,15` | Help always uses `rolesFor("contractor")`; employees see contractor guides and their own guides are unreachable | 1 (Standards lands in Help) |
| `work_order_surfaces` table (20260818) | No readers; superseded by `wo_surfaces` | 1 (drop in the same migration that adds the surface code) |
| `contractors.insurance_expiry` | Deprecated, nothing reads it | first migration that alters `contractors` (2) |
| `TickList` unused prop `workOrderId`; `--soft`/`--green` defined only in the light block | Minor | 1 |
| `ThemeToggle.tsx` / `lib/theme/cookie.ts` comments omit `.pt` | Stale | 6 (status tokens) |

Also noticed, out of scope and not for this build: `generateReportDraft` unused action; `wizard` has its own unrelated `walkthroughRequired`; timestamp-prefix collisions on several migrations.

## 11. Every place the brief's names or assumptions differ from the code (item 9)

| Brief says | Code has | Consequence |
|---|---|---|
| `painters (existing) + standards_invited_at` | **No `painters` table.** `contractors` (incl. employees), linked `profile_id → profiles.id → auth.users`. Column UPDATE is an allow-list (20260824010000); new columns are RPC-written or must be granted | `standards_invited_at` goes on `contractors`; acks keyed by `contractors.id` (= one login) |
| Crew logins (⚑16) | **Do not exist.** One auth login per contractor; crew use an anonymous `work_orders.crew_token` link | "Every login signs" = one acknowledgement per contractor. ⚑16 is moot |
| `wo_qa_checks + attempt_no (if not there), trigger, fixed_same_day` | `attempt_no` **exists** (20270178). `trigger` and `fixed_same_day` do not. Re-check linkage is `retry_of` | Add `trigger` + `fixed_same_day`; derive attempts from `attempt_no` |
| `wo_walkthroughs / wo_signoff + outcome` | Both exist; neither has `outcome`. `wo_signoff.signed_kind` (`rectified` ≈ passed_after_fix, `no_walkthrough`) and `areas` jsonb are the proxies | Add `outcome` to `wo_signoff` (one row per WO) rather than to `wo_walkthroughs` (a booking record); derive `passed_after_fix` from `rectified_at` |
| Six-stage machine, `closed` | **Seven** stages incl. `completion_prep`; `closed` exists. Flow shows seven lanes | Call backs = eighth, non-stage column |
| "Walk-through not required" tick box in the scheduler | Exists: "Walkthrough not required — closes straight after the job (and any quality check)" at `ScheduleBoard.tsx:1637`; writes `work_orders.walkthrough_required` | The "Call back" box sits beside it in the tray-drop sheet |
| Scheduler "painter picker" to sort Green-first (⚑7) | **No picker.** Jobs are dragged onto painter rows; the row order is the only "sort" | ⚑7 becomes: order the painter rows by light and show each light on the row; the "add a painter" select also sorts |
| Property/job page in PC Command | `/pc/wo/[id]`; nothing in PC is called "property" | Route 3 button lives on `/pc/wo/[id]` |
| Reminder schedule §4.2 | **Matches**, on booked working days; rung ids differ | No STOP. Kinds reuse `day1/day1_pm/day2/mid/mid30/mid60/last` |
| "EXTEND the existing reminder record" | Only `automation_claims` (per job, per rung) and `messages`. No due_at / answered / sends_count | `wo_reminder_moments` is new; claims become derived from it or point at it |
| "What counts as an update" (⚑3) | Ticks only from `in_progress` (needs a before photo); photos from any stage | Day-1 07:30 moment answered by a photo is the realistic default; ⚑3 should say so |
| No work today | Nothing exists | New (`wo_day_flags`) |
| Invoice `hold` with `kind` | `invoices.chase_hold_reason text`, free text, direct update, no RPC/event | Add `chase_hold_kind` (or a sibling column) so closing a call back clears only its own hold |
| Contractor due 7 days after sign-off | True for the auto-draft, calendar days via `contractorTermsDays` (no UI). Claims use invoice date | Business-day helper needed in SQL; add Settings UI for the terms |
| Substrate codes shared by rate card and WO lines | **False.** Rate card codes are long strings (`Walls`, `Skirting Boards MDF`, `4-6 Panel Door and Frame (1 Side)`…); WO lines carry `label = clientLabel || code` and `surface_key` only; `wo_surfaces` has no code. Fretwork has no rate code at all | Step 1 adds `code` to `WOSurface`/`wo_surfaces` for new snapshots and joins `surface_key` back to `builder_state` for existing jobs; `standards_surface_codes` maps the long codes |
| Level 2/3/4 on the work order | `wo_snapshot.finishCode` `"PG-2"|"PG-3"|"PG-4"|null` (FIN-1 → null), per-area overrides in `areas[].finishCode` / `work_orders.area_finish` | Level = number in PG-n; "the job's level" can differ per area, so the link uses the area's effective code; null (Level 1) shows no link |
| `small_job_hours` on the work order | No hours column; `estimatedHours(wo_snapshot)` = `booking_offers.hours_allowance` (estimate hours, variations excluded). Existing short-job rule is by **days** (`photoMinimums.shortJobDays`) | New Settings value, hours-based, read from the snapshot |
| Variation chips | Four codes, three duplicate label maps, pricing overwrites the category | Add three codes; fix the overwrite |
| `is_owner` / PC roles | `profiles.staff_roles` (`owner/admin/pc/sales/finance`) + older `profiles.is_owner`; no `is_pc()` | Pick `has_dashboard_role('owner')` for owner actions; add `is_pc()` or use `has_dashboard_role('pc')` |
| Settings list of public holidays | Exists (`visit_booking_rules.publicHolidays`) | Reuse; add `add_business_days` in SQL |
| Reimbursement-line pattern | Exists (`reimbursement_lines`) for contractors only | Bonus = sibling jsonb/cents column excluded from `claimed_ex_cents`; employees via payroll CSV (new column) |
| "Existing offer RPC" (gate) | **Two** offer-creation paths: `send_offer` (20270208) and the bundle path in `20270192…:398–416`; both go through `contractor_recompute_offerable()` → `offerable` | Gate both. `contractor_recompute_offerable` is the natural place for "standards confirmed", `send_offer` for "Red" |
| PC Command "Contractors section" | Does not exist; staff painter list is `/contractors` (`app/(app)/contractors/`) and is a card list, not a table | New `/pc/contractors` |
| Standards "Help tab" | Exists; markdown-driven | Standards as a static route under it (§9) |
| Mockup three-tab bar | Real bar has six (contractor) / five (employee) tabs | Build to the real bar |
| Documents | No documents page; `contractor_documents` card on profile; every row painter-uploaded | New enum value + system insert for the PDF |
| Quality-check "existing Settings default first 3 jobs" | True: `wo_loop.qaCadence.newContractorJobs = 3` + `contractors.qa_mode` | Cadence by status layers on top; `qa_mode` likely retires |
| ⚑16 "every login signs" | One login per contractor | Simplifies ⚑16 |

## 12. Things the build order needs decided before the step that touches them

1. **Where the PC-facing Standards link on the QA screen reads the surface** (S12): QA items are not per surface today. Step 1 needs a ruling: replace the four generic items with one item per `wo_surfaces` row (each linking its standard), or keep the four and add a surface list beneath. Recommendation: one item per surface row, generated at check creation from `wo_surfaces`, with the four generic lines kept as a trailing "Site" group.
2. **Surface code for issued jobs:** new snapshots can carry a `code`; the ~live jobs cannot be rebuilt. Recommendation: Step 1 resolves the standard by `surface_key → builder_state code` when the snapshot has no code, and by label as a last resort, listing unmatched labels in the report.
3. **Lead painter = `contractor_id` at offer time:** for a contractor, `work_orders.contractor_id` is set when the offer is **sent**, not accepted. The evaluator must read `booking_offers` where `state='accepted'` (or `wo_assignments.is_lead` for employees), never `contractor_id` alone on a job before acceptance.
4. **Queue:** the brief's §8 cards go in `lib/crm/work-queue.ts` (the registry, per CLAUDE.md). The console's `buildQueue` cards remain as they are; merging them is parked work I will list, not do.
5. **Help for employees bug** (§10): fixing it is in scope for Step 1 because Standards lands in Help and must reach employees (S5).

---

Step 0 complete. No application code was written; the only commits are the three reference files and this report. Step 1 does not start until Tom has read this.
