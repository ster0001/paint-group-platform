# Claude Code brief — Automations inside Campaigns (engine, chat channel, staff alerts)
**paint-group-platform · brief v1 · 5 Nov 2026**
Owner: Tom Roman · Design: Claude · Build: Claude Code
Builds on: `claude-code-brief-estimates-tab-funnel.md` (events + stages must be in before session 2 here).

> One sentence: extend the existing CRM Campaigns tab with always-on automations — each with its own on/off switch, a message written in the builder, sent as a chat message (plus SMS where set) in the estimator's name under the right brand — and route staff alerts by working hours.

---

## 0. Read first, confirm the file list back, then code

| File | Why |
|---|---|
| `docs/briefs/customer-funnel-map-and-automation-plan.md` (v3) | **Master.** §4 automation tables, rulings R1–R16, **Appendix A copy** — loaded verbatim as defaults. |
| `design/reference/estimates-tab-and-automations-mockup.html` | Automations list + builder sheet, approved 5 Nov. |
| `claude-code-brief-estimates-tab-funnel.md` | Event types, `deriveStage`, `automation_runs` contract the cards read. |
| `docs/briefs/claude-code-brief-campaign-studio-referrals.md` | The existing Campaigns tab: builder, media, send adapters. **Extend, don't fork.** |
| `docs/briefs/claude-code-brief-crm-retargeting.md` rev 2 | Guarded idempotent sending, segment evaluator, consent. |
| `docs/briefs/messaging-automations-inventory.md` | Every existing send — any that overlaps an automation key here is migrated into it, not duplicated. |
| `docs/briefs/claude-code-brief-visit-booking.md` + addendum A | Visit reminders already specified there (L11) — reuse. |
| `docs/briefs/claude-code-brief-invoicing-payments.md` | W2 deposit-due replaces that brief's deposit ladder. |
| `CLAUDE.md` | Standing rules. |

Missing file → stop and report.

---

## 1. Rulings (binding)

- **R1 — no bare emails to customers.** Every written message = a row in the customer's chat thread + an email *notification* carrying the text, from the estimator's name and brand address, plain text, no marketing template, replies land in the thread. The only customer emails that exist are these notifications.
- **R3 — brand-correct sending.** Sender name, from-address domain, SMS sender ID and logo chosen from `estimates.brand` / `accounts.brand`. A Paint Home customer never receives a Paint Group mark.
- **R4 — staff alerts by hours.** Working hours: staff chat pop-up + email. Out of hours: SMS to Robyn and Tom + email summary. Applies to L9, L10, L13, E8, E1.
- **R6 — deposit chase** = one SMS + one chat, job start −3 days, if unpaid. No ladder.
- **R8 — SMS quiet hours 20:00–08:00 every day.** Due in quiet hours → sends at 08:00. Chat (and its email notification) is not subject to quiet hours.
- **R9 — no incentive** anywhere in the copy.
- **R10 / R15 — no approval queue.** Automations live in **Campaigns › Automations**, each with an on/off switch, all shipped **off**. Tom switches them on one by one. Copy lives in the builder, editable per brand.
- **Exit on stage change** — the moment the customer's derived stage changes, every pending step for the old stage is cancelled.
- **Idempotent** — an automation step fires at most once per (customer, estimate, automation_key, step). Guaranteed by a unique index, not by application logic alone.
- **Consent** — nothing sends to a customer without `consent_marketing` at the gate (transactional W/E9/L11 are exempt as service messages; flag ⚑1 for the exact list).
- **Trade accounts** — chat only, no SMS, half cadence ⚑2.
- AI never generates these messages; it may be offered later as a draft helper inside the builder behind a toggle (out of scope here).

---

## 2. What Campaigns has today vs what it needs (session 0 confirms)

Expected from the campaign studio brief: a builder with variables and media, brand sender settings, Resend/Twilio adapters, a send log. This brief adds:

| Need | Likely state | Action |
|---|---|---|
| Automations sub-tab | missing | add beside Campaigns list |
| Trigger = stage + wait (not a one-off audience) | missing | `automations` table + scheduler |
| Per-automation on/off | missing | column + switch |
| Chat channel (thread + notification) | partial — threads exist, notification-in-estimator's-name may not | `sendChat` adapter |
| Brand-aware senders | partial | sender config per brand in Settings |
| Staff-alert adapter with hours routing | missing | `sendStaffAlert` |
| Quiet hours | unknown | scheduler rule |
| Per-automation stats | partial (send log) | `automation_runs` + reply/convert attribution |

Session 0 writes the real table of this and the brief is amended before session 1.

---

> **RULED 11 Nov 2026 (Tom, A‑A): extend the existing engine.** §3.1–§3.3 and the scheduler in §5 are **superseded**. The keys in this brief become entries in `lib/automations/registry.ts`, sent through `sendAutomation` (`lib/automations/dispatch.ts`), made idempotent by `automation_claims` (keyed with the step), switched and worded at the existing automations screen. There is no `automations`, `automation_messages` or `automation_runs` table and no scheduled-run row: a sweep **derives** what is due from stage + age at send time, so "stops if the stage changes" needs no cancel step. Genuinely new (A‑B): per-brand wording (one table, `key × brand × channel`), send stats read from `messages.meta.automation`, and a thin run log only if the screen's "next due" needs one. Default-off on the registry (A‑D) and STOP honoured by `sendAutomation` (A‑E) land **before** the first new key. Task-type keys (L8, E3-task, E6) are new kinds in `lib/crm/work-queue.ts`. Event names use underscores (`message_sent`, `staff_alerted`, `message_replied`). Rulings A‑B…A‑N are still proposals.

## 3. Data

### 3.1 `automations`
`id, key (L1…R5, unique), name, group (lead|estimate|won|after), enabled bool default false, trigger_stage, trigger_delay_minutes, trigger_kind (stage_age|date_offset|event), date_field? (expires_at|job_start_at|signed_off_at), offset_days?, channel (chat|sms|both|staff|task), exit_stages text[], audience (all|residential|trade), quiet_hours_apply bool, sort_order, updated_by, updated_at`

### 3.2 `automation_messages`
`automation_id, brand (paint_group|paint_home), channel (chat|sms|staff|task), body text, updated_by, updated_at` — unique on (automation_id, brand, channel). Seeded from Appendix A with `{brand}` resolved per row.

### 3.3 `automation_runs`
`id, automation_id, key, account_id, estimate_id, wizard_session_id, brand, scheduled_for, status (scheduled|sent|cancelled|skipped|failed), cancel_reason (stage_changed|disabled|consent|quiet_hours_deferred|already_sent), sent_at, channel, thread_message_id?, sms_sid?, email_id?, opened_at?, replied_at?, converted_event?` — **unique (key, estimate_id, coalesce(wizard_session_id))** → idempotency.

Every send also writes `crm_events` `message.sent {automation_key, brand, channel}` so the estimate activity log shows it; opens/replies write `message.opened` / `message.replied`.

### 3.4 Settings
- `brands.paint_group` / `brands.paint_home`: display name, from-address, reply-to, SMS sender ID, logo path, default estimator (⚑3 for Paint Home).
- `crm.working_hours` (Mon–Fri 08:00–17:00), `crm.public_holidays` (VIC list, editable), `crm.sms_quiet_from = 20:00`, `crm.sms_quiet_to = 08:00`.
- `staff.alert_recipients`: per staff member — in-hours (chat+email), after-hours SMS yes/no + number. Seed: Robyn and Tom after-hours on ⚑4.
- `crm.trade_cadence_factor = 0.5`.

---

## 4. Adapters — `lib/messaging/`

One messaging adapter already exists per the standing rule; add three functions to it, no new modules elsewhere:

- `sendChat({threadId, brand, fromStaffId, body})` → inserts thread message as the estimator → sends email notification (Resend) from `brands[brand].from`, display name = estimator, subject = first line truncated, body = plain text + one-line "Reply to this email or open your {brand} page: {link}"; inbound replies (Resend inbound or reply-to webhook) append to the same thread and write `message.replied`. Returns ids.
- `sendSms({to, brand, body})` → Twilio with `brands[brand].sms_sender`; respects quiet hours by *deferring* (returns `deferred_until`), never dropping.
- `sendStaffAlert({kind, estimateId, body})` → reads `crm.working_hours` + holidays → in hours: staff chat pop-up (existing staff notification channel) + email; out of hours: SMS to each `after_hours` recipient + one email summary. Writes `staff.alerted` event.

Golden tests: brand mapping (every brand × channel), quiet-hour deferral boundary (19:59 sends, 20:00 defers to 08:00, Sunday sends), holiday → after-hours routing.

---

## 5. Scheduler — `lib/automations/`

- **Evaluate on event** (primary): every `crm_events` insert triggers `evaluateAutomations(subject)` — derive stage → cancel runs whose `exit_stages` include the new stage → schedule runs for enabled automations whose `trigger_stage` matches (`scheduled_for = now + delay`, or date-offset for W2/E9/R3/R4). Unique index makes double-scheduling a no-op.
- **Sweep** (secondary): `/api/cron/automations` every 5 min with `CRON_SECRET` → send runs where `scheduled_for <= now`, re-checking stage, enabled, consent, audience and quiet hours at send time (a run scheduled yesterday must not send if the switch was turned off this morning).
- Task-type automations (L8, E3-task, E6) don't send — they create a work-queue item the Estimates tab evaluator reads.
- Disabling an automation cancels its scheduled runs (`cancel_reason = disabled`); enabling does **not** backfill past-due runs for customers already deep in a stage ⚑5.

---

## 6. UI — Campaigns › Automations (match the mockup)

- Sub-tab beside the existing Campaigns list. Groups: Lead stage · Estimate stage · Won & after the job. Row = key, name, channel chip, trigger summary, 30-day stats (`sent · replied · converted`), **switch**.
- Tap → builder sheet: switch, Trigger (read-only summary of stage + delay; delay editable), Stops if (exit stages, read-only), Channel (chat / sms / both), Wording tabs **Paint Group | Paint Home** with the textarea and variable chips, Sends from (resolved per brand), 30-day KPIs, **Preview as [a real recent customer]** (renders variables from a chosen estimate, nothing sends), Save.
- Variables: `{first_name} {address} {range} {link} {estimator} {brand} {visit_link} {date} {painter} {window} {expiry} {deposit_amount} {pay_link} {showcase_suburb} {showcase_range} {showcase_link} {lead_time} {earliest_start} {rooms_done} {step} {phone} {due} {zone} {question} {warranty_end} {referral_link} {reward_text} {seasonal_line} {exterior_line}` — resolver in `lib/automations/variables.ts`; unresolvable variable at send time → run `skipped` with reason, staff alert in hours.
- Global footer: quiet hours, working hours, after-hours recipients (links to Settings).
- Roles: owner + admin edit; sales read + switch ⚑6.

---

## 7. Sessions

