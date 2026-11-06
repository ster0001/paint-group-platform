# Estimates tab & funnel — session 0 diagnostic
**Read-only. 6 Nov 2026, against `main` 7809bd94.** No code changed, no database queried, so what follows is what the repo says, not what production holds. Brief: `claude-code-brief-estimates-tab-funnel.md`. `M:` = `supabase/migrations/`, by date prefix.

The brief's aim holds up. Its picture of the schema does not: much of what it calls new already exists under another name. **Session 1 cannot start as written.** Rulings needed are in §10.

---

## 1. Reference files

| File | State |
|---|---|
| `customer-funnel-map-and-automation-plan.md` | Added this branch. **The copy supplied is v2 (R1–R10); the briefs cite v3 (R1–R16).** R11–R16 are known only from how the briefs quote them |
| `design/reference/estimates-tab-and-automations-mockup.html` | Added this branch |
| `wizard-progress-crm-buckets-brief.md` | Real name is `wizard-progress-crm-buckets.md` |
| `claude-code-brief-campaign-studio-referrals.md` | **Does not exist anywhere searched** (Automations brief only) |

---

## 2. `crm_events`

**Shape (M:20261205):** id, tenant_id, nullable account/property/estimate/work_order/invoice FKs, type, source, actor_profile_id, payload, occurred_at, recorded_at, dedupe_key; `is_demo` added at M:20270262. Staff read only. Written by `crm_log_event` and the internal `crm_emit`. UPDATE blocked.

Three facts the brief's design runs into:

- **Dotted names are rejected.** `crm_events_type_shape` is `^[a-z][a-z0-9_]{2,48}$`. Every `wizard.step_viewed` style name in §3.1 would fail the insert. 78 underscore types are catalogued in `lib/crm/events.ts:34-192`.
- **Events with no account vanish.** `crm_emit` opens `if p_account is null then return;` (M:20270121:40). A trigger event on an estimate with no account writes nothing.
- **No `brand` or `wizard_session_id` column.** The session is `payload.sessionId`, unindexed. The brief's activity-log filter cannot run on it efficiently.

### Brief §3.1 against what exists

| Brief event | Today |
|---|---|
| `wizard.session_started` | `wizard_started`, assistant only. Form wizard: **missing** |
| `wizard.step_viewed` | `wizard_step_viewed`, **deduped to one per session + step** (`app/api/wizard/event/route.ts:29`) |
| `wizard.step_completed` | **Missing** |
| `wizard.help_requested` | `wizard_help_requested`, page label only |
| `wizard.message_sent` | `customer_message_sent` |
| `wizard.gate_submitted` | **Missing** (column `gate_completed_at` exists) |
| `wizard.range_shown` | `gate_viewed`, one per session |
| `wizard.tighten_started/completed` | Closest: `quote_stage_viewed` / `quote_stage_done` |
| `wizard.session_idle` | `wizard_abandoned`; nothing for priced sessions |
| `wizard.session_resumed` | **Missing** (`wizard_drafts.visits` counts returns) |
| `visit.requested` | `visit_request_made` |
| `visit.booked/completed/cancelled/no_show` | Underscore names, by trigger; no zone, slot or estimator |
| `call.requested` | `visit_request_made` kind=call, plus `callback_requested` |
| `call.completed` | `call_connected` / `call_no_answer` |
| `estimate.sent/viewed/accepted/declined` | Underscore names |
| `estimate.expired` | `estimate_lapsed` |
| `estimate.question` | No crm event; in `estimate_questions` and `estimate_events` |
| `estimate.revised` | Catalogued and read by `stage.ts`, **no writer** |
| `staff.action` | Separate types, no single one |

The step dedupe matters beyond naming: views, back-taps and returns cannot be counted from step events as keyed today, so the Funnel's "back-taps" and the view-count figures need a key change, not just a new event.

---

## 3. `wizard_sessions` is `wizard_drafts`

M:20270107 says so outright: a second table would be the single-source violation the CRM rules forbid.

