# Finish standards, painter status, call backs — Step 0 re-run (13 Oct 2026, no code)

Run on the request of 13 Oct 2026 against `docs/briefs/claude-code-brief-standards-status-callbacks.md` (the copy committed that day, which adds the Red painter-facing wording to R12). Nothing in `app/`, `lib/` or `supabase/` was changed.

**Headline.** Step 0 for this brief was already run and committed on 8 Oct 2026 (`docs/briefs/standards-status-callbacks-s0-report.md`, commit 9473df19), and **Steps 1–9 of the brief have since been built and merged** (`docs/ARCHITECTURE.md` lines 4389–4622; migrations `20270224`–`20270230` live on production per the ledger notes in memory). So this report maps the code *as built* against the brief, not a greenfield. Where the 8 Oct report said "does not exist", most of those gaps have since been filled; the table in §9 lists what still differs.

## 1. Reference files (kickoff ritual)

Committed 13 Oct on `docs/standards-induction-briefs` (2ae64f07), byte-identical to the build pack:

| Path | State |
|---|---|
| `docs/briefs/claude-code-brief-standards-status-callbacks.md` | updated (R12 Red wording) |
| `design/reference/contractor-status-standards-mockup.html` | updated (+1 CSS line `.screen>.seg … {flex:none}`) |
| `docs/standards/finish-standards-v1.json` | unchanged (identical to 8 Oct copy) |
| `docs/briefs/claude-code-brief-induction-demo-property.md` | new |
| `docs/induction/induction-v1.md` | new |

Already in the repo, all present: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/briefs/claude-code-brief-wo-loop-pc-command.md`, `docs/briefs/work-order-completion-workflow.md`, `design/reference/pc-command-mockup.html`, `docs/briefs/claude-code-brief-employed-painters.md`, `docs/briefs/messaging-automations-inventory.md`, `docs/briefs/claude-code-brief-invoicing-payments.md`, `docs/briefs/acceptance-to-paid-workflow.md`, `docs/briefs/claude-code-brief-home-dashboard-v2.md`. Nothing missing.

## 2. Contractor portal: routes, layout, navigation, theme, tokens (item 1)

- Routes under `app/portal/`: `page.tsx` (Home), `requests/`, `jobs/`, `jobs/[id]/`, `money/`, `money/[id]/`, `calendar/`, `help/`, `help/[feature]/`, `profile/`, `suspended/`, `status/` (My status), `standards/confirm/` (sign-off).
- Layout `app/portal/layout.tsx`: imports `./portal.css` (L4), reads theme cookie (L36), root `<div className="pt" data-theme>` (L55), `<ThemeToggle initial rootSelector=".pt">` (L74), `<PortalTabs>` (L85).
- Navigation `app/portal/PortalTabs.tsx` — bottom bar, `TABS` L17–29: Home, Requests, Jobs, Invoicing/Expenses, Calendar, Help. Hidden on `/portal/standards/confirm` (L40).
- Theme switch: `lib/theme/cookie.ts` (`THEME_COOKIE = "crm_theme"`), `app/components/ThemeToggle.tsx` (shared with CRM and PC).
- Tokens `app/portal/portal.css`: dark `.pt {}` L6–31, light `.pt[data-theme="light"]` L637–655. **Status tokens exist** at L706–786: lamps `--l-green/yellow/orange/red/blue` (same both themes), text-safe `--t-*` with light overrides L719–722, `.tl/.lamp/.lamp.on` pulse, `.statuscard`, `.jd` dots. Lamp component `app/components/status/TrafficLight.tsx`; names/copy in `lib/painterStatus/copy.ts`.
- Mismatch: `app/pc/pc.css` L317–321 `.stl-*` hard-codes the same hex values rather than reading tokens.

## 3. Quality checks, walk-through, scheduler tick box, PC Command (item 2)

**Quality checks** — `wo_qa_checks` (`20260927000000_wo_loop_tables.sql:144`): `result pass|fail`, `attempt_no` (20270178, trigger-set), `retry_of` (20270196), `trigger` (`20270228…:202`, values `new_painter|yellow_cadence|orange_every|required|spot|recheck|mid`), `scheduled_time` (20270247). Cadence by colour in `wo_schedule_qa` (`20270228…:208–254`). RPCs `wo_record_qa` (20270196:51), `wo_add_qa_check` (20270247:206). Spot check buttons: `app/pc/wo/[id]/QaControls.tsx:71` and `app/pc/contractors/ContractorRows.tsx:76`. Recording screen is the `#qa` block on `app/pc/wo/[id]/page.tsx:897` (`QaCheck.tsx`).
- **Not built:** `fixed_same_day` column (nowhere). The "Fixed today" answer in `QaCheck.tsx:133` only closes the prompt; it writes nothing.
- **Not built (S12):** the QC screen has no per-surface link to the standards record — `QaCheck.tsx:169–171` has the comment but no JSX. QC tick lines are four generic items (`wo_qa_items`, seeded by trigger, `20261015…:51–56`), not per surface.

