# Build brief — Wizard progress, estimate status and CRM buckets

**Repo:** paint-group-platform · **Status:** ready to build after the homepage Session 2 (needs the public wizard prefill from that brief). One session, maybe two.

---

## 0. Read-order (commit, read, confirm the list back before code)

1. This brief — `docs/briefs/wizard-progress-crm-buckets.md`
2. `docs/briefs/customer-estimator-wizard.md` — the wizard's pages, autosave, anonymous `session_token`, the "request a call / book a visit" endings, the AI helper ("Ask a question")
3. `docs/briefs/crm-leads.md` (or whatever the CRM brief is named in `docs/briefs/`) — `leads` table, pipeline stages, lead source attribution, follow-up tasks
4. `docs/briefs/homepage-v2` §4.2 and §5 — `see_price` hands `address` + `mode` to `/estimate`; event names
5. `CLAUDE.md` — standards. Missing reference = STOP and report.

---

## 1. What this is

Today an estimate exists once the wizard reaches a price. Everything before that — a visitor who typed an address, answered three pages and left — is invisible to Tom. This brief makes every wizard session a **lead with a status**, visible in two places:

- **Estimates page (staff):** each row shows the customer's wizard status — completed and asked for a call/visit, or started and stopped, with where they got to and how long they spent.
- **CRM:** every session lands in one of four buckets automatically, so Tom's follow-up list writes itself.

Nothing here changes what the customer sees, except that "Ask a question" and "Request help" now create a follow-up on our side.

---

## 2. Data model

### 2.1 `wizard_sessions` (new)
One row per wizard start. Created on first autosave (address entered or first answer), not on page load — a visitor who lands and bounces is analytics, not a lead.

| column | type | notes |
|---|---|---|
| id | uuid | |
| estimate_id | uuid → estimates | the draft this session is building (created at the same moment) |
| lead_id | uuid → leads, nullable | set the first time the session is bucketed (see §4) |
| session_token | text | anonymous token from the wizard brief; null once claimed by an account |
| account_id | uuid nullable | set on claim |
| mode | enum `home \| business` | from the hero chip / wizard choice |
| entry_source | text | `homepage_hero \| homepage_cta \| job_page:<slug> \| direct \| suburb:<slug>` — from the `see_price` handoff; extend, don't invent |
| current_step | text | wizard page key the customer is on (`address`, `property`, `areas`, `surfaces`, `condition`, `photos`, `price`, `confirm`) |
| furthest_step | text | highest page reached |
| steps_total, steps_answered | int | for "6 of 8" |
| completed | bool | all required questions answered and a price shown |
| outcome | enum `none \| call_requested \| visit_requested \| question_asked \| help_requested` | last customer action, see §3 |
| outcome_at | timestamptz | |
| started_at, last_active_at | timestamptz | |
| active_seconds | int | see §2.3 — time actually on the page, not wall-clock |
| step_times | jsonb `{[step]: seconds}` | time per page |
| dropped | bool | set by the bucketing job (§4.3), never by the client |
| bucket | enum (see §4) | the CRM bucket, denormalised for list views |

RLS: row readable by its `session_token` holder or account owner (customer side — the wizard already does this for `estimates`), and by staff. Client writes only through the existing autosave server action, which now updates this row in the same transaction as the estimate draft.

### 2.2 `estimates` — one added column
- `wizard_session_id` uuid → wizard_sessions. Staff views join through it.

### 2.3 Time on page — how it's measured
- The wizard heartbeats every 15s **only while the tab is visible and there has been input or scroll in the last 60s**. Each heartbeat adds 15s to `active_seconds` and to `step_times[current_step]`. Tab hidden, idle for a minute, or closed → no heartbeat. So "on the page for 9 minutes" means nine minutes of actual attention.
- Heartbeat is a tiny `POST /api/wizard/heartbeat {session_id, step}`, rate-limited per session, same server action pattern.
- AC: [ ] leaving a tab open overnight adds at most 60s; [ ] `step_times` sums to `active_seconds` ± 15s.

---

## 3. Customer actions that set `outcome`

These already exist in the wizard; this brief only wires them:

| action in the wizard | outcome | completed? |
|---|---|---|
| Finishes all required questions, sees price, taps **Request a call** | `call_requested` | true |
| Finishes, sees price, taps **Book a site visit** (or the visit-booking module) | `visit_requested` | true |
| On any page, uses **Ask a question** (the AI helper) and the helper escalates or the customer taps "talk to a person" | `question_asked` | either |
| On any page, taps **Request help** / "I'm stuck, call me" | `help_requested` | either |
| Nothing | `none` | either |

⚑ D1 — a customer who completes every question and sees the price but does **not** request a call or visit: does that count as "completed, no request" (bucket C-like, but warmer) or do we treat the price step itself as a soft request? Brief assumes a fifth state `completed_no_request` inside bucket C with its own label, because it's the warmest cold lead there is.

---

## 4. CRM buckets

Every `wizard_session` maps to exactly one bucket. Bucketing runs (a) immediately on any `outcome` change, and (b) on a 30-minute scheduled job for drop-outs. The bucket is written to the session **and** creates/updates the `leads` row so the CRM pipeline is the source of truth.