- **Holds:** current/furthest_page (1–12), step_times `{page: seconds}`, active_seconds, last_heartbeat_at, bucket, outcome, dropped_at, entry_source, gate_*, range_*, last_screen, brand.
- **§3.2 compare:** `last_seen_at` exists. `resume_count` → only `visits`. `last_step_key` → none; `last_screen` is closest.
- **Heartbeat:** 15 s, `app/api/wizard/heartbeat/route.ts`.
- **Idle:** `IDLE_MINUTES = 45` is a constant (`lib/wizard/journey.ts:20`). There is no 30-minute rule and no Settings key.
- **Step keys:** two vocabularies, `QUICK_LOOK_STEPS` and `MOBILE_SCREEN_IDS`, chosen by device. "One per `step_key` in wizard order" needs a mapping first.
- **Link direction:** `wizard_drafts.estimate_id` exists. The brief's `estimates.wizard_session_id` is the same link reversed, and adding it stores it twice.

---

## 4. `estimates`

| Brief | Today |
|---|---|
| `brand` enum `paint_group\|paint_home`, backfill | **Already exists**: text `paintgroup\|painthome`, NOT NULL (M:20270300), also on drafts, WOs, invoices. No account-level brand |
| `view_count` | None; counted from `estimate_views` |
| `resume_count` | None |
| `temperature` hot/warm/cool, `snoozed_until` | **On `accounts`**, hot/warm/**cold**, via `crm_set_temperature` / `crm_snooze`, each also an event |
| `expires_at` | None; `valid_until` was ruled to be it (M:20270175) |
| `sent_by` | `sent_by_user_id` |

Status enum: draft, sent, accepted, declined, expired. There is no `viewed` status; "viewed" is computed.

**The view-count golden test cannot pass today.** `/e/[token]` makes a new session id per mount, so a refresh is a new view. One row per mount; the trigger writes one event, dropped when the estimate has no account. Column ≠ events on those estimates by construction.

---

## 5. Stage already exists

`lib/crm/stage.ts` exports `stageFor`, `LANES`, `Stage`: **14 lanes per account**, derived from facts. `lib/crm/board.ts` adds wizard-bucket lanes. `lib/crm/facts.ts` **caches stage in `crm_account_facts`**. Used by CRM Customers, board, record, sources, search.

- The brief's file name and its `Stage` type collide.
- Its grain differs: account facts vs estimate events. `online_now`, `estimate_sent`, `visit_booked` mean different things in each.
- "No stage value is stored anywhere" is already false.

---

## 6. Work queue

`lib/crm/work-queue.ts` (3,416 lines): kind enum, `KIND_WEIGHT`, `GROUP_OF_KIND`, pure `build*Items`, ranked by bucket then `priorityOf` then age. `app/crm/queue.ts` is the cached door.

The brief's `lib/crm/workQueue.ts` with `value × age` is a **second evaluator**, which `CLAUDE.md` forbids, and it would differ from a tested ranking. It belongs as new kinds in the existing file.

---

## 7. `/estimates` today (for the regression spec)

- **Tabs:** waiting, all, draft, sent, viewed, accepted, declined, expired, wizard (`displayStatus.ts:26`). Default all.
- **Filters:** brand chips, already built; source All/Customers/In-house/History (history excluded from All). Wizard tab: bucket, mode, brand, source chips.
- **Search:** client-side `?q=` across title, customer, address, wizard fields, number.
- **Sort:** fixed `created_at desc`. **There is no sort control**, though the brief says to test one.
- **Rows:** number, customer, brand pill, flag, Pack and Customer editor links, status, journey pill, date, value, action, Capture, Duplicate, Delete. `Viewed N×` already shows in some pill states.
- **Other:** optimistic bulk delete; Waiting tab with hide/undo; read-only `JourneyDrawer`; no pagination; error banner.
- **Existing specs:** `estimates-home`, `estimates-search-typing`, `estimates-viewed`, `estimates-multi-delete`, `delete-`/`duplicate-estimate`, `wizard-buckets`. `e2e/estimates-list.spec.ts` does not exist.

**Roles:** `profiles.staff_roles[]` is used by the dashboard only. `/estimates` is gated by the `staff_access` map (`lib/staff/access.ts`), and all staff hold the same DB rights. "PC cannot open Pipeline or Funnel" and the §5 role table are new work, not reuse. Likewise "nothing leaks (RLS test)" means little while any staff member can read all of `crm_events`.

---

## 8. Estimate detail, thread, reporting

- **Detail page is `/quote?id=`**, not `/estimates/[id]`. Tabs Scope/Pack; panels Activity, Chat, Calculations, Follow-ups.
- **Activity reads `estimate_events`, questions, views and messages, not `crm_events`** (`QuoteBuilder.tsx:1298`). R16 requires a switch of source.
- **No shared thread component.** Chat is inline in `QuoteBuilder.tsx`; `StaffChatDock` and `ActionsClient` are other users. `lib/portal/timeline.ts` is the job timeline, not chat. The brief's "the one shared portal timeline" does not exist.
- **Staff reply** is a direct insert via `postStaffChatReply`, not a thread RPC. `lib/messaging/record.ts` is the single writer of `messages`.
- **"Where estimates go" is built**: `app/(app)/home/FunnelCard.tsx`, `lib/reporting/metrics/funnel.ts`. `lib/reports/` does not exist. Reuse this, or the dashboard gets a second query.
- **Unverified:** nothing was found setting `from`/`sessionId` on `visit_booked`, so the card's Contact → booked may always read 0. Worth its own check.

---

## 9. Hours and settings

- Working hours are hardcoded **three ways**: 08:30–16:30 (`officeHours.ts`), 09–17 (`businessHours.ts`), end of day 17 (`workingDays.ts`). None is the brief's 08:00–17:00.
- Holidays: `settings.visit_booking_rules.publicHolidays`, default empty.
- No `crm.idle_minutes_*` or reply-SLA keys. `settings.crm` thresholds exist (`lib/crm/thresholds.ts`).

---

## 10. Proposed rulings before session 1

| # | Conflict | Proposal |
|---|---|---|
| E‑A | Dotted event names vs the DB CHECK | **Keep underscores.** Reuse existing names; add only the missing ones to the catalogue |
| E‑B | Anonymous events and session filtering | Add nullable `wizard_draft_id` + index on `crm_events`; write anonymous wizard events with no account, and stop those being dropped |
| E‑C | `wizard_sessions` table | **`wizard_drafts`** stays; add missing columns there. No `estimates.wizard_session_id` |
| E‑D | `brand` values, backfill | Keep existing column and `paintgroup`/`painthome`. No migration |
| E‑E | Temperature and snooze | Keep on `accounts` with `cold`. Same person, same value on every estimate they hold |
| E‑F | `expires_at` | Use `valid_until` |
| E‑G | Stage | New estimate-level function in a **new file** (`lib/crm/estimateStage.ts`), built on the existing vocabulary where meanings match. `stageFor` stays for accounts. Needs an explicit line on how the two relate |
| E‑H | Work queue | **New kinds in `lib/crm/work-queue.ts`**, keep its ranking. Drop `value × age` |
| E‑I | Six chips vs nine tabs | Chips sit above; **All estimates keeps its current tabs inside it**, so R2/R14 stays true |
| E‑J | Pipeline, Online now, Work queue already exist elsewhere | New views **share the existing card, bucket and queue code**, so they stay readings of one source |
| E‑K | Detail route | Additions go on `/quote`; no `/estimates/[id]` |
| E‑L | Activity log source | Move to `crm_events` per R16, after a check that nothing currently shown is lost |
| E‑M | Funnel module | Extend `lib/reporting/metrics/funnel.ts`; no `lib/reports/` |
| E‑N | Roles | Real gate is new work: a session of its own, or lower the bar |
| E‑O | Testing law | Each PR opens with a failing anonymous-customer spec, not only session 7 |
| E‑P | Help file | `docs/help/estimates-tab/<role>.md`, not `docs/help/estimates-tab.md` |
| E‑Q | Sort control in the regression spec | Test what exists: fixed newest-first |
| E‑R | Master plan version | **Supply v3, or confirm v2 plus the briefs is the full set** |

Session 1 as written (brand column, `wizard_sessions`, dotted events) would fail or duplicate. Once these are ruled, it shrinks to: catalogue additions, `wizard_draft_id`, step/gate/resume events, `estimate_revised` writer, view-count fix.