**Walk-through / sign-off** — `wo_walkthroughs` (20261028, booking record), `wo_signoff` (one per WO, `areas` jsonb per-area verdicts, `signature`, `outcome passed|passed_after_fix|failed_callback` added `20270226…:78`, set by trigger `t_wo_signoff_outcome` L115–131). Per-area flag/approve RPC `wo_walkthrough_area` (20270164:34). Signature pad `app/components/SignaturePad.tsx` → `wo_sign_drawn`. `outcome` is written in SQL but **never read by the app**.

**Scheduler "Walk-through not required"** — `app/pc/schedule/ScheduleBoard.tsx:1667–1671` (`offerNoWalk`), set via `wo_set_walkthrough_required` before `send_offer`/`assign_job` (`app/pc/schedule/actions.ts:166–199, 266–295`). Job-page toggle `WalkthroughCard.tsx:132`.

**PC Command** — nav `app/pc/PcNav.tsx:14–25`: `/pc` is labelled **"Dashboard"** and `/pc/flow` **"Project Progress"** (the brief says Command / Flow). Attention queue: `app/pc/page.tsx` ← `buildPcWorkItems` (`lib/crm/work-queue.ts:2410`). Flow lanes from `lib/workorder/stages.ts:91,150` (seven); **Call backs column exists** and shows only while one is open (`app/pc/flow/page.tsx:30–35, 70–90`, `lane-callbacks`), with "Call back" tag and "Invoice chasing paused". Job page `app/pc/wo/[id]/page.tsx` is the "property page" (nothing in PC is called property). Contractors section `app/pc/contractors/` (page, `ContractorRows.tsx`, `Recompute.tsx`) reading `lib/painterStatus/contractorsLoad.ts`.

## 4. Reminder automation (item 3)

- Schedule: `lib/workorder/jobRhythm.ts` `painterUpdateRungs` L83–92 — 1–2 days: 07:30 day 1 + 15:30 last; 3–6: + 50%; 7+: 30% / 60% / last. **Matches §4.2.** Rung ids `day1|day1_pm|day2|mid|mid30|mid60|last`. Days are booked working days honouring `works_saturday/sunday`; public holidays are not skipped.
- Records: `wo_reminder_moments` (`20270227000000_reminder_moments.sql:19–39`; `sends_count`, `last_sent_at`, `answered_at`, `skipped_reason no_work|rescheduled|not_sent`). Pure logic `lib/workorder/reminderMoments.ts` (`planMoments`, `sendTimes`, `decideSend`, `reconcilePlan`).
- Sender: `lib/automations/sweeps/jobReminders.ts:170–274`, run by `app/api/cron/campaign-sweep/route.ts:63` every 30 min (`vercel.json`). Follow-ups 10:30/13:30 and 17:30/19:00, max 3, nothing after 19:00 (`DEFAULT_JOB_UPDATE_RULES`, `reminderMoments.ts:47–50`; setting `job_update_rules`). Third text uses the Green wording when Green (`jobReminders.ts:248`).
- What counts as an update (⚑3): trigger `wo_reminder_moment_answer` (`20270227…:84–104`) — a `wo_events` row of type `surface_tick | photo | all_surfaces_done` by `contractor|system` on the moment's Melbourne day; answers the earliest open moment that day (⚑4 as defaulted).
- Note: memory said `lib/wo/jobRhythm.ts`; the real path is `lib/workorder/jobRhythm.ts`.