| bucket | rule | lead stage | follow-up task created |
|---|---|---|---|
| **A · Ready — call or visit requested** | `completed = true` and `outcome ∈ {call_requested, visit_requested}` | `Ready to confirm` | `Call {name} — confirm price` due in 4 business hours (call) / `Book visit` (visit) |
| **B · Needs help** | `outcome ∈ {question_asked, help_requested}` and not in A | `Needs help` | `Reply to {name} — stuck at {step}` due in 2 business hours, with the question text attached |
| **C · Dropped out** | `completed = false`, `outcome = none`, and `last_active_at` older than **45 minutes** (⚑ D2) | `Dropped — {step}` | none automatically; appears in the "Dropped this week" list; the existing 24h/72h nudge emails still send if we have an email |
| **C+ · Priced, no request** | `completed = true`, `outcome = none`, idle > 45 min | `Priced, no request` | `Follow up {name} — saw ${range}` due next business morning |
| **D · Online now** | none of the above (active in the last 45 min) | `Online now` | none — they're in the wizard right now, not a lead yet |

- A session moves **forward only** on customer action (D→B→A), and to C/C+ by time. A later customer action pulls it out of C/C+ into A or B and reopens the lead.
- If we have no name or contact yet (early drop-out), the lead shows the address and `Unknown` — an address is a lead in this business.
- Bucket **D1 detail**: every lead row carries `furthest_step`, `steps_answered/total`, `active_seconds`, and `step_times` so Tom can see "got to Surfaces, 6 of 8, 7 min, spent 3 of them on Condition".

### 4.1 Dedupe
One address + one `session_token` (or account) = one lead. A returning visitor who restarts the wizard for the same address reuses the session and lead; a new address is a new lead. Two sessions from the same email merge on claim.

### 4.2 Lead source
`entry_source` becomes the CRM lead source verbatim, so "homepage hero" vs "job page: exterior-weatherboard-thornbury" is reportable. This is what the subdomain test reads.

### 4.3 Scheduled job
Vercel cron every 30 min: sessions with `bucket = D` and `last_active_at < now() − 45 min` → C or C+. Idempotent, logged, ≤ 500 rows per run.

---

## 5. Estimates page (staff)

Add a **Wizard status** column and a filter, driven by `wizard_sessions`:

- Pill: `Ready · call` / `Ready · visit` (emerald), `Needs help` (amber), `Dropped · Surfaces` (clay), `Priced · no request` (amber outline), `Online now` (muted, with a live dot).
- Beneath the pill, one mono line: `6 of 8 · 9 min · last active 2h ago`.
- Row drawer gains a **Journey** section: step-by-step list with time per step, the outcome, the question text if any, and entry source. Read-only.
- Filters: bucket, entry source, mode, date range. Default sort for `Ready`: oldest request first.

AC: [ ] a session with no estimate price yet still appears (draft estimates already list; this adds the pill); [ ] filter "Ready" shows only bucket A; [ ] the drawer's step times sum matches `active_seconds`.

---

## 6. CRM

- Pipeline view gains the five stages in §4 as columns (or as a saved filter set if the pipeline is stage-fixed — follow the CRM brief's pattern; don't fork it).
- Lead card shows bucket pill, address, mode, `furthest_step`, time, entry source, and the open task.
- **Dropped this week** list: bucket C grouped by `furthest_step` with counts, so Tom can see which wizard page loses people. This is also the product signal for the wizard — link to it from the wizard brief's metrics section.
- Tasks: created via the existing follow-up task mechanism, assigned to the owner role by default (⚑ D3 for ops/sales assignment once that exists).

AC: [ ] every wizard session older than 45 min has a lead in exactly one bucket; [ ] completing the wizard and tapping Request a call produces a Ready lead and a task within 5s; [ ] restarting the same address reuses the lead; [ ] the Dropped list's counts reconcile with `wizard_sessions`.

---

## 7. Privacy and honesty

- Heartbeats and step times are first-party product data, not marketing analytics; no consent gate. The privacy policy needs a line: "We record how far you get in the estimator and how long you spend, to follow up if you get stuck." ⚑ D4 — Tom to approve the sentence.
- Customer-facing copy never references being watched. The follow-up email for bucket C stays as the wizard brief wrote it ("Your estimate is saved — pick up where you left off").
- The AI helper's question text is stored on the lead for the human reply; it is not fed back into the helper's prompt.

---

## 8. Tests and done

- Unit: bucketing function — table-driven over every combination of `completed × outcome × idle`.
- Integration: autosave + heartbeat write the session in one transaction; cron moves D→C; action moves C→A and reopens the lead.
- e2e (anonymous, mobile): start wizard from homepage → answer three pages → close tab → advance clock 46 min → cron → lead in `Dropped · Areas` with `3 of 8` and time > 0. Second e2e: complete → Request a call → Ready lead + task.
- Done when: all ACs green; Tom opens the estimates page, sees pills on real sessions, opens the CRM and finds the same sessions in buckets; the Dropped list shows a page breakdown.

---

## 9. Flagged decisions

| # | Decision | Assumed |
|---|---|---|
| D1 | "Completed, saw price, no request" — bucket C or its own warm bucket? | Own bucket C+ with next-morning task |
| D2 | Idle threshold before a session counts as dropped. | 45 minutes |
| D3 | Who gets the follow-up tasks once ops/sales roles exist. | Owner |
| D4 | Privacy policy sentence about recording progress and time. | Wording in §7 |
| D5 | Should bucket C get an automatic SMS as well as the existing email nudges? | No — email only, until the phone-close tier is live |

> Naming note: the wizard bucket is **Online now**, never "In progress" — that label belongs to jobs on site, and the two must never appear in the same pill colour or wording anywhere in the staff UI.