| # | Session | Done when |
|---|---|---|
| 0 | **Read-only diagnostic of Campaigns**: builder, adapters, senders, send log, thread/notification path, existing sends that overlap keys here. Table in §2 filled in. | `docs/briefs/automations-session-0.md` committed; brief amended |
| 1 | Settings (brands, hours, holidays, quiet hours, alert recipients); `sendChat` / `sendSms` / `sendStaffAlert` with golden tests; inbound reply → thread. | A manual chat from the estimate page arrives as a Paint Home email from Sarah, reply lands back in the thread |
| 2 | *(Superseded by A‑A: registry entries shipped off via the default-off flag, per-brand wording table, a stage-sourced sweep over `sendAutomation` + `automation_claims`. Original text:)* Tables `automations / automation_messages / automation_runs`; seed all keys **off** with Appendix A copy per brand; `evaluateAutomations` + cron sweep; idempotency + exit tests. | Walking skeleton: L1 switched on in test → a seeded range-no-action lead gets one SMS at +2 h, cancelled if they book first |
| 3 | Automations sub-tab + builder sheet + preview-as; stats. | Tom edits L2 wording on his phone and previews it as a real customer |
| 4 | Wire every key: stage triggers, date offsets (W2 −3 days, E9 −7 days, R3/R4), task-type keys into the work queue, trade cadence, consent gate; migrate overlapping existing sends (review request, visit reminders, deposit chase) under their keys. | One e2e per group runs a seeded customer through the sequence with time travel |
| 5 | Attribution: opens, replies, `converted_event` (booking/acceptance within 7 days of a send); Funnel "came back by automation_key" lit; Estimates cards show last/next. | Numbers reconcile with `automation_runs` |
| 6 | Full-loop e2e (wizard → drop → L1/L2 → reply → E8 alert in hours and out of hours → visit → estimate → E4 → accept → W1 → W2); help file; ledger. | Green; `docs/help/automations.md`; inventory updated |

---

## 8. Acceptance criteria

- [ ] Every automation key from the master plan exists in `automations`, **off**, with Paint Group and Paint Home copy seeded from Appendix A; Tom can edit and save wording per brand.
- [ ] No automation sends a standalone customer email — every chat send has a thread row and a notification email whose from-name is the estimator and whose domain matches the brand (test for both brands).
- [ ] An SMS due at 21:00 is deferred to 08:00; one due Sunday 10:00 sends.
- [ ] A help request at 14:00 Tuesday → staff chat + email; at 21:00 → SMS to each after-hours recipient + one email summary (tests with clock injection; holiday test).
- [ ] Idempotency: forcing the evaluator twice on the same event schedules one run; the unique index rejects the second insert.
- [ ] Exit: a customer who books a visit after L1 is scheduled has L2/L3/L4 cancelled with `stage_changed`.
- [ ] Turning an automation off cancels its scheduled runs; turning on does not send to customers already past the delay (⚑5 default).
- [ ] Trade accounts receive chat only and at half cadence.
- [ ] Customers without marketing consent receive only the exempt transactional keys (⚑1 list).
- [ ] Every send/open/reply appears in the estimate's activity log and on the card's "Last sent / Next due".
- [ ] Deposit chase is exactly one SMS + one chat at start −3 days when unpaid; the old ladder is gone.
- [ ] Existing sends that overlap (review request, visit reminders) now run under their keys — no duplicate messages (inventory diff).
- [ ] Typecheck, lint, unit, e2e green; migrations between gate runs.

---

## 9. Decisions for Tom ⚑

| ⚑ | Decision | Default if unanswered |
|---|---|---|
| 1 | Which keys are transactional (send without marketing consent)? | L11, L12, E2, E9, W1–W4, R1 |
| 2 | Trade cadence: chat only, half the delays? | Yes |
| 3 | Default estimator name for Paint Home when no `sent_by` | Sarah Reid (same person, Paint Home address) |
| 4 | Robyn's and Tom's after-hours numbers (entered in Settings, not in code) | — |
| 5 | When a switch is turned on, send to customers already past the delay, or only new arrivals? | Only new arrivals |
| 6 | Can sales staff flip switches, or owner/admin only? | Owner + admin only |
| 7 | E11 one-tap decline reasons: Price / Timing / Went elsewhere / Not going ahead — keep? | Keep |

---

## 10. Status
- 5 Nov 2026 — brief written; blocked on Estimates brief sessions 1–2 and this brief's session 0.
- 6 Nov 2026 — session 0 done: `docs/briefs/automations-session-0.md`. Existing engine found; brief to be amended after rulings A-A to A-N.