## 5. Lead painter and employed painters (item 4)

- No `painters` table. `contractors.employment_type 'contractor'|'employee'` (`20270153…:32–49`), `public.is_employee()`, TS `lib/painters/capabilities.ts:94`.
- Lead = `work_orders.contractor_id` + `wo_assignments.is_lead` (`20270154…:35–67`, one lead per job); `set_lead_painter` redefined `20270230…:204` with the Red gate (trigger `wo_assignments_lead_gate` L229).
- **Crew logins do not exist** (one auth login per contractor; crew use `work_orders.crew_token` → `app/crew/[token]`). ⚑16 is moot. `docs/help/painter-status/contractor.md:33` still says "a crew login" — stale wording.

## 6. Existing tables for call backs, status, standards (item 5) — all built

| Table | Migration |
|---|---|
| `standards_versions/blocks/surfaces/checks/surface_codes` | `20270224000000_finish_standards.sql` |
| `standards_acks` + `contractors.standards_invited_at/standards_grace_until` + `send_offer` gate | `20270225000000_standards_signoff.sql` |
| `wo_callbacks` + enums, `wo_photos.callback_id`, `invoices.chase_hold_kind`, `wo_signoff.outcome`, RPCs `wo_callback_log/book/mark_fixed/close/set_reason/void/hold` | `20270226000000_wo_callbacks.sql` |
| `wo_reminder_moments`, `wo_day_flags`, `wo_set_no_work_day`, `wo_clear_no_work_day` | `20270227000000_reminder_moments.sql` |
| `painter_job_results`, `painter_status`, `painter_bonuses`, `painter_status_write`, `wo_schedule_qa`, `wo_add_qa_check` | `20270228000000_painter_status.sql` |
| `painter_status_visible()` | `20270229000000_painter_status_visible.sql` |
| Red clearance, business days, Green terms, bonus RPCs, current `painter_status_write`/`send_offer` | `20270230000000_status_offers_payment_bonus.sql` |

Evaluator `lib/painterStatus/evaluate.ts` (+ 24 golden tests in `evaluate.test.ts`), writer `lib/painterStatus/run.ts` (sole caller of `painter_status_write`, L122), boundary `lib/painterStatus/boundary.test.ts`. Loader `scripts/seed-standards.ts` (no `package.json` script; `--prod` + `SEED_ALLOW_PRODUCTION=1`).

## 7. Contractor payment due date and chase hold (item 6)

- Default: `contractorTermsDays` 7 (`20261112…:89`), sign-off date + terms. Green → `business_days_after(signed, 3)` capped at the default (`20270230…:270–319`, `greenTermsBusinessDays` in `painter_status_rules`). `business_days_after` (L254) skips Mon–Fri + `visit_booking_rules.publicHolidays` — **that list is seeded empty**.
- Hold: `contractor_invoice_hold_fast_terms` / `release` (L322–367), `terms_kind default|green_fast|held`. UI is on **/invoicing Payments** (`app/invoicing/payments/ActionsClient.tsx:603`), not on `/pc`.
- Chase hold: `invoices.chase_hold_reason` (any value pauses, `lib/automations/sweeps/moneySignoff.ts:78`) + `chase_hold_kind call_back|office`; `wo_callback_hold` sets/clears; `invoice_set_chase_hold` (20270255) refuses to lift a `call_back` hold.

## 8. Variation category list (item 7)

`lib/workorder/variations.ts:19–27`: `rot, damage, bogging, stain_blocking, additional_coats, extra_scope, customer_request` (+ office-only `scope_removed`). S11 done. Chips `app/portal/jobs/[id]/Variations.tsx:170`; zod enum in `variationActions.ts:21`. No DB enum — `wo_variations.category` is free text (`20260927…:105`); the zod enum is the only validation.

## 9. Where Standards sits (item 8)

Under the **Help** tab, not its own tab: `app/portal/help/standards/page.tsx` (+ `[surface]`, `s/[section]`), pinned card at top of `app/portal/help/page.tsx:32`, card on Home, PDF link from `lib/standards/notify.ts:25`. Staff mirror `app/pc/standards/`. "What we expect" is **one card at the top of the job** (`app/components/standards/WhatWeExpect.tsx`, rendered `app/portal/jobs/[id]/page.tsx:545` and `app/pc/wo/[id]/page.tsx:644`), not a per-line link — Tom's 9 Oct ruling, recorded in code comments at L316/L344.

## 10. Every place the brief's names or assumptions differ from the code (item 9)

| Brief | Code (as built) | Note |
|---|---|---|
| Nothing built yet (Step 0 → 1…) | Steps 1–9 merged 8–9 Oct | Brief's build order is complete; this is a re-run |
| `painters` table, crew logins | `contractors`, one login each, `crew_token` link | ⚑16 moot |
| `wo_qa_checks.fixed_same_day` | not present; "Fixed today" writes nothing | Case 7 (failed check, no call back) still holds because no call back row is made |
| QC screen links each surface to its standard (S12) | not built; QC items are four generic lines | open gap |
| `wo_signoff.outcome` read by screens | written by trigger, read nowhere | cosmetic |
| "What we expect" per surface line (S3) | one card at top of the job | ruled 9 Oct |
| PC "Command" / "Flow" | nav labels "Dashboard" / "Project Progress" | wording only |
| Scheduler painter picker sorted Green-first (⚑7) | lanes ordered by `STATUS_ORDER` (`lib/scheduling/board.ts:52`) with lights; unsigned painters **not greyed** — only the drop sheet blocks | partial |
| Red block surfaced in UI | RPC blocks; `ERROR_WORDING` in `app/pc/schedule/actions.ts:66–89` has no `red_no_clearance` entry → raw "Couldn't complete that (red_no_clearance)" | small gap |
| `status_launch_date`, `status_visible_to_painters` as Settings keys | JSON keys `launchDate`, `statusVisibleToPainters` inside `painter_status_rules` | naming |
| `small_job_hours` Settings | own row `{value:16}` + column on `standards_versions` | matches |
| Bonus = reimbursement-line sibling | **changed**: `bonus_claim` raises a separate `contractor_invoices` row (`auto_draft_source='bonus'`), paid-trigger sets `paid`; employees → payroll CSV | 20270230:424–473 |
| `bonusApprovalsEnabled` switch | seeded `false`, DB-only — **no Settings screen toggles it** | ⚑10/⚑11 still open |
| Business days skip Victorian holidays (⚑14) | helper exists; `publicHolidays` list is `[]` | Tom to fill the list |
| PC payment hold button "on PC Command" | lives on /invoicing Payments | placement |
| Painter-side "No work today" state on the job | not shown in the portal job page | minor |
| Help "crew login" wording | stale (`docs/help/painter-status/contractor.md:33`) | docs fix |
| `lib/painter-status/` (brief) / `lib/wo/jobRhythm.ts` (memory) | `lib/painterStatus/`, `lib/workorder/jobRhythm.ts` | paths |
| Messaging inventory rows | 11–18, 16a, office 17–19 present | done |
| Customer-role RLS proof | `e2e/status-full-loop.spec.ts:235–239` reads [] from all 7 tables as customer | done |

## 11. What this means for the induction brief's Step 0

The induction brief (§1) lists this brief as "build on it". Its Step 0 can start from this map: the sign-off is `standards_acks` + `app/portal/standards/confirm/`, the offer gate is `send_offer` (20270230:147) + trigger `booking_offers_standards_gate`, and the worker-login question is answered above (no crew logins exist today; `crew_token` is view-only). That Step 0 was **not** run in this session.

---

Step 0 re-run complete. No application code written.
