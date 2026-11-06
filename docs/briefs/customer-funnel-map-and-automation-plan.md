# Customer funnel map & automation plan — v2
**Paint Group / Paint Home platform — planning document (not yet a build brief)**
Date: 5 November 2026 · Author: Claude (design/strategy) · Owner: Tom
v2 incorporates Tom's ten rulings of 5 Nov 2026 (section 6) and adds the message copy for every automation (Appendix A). Supersedes v1.

> Purpose: agree the stages we track, where customers drop out, and what the platform does about it — before we rebuild the Estimates tab and write the automation briefs.

---

## 0. How this fits the end-to-end platform

The rule locked in September stands: **one event log (`crm_events`), one segment evaluator, one work-queue evaluator — no module builds its own list.** This document names the events, derives the stages from them, and hangs automations off the stages.

```
Website / Meta ad ─▶ Wizard ─▶ Gate (details) ─▶ Range ─▶ Outcome ─▶ Estimate ─▶ Accept ─▶ Job ─▶ Sign-off ─▶ Review/Referral
                                             every arrow = an event in crm_events
                                             every gap   = a drop-out point we measure
                                             every stage = a segment an automation can target
```

| Piece | Where it lives | Status |
|---|---|---|
| Wizard session tracking (buckets A/B/C/C+/D) | `wizard_sessions` + heartbeat — `wizard-progress-crm-buckets-brief.md` | Briefed, partly built |
| Event log | `crm_events` — `claude-code-brief-crm-retargeting.md` rev 2 | Briefed |
| Customer identity | `accounts / account_users / properties` | Built |
| Estimate statuses | draft / sent / viewed / accepted / declined, `expires_at`, `lead_source`, `sent_by`, `presentation_id`, **`brand`** | Built (brand column to add) |
| Messaging | Chat threads in the portal (new primary channel — ruling 1), SMS via Twilio, email via Resend as the *notification* of a chat message | Built, to re-point |
| "Where estimates go" dashboard section | Home dashboard brief v2 | Approved, not built |
| Visit booking | `claude-code-brief-visit-booking.md` + addendum A | Briefed |

---

## 1. Rulings from Tom (5 Nov 2026) — binding on everything below

| # | Ruling |
|---|---|
| R1 | **No automation sends a bare email.** Every written message is sent as a **chat message through the site** (customer's thread in the portal / estimate view), which (a) logs it in the CRM and (b) reads like a person wrote it. The customer gets an email *notification* carrying the message text, from the estimator's name, plain style, no marketing template. Replies land back in the same thread. |
| R2 | The **current estimates list page stays** as a view in the rebuild — it works for searching all estimates. |
| R3 | **Brand-correct sending.** Paint Home messages come from Paint Home (sender name, email domain, SMS sender ID); Paint Group from Paint Group. Estimates carry the correct brand logo at the top of the page. Driven by `estimates.brand` / `accounts.brand`. |
| R4 | **Needs-help and call requests:** during working hours → pops up in the staff chat *and* an email. Out of hours → SMS to Robyn and Tom alerting them to the call-back request, plus an email summary. |
| R5 | Visit done → estimate not sent: flag at **2 days**. |
| R6 | **Deposit chase = one text + one chat message, 3 days before the job start**: deposit is due, job starts on [date]. (Replaces the +3/+7/+14 ladder.) |
| R7 | **Store the shown range on the drop-out event** — low/high only — and surface it in a simple view: drop-out rate by price band. |
| R8 | **SMS quiet hours 8pm–8am only.** Sundays are fine. |
| R9 | **No incentive** at the price-hold stage. |
| R10 | **No approval queue.** Automations live in **CRM → Automations** with an **on/off switch each**; Tom decides when to switch each one on. Every automation's message is **built out in the builder** (copy in Appendix A), editable there. |

---

## 2. The funnel — stages and the events that define them

Stage is **derived from the latest events, never stored**. Temperature and snooze are separate staff-set axes.

### Part A — Before we have their details (anonymous)

| # | Stage | Enters when (event) | Drop-out = | Who can we contact? |
|---|---|---|---|---|
| A1 | **Landed** | Page view (analytics only) | Bounced without typing an address | Nobody — ad retargeting only ⚑1 |
| A2 | **Started** ("Online now") | `wizard.session_started` — address entered | Idle 45 min with no details → bucket C "Dropped" | Nobody unless they return |
| A3 | **Scoping** | `wizard.step_completed` | Idle 45 min on a specific step → we record *which step* | As above |

### Part B — We have their details (lead)

| # | Stage | Enters when | Leaves when | Drop-out = |
|---|---|---|---|---|
| B1 | **Details captured** | `wizard.gate_submitted` (name + contact to see range) | Range shown | Range failed to render |
| B2 | **Range seen, no action** (C+) | `wizard.range_shown` {low, high} with no outcome | Any outcome, or 30 min idle | Saw their price and left. **Prime retarget.** |
| B3 | **Needs help** (B) | `wizard.help_requested` / Contact button / `wizard.message_sent` | Staff reply | No reply within 2 working hours (R4 alerts) |
| B4 | **Tightening** | `wizard.tighten_started` | `wizard.tighten_completed` | Stopped mid-way — record *which room / question* |
| B5 | **Tightened, no action** | `wizard.tighten_completed`, no outcome | Visit/call booked or accepted | Did the work, saw a closer range, left |
| B6 | **Visit requested** (A) | `visit.requested` | Booked / declined | Not answered within 1 working day |
| B7 | **Visit booked** | `visit.booked` | Completed / cancelled | Cancelled / no-show |
| B8 | **Call requested** (A) | `call.requested` ("Speak with us") | `call.completed` | No call within 2 working hours (R4 alerts) |

### Part C — Estimate in play

| # | Stage | Enters when | Leaves when | Drop-out = |
|---|---|---|---|---|
| C1 | **Visit / call done** | `visit.completed` / `call.completed` | `estimate.sent` | Not sent within **2 days** (R5) — ours |
| C2 | **Estimate sent** | `estimate.sent` (`expires_at` +60 d) | Viewed | Never opened |
| C3 | **Estimate viewed** | `estimate.viewed` | Accept / decline / question / expiry | Opened, no reply |
| C4 | **Question asked** | `estimate.question` (chat thread) | Staff reply | > 2 working hours |
| C5 | **Revised** | `estimate.revised` | Viewed again | as C2/C3 |
| C6 | **Declined** | `estimate.declined` (+ reason chip) | — | — |
| C7 | **Expired** | `expires_at` passed (sweep) | — | — |

### Part D — Won

| # | Stage | Enters when | Risk = |
|---|---|---|---|
| D1 | **Accepted** | `estimate.accepted` → deposit invoice created | Deposit unpaid at start −3 days (R6) |
| D2 | **Booked** | `wo.offer_accepted` → customer confirmation | Start slips |
| D3 | **In progress** | `wo.started` | Missed updates (PC console) |
| D4 | **Signed off** | `wo.signed_off` | Final invoice unpaid past terms |
| D5 | **Paid** | `invoice.final_paid` | — |

### Part E — After the job

| # | Stage | Enters when |
|---|---|---|
| E1 | **Review window** | sign-off +1 day |
| E2 | **Referral window** | review left or +7 days |
| E3 | **Anniversary** | sign-off +12 / +24 months |
| E4 | **Lost / cold** | declined, expired, or 90 days no activity |

---

## 3. Inside the estimate journey — the micro-funnel

### 3.1 Interior (v5 mobile, one question per screen)
```
Address ▶ Home/Business ▶ What are we painting ▶ Rooms ▶ Storeys ▶ Occupied? ▶ Ceiling heights ▶ Colours ▶ Condition ▶ Photos
▶ ── GATE: name + contact ── ▶ RANGE ▶ Outcome: Tighten | Speak with us | Book a visit | Send a message
▶ Tighten: per room [size L×W ▶ cupboards/robes ▶ doors ▶ windows ▶ prep/repairs ▶ photos] ▶ hallway sweep ▶ DETAILED RANGE
```
### 3.2 Exterior (v5 mobile)
```
Address ▶ Property type ▶ Storeys ▶ Everything we're painting ▶ Wall materials ▶ Colours ▶ Condition & access ▶ Photos
▶ ── GATE ── ▶ RANGE ▶ Outcome ▶ Tighten: side-by-side walk-around ▶ DETAILED RANGE
```
### 3.3 What we record per step
`wizard.step_viewed` / `wizard.step_completed` with `session_id, step_key, job_type, device, brand, time_on_step, lead_source, answer_summary` (no PII). On `wizard.range_shown` and on any drop-out after it: `range_low_cents, range_high_cents` (R7).

**Simple range view (R7):** the Funnel view shows a bar per price band — $2–4k, $4–6k, $6–9k, $9–12k, $12–18k, $18k+ — with sessions that saw the range vs. sessions that took an action, so the drop-out rate per band is one glance. Exportable to CSV like all list data.

### 3.4 Struggle signals
| Signal | Means |
|---|---|
| Time on step > 3× median | Confusing question |
| Back ≥ 2 on same step | Changed mind / unclear |
| Contact button mid-flow | Wanted a human — step logged |
| Tighten abandoned in room 1 | Measuring too hard |
| Gate submitted → immediate exit | Price shock (now measurable by band) |

---

## 4. Automations

### 4.1 Ground rules
- **Channels are: Chat, SMS, Staff alert.** "Chat" = message posted to the customer's thread + email notification in the estimator's name (R1). No standalone emails to customers.
- **Brand** on every send: sender name, email domain, SMS sender, logo (R3). Same automation keys for both brands, wording per brand where it differs (default: identical copy with the brand name swapped).
- **On/off per automation**, all shipped OFF (R10). No approval queue.
- **Exit conditions** stop a sequence when the customer changes stage (segment re-evaluates on every event).
- **SMS quiet hours 8pm–8am**, every day of the week (R8). A message due in quiet hours sends at 8am.
- **Consent** captured at the gate; anonymous sessions never messaged.
- Every send = `message.sent {automation_key, brand, channel}` → per-automation stats: sent / replied / converted.
- **Staff alerts (R4):** working hours (Mon–Fri 8–5 ⚑2) → staff chat pop-up + email. Out of hours → SMS to Robyn and Tom + email summary. Applies to L9, L10, L13, E8.
- English (not Australian) tone, AUD inc. GST, price always a range.

### 4.2 Lead stage (Part B)

| Key | Trigger | Channel | Purpose | Exit |
|---|---|---|---|---|
| L1 range-reminder | B2 +2 h | SMS | Saved link back to the range | Any outcome |
| L2 range-nudge | B2 +1 day | Chat | Range + three ways forward, what changes the price | Any outcome |
| L3 range-human | B2 +3 days | Chat | Personal line from estimator, offer a call | Reply / outcome |
| L4 range-last | B2 +10 days | Chat | Real finished job near them with price; how soon we can start | → E4 at 90 d |
| L5 tighten-resume | B4 abandoned +1 h | SMS | Resume at `last_step` | Tighten completed |
| L6 tighten-help | B4 +1 day | Chat | Measuring tip, or book a visit instead | Completed / visit booked |
| L7 tightened-close | B5 +4 h | SMS | Closer range ready — book sign-off visit / call | Booked |
| L8 tightened-call | B5 +1 day | Staff task | Estimator calls; phone-closable jobs close on the call | Call logged |
| L9 help-alert | B3, immediately | Staff alert (R4) | Customer waiting | Staff reply |
| L10 visit-request-alert | B6, immediately + 1 working day no reply | Staff alert; customer Chat at +1 day "we're on it" | | Booked / declined |
| L11 visit-reminders | B7 −1 day, −2 h | SMS + calendar invite | Estimator name, 1-hour window, reply to reschedule | Done / cancelled |
| L12 visit-no-show | B7 no-show | SMS | Rebook link | Rebooked |
| L13 call-request-alert | B8, immediately | Staff alert (R4) | | Call logged |

### 4.3 Estimate stage (Part C)

| Key | Trigger | Channel | Purpose | Exit |
|---|---|---|---|---|
| E1 visit-to-estimate-overdue | C1 +2 days (R5) | Staff alert | Estimate overdue for [address] | Sent |
| E2 sent-unopened | C2 +2 days | SMS | Quote's ready link | Viewed |
| E3 sent-unopened-2 | C2 +5 days | Chat + staff task to call | | Viewed |
| E4 viewed-no-reply-1 | C3 +2 days | Chat | Any questions? | Any response |
| E5 viewed-no-reply-2 | C3 +5 days | Chat | Earliest start, warranty, live updates | Any response |
| E6 viewed-no-reply-call | C3 +7 days | Staff task | Estimator calls, logs reason | Logged |
| E7 viewed-no-reply-3 | C3 +14 days | Chat | Still here; price held until expiry — **no incentive** (R9) | Response |
| E8 question-alert | C4, immediately | Staff alert (R4) | | Replied |
| E9 expiry-warning | 7 days before `expires_at` | SMS + Chat | Price valid until [date] | Decision |
| E10 expired | C7 | Chat | Lapsed — reply to refresh | Re-engaged |
| E11 declined-reason | C6, no reason given | Chat | One-tap reason chips | Reason captured |
| E12 declined-timing | C6 reason = timing/not ready, +60 days | Chat | Ready now? | Re-engaged |

### 4.4 Won stage (Part D)

| Key | Trigger | Channel | Purpose |
|---|---|---|---|
| W1 accepted-welcome | D1 | Chat + SMS | Thank you, what's next, deposit link, portal login |
| W2 deposit-due | Job start −3 days, deposit unpaid (R6) | SMS + Chat (one each) | Deposit due; job starts [date] |
| W3 colours-tbc | Start −5 days, colours unconfirmed | SMS | Book colour consult |
| W4 start-reminder | Start −2 days | SMS | Painter name, arrival window |
| W5 daily-update | D3 | PC-approved drafted update (built) | |
| W6 final-invoice ladder | D4 | Per invoicing brief | |

### 4.5 After the job (Part E)

| Key | Trigger | Channel | Purpose |
|---|---|---|---|
| R1 review-request | E1 | SMS | Google review (built in WO loop) |
| R2 referral | E2 | Chat | Refer-and-reward link (customer sends it themselves) |
| R3 anniversary-12 | +12 months | Chat | Warranty check-in + next room |
| R4 anniversary-24 | +24 months | Chat | Warranty ending; exterior re-coat reminder |
| R5 cold-nurture | E4, quarterly max | Chat | Seasonal, real job + price, unsubscribe honoured |

### 4.6 Anonymous (Part A) — not messages
| Key | What |
|---|---|
| A1 pixel-audiences | Meta pixel events on session_started / gate_submitted / range_shown / accepted; audiences *started-not-gated*, *gated-not-actioned*; exclude *accepted* ⚑1 |
| A2 return-cookie | 30-day cookie, "Welcome back — continue your estimate?" |
| A3 step-fix loop | Weekly: top 3 steps by drop-off → design fix (process) |

---

## 5. The rebuilt Estimates tab

Six views:
1. **Pipeline** — columns = stages B2 → C5. Cards: name, address, brand badge, job type, range (AUD inc. GST), stage age, last/next automation, temperature, snooze. No drag-to-stage. Tap → estimate.
2. **All estimates** — the current list page, unchanged (R2): search, filters, status pills.
3. **Online now & dropped** — wizard buckets D/C/C+/B/A with `last_step` visible.
4. **Work queue** — SLA breaches + staff-task automations (L8, E1, E3, E6), ranked by value × age.
5. **Funnel** — step-by-step conversion + **drop-out by price band** (R7), filter by date / brand / device / job type / lead source. Same query feeds the dashboard.
6. **Automations** (CRM → Automations, linked from here) — every key with on/off, channel, brand variants, the message builder, and stats.

**Estimate detail:** stage timeline strip, the chat thread (every automated and manual message in one place — R1), wizard path collapsed below, brand logo in the header (R3).

**Chat thread as the hub:** since every written message is a chat message, the thread *is* the CRM history for that customer. The estimate view, the portal and the staff Estimates tab all render the same thread.

---

## 6. Decisions ⚑ (remaining)

| ⚑ | Decision | Suggested default |
|---|---|---|
| 1 | Ad platforms for funnel events; whose ad account | Meta only (Paint Home campaign) |
| 2 | Working hours for the R4 alert switch | Mon–Fri 8:00–17:00, public holidays = out of hours |
| 3 | Robyn's and Tom's alert numbers → Settings → Staff (alerts on/off per person) | — |
| 4 | Trade/commercial accounts: lighter cadence? | Chat only, no SMS, half the cadence |
| 5 | Which estimator name signs automated chat messages when no `sent_by` is set (e.g. wizard-only leads) | Sarah Reid for Paint Group; ⚑ name for Paint Home |

Resolved 5 Nov: approval queue (none), reply SLA (2 h working), visit→estimate (2 days), deposit chase (start −3 days), range on drop-out (yes, by band), quiet hours (8pm–8am all days), incentive (none), brand wording (same keys, per-brand text).

---

## 7. Build order

1. **Events + brand column** — `wizard.*`, `visit.*`, `call.*`, `estimate.question/revised`; step payload; `estimates.brand`. *(1 session)*
2. **Stage derivation + segment evaluator** — pure function, golden tests per transition. *(1 session)*
3. **Chat-as-channel** — messaging adapter: `sendChat(thread, text, brand)` → thread row + email notification in estimator's name; SMS adapter gets brand sender IDs; staff-alert adapter (R4 routing). *(1 session)*
4. **Estimates tab rebuild** — six views, mockup approved first. *(2–3 sessions)*
5. **Automation engine** — scheduler, on/off, exit-on-stage-change, quiet hours, idempotency, stats. *(2 sessions)*
6. **Automations content** — Appendix A loaded into the builder, all OFF. *(1 session + Tom's wording pass)*
7. **Pixel/audiences** — after ⚑1. *(½ session)*

1–3 can start now; 5–6 after the v5 mobile wizard build finishes so step keys are stable.

---

## 8. Reference files
- `docs/briefs/claude-code-brief-crm-retargeting.md` (rev 2) — **master**
- `docs/briefs/wizard-progress-crm-buckets-brief.md`
- `docs/briefs/messaging-automations-inventory.md`
- `docs/briefs/claude-code-brief-visit-booking.md` + addendum A
- `docs/briefs/claude-code-brief-home-dashboard-v2.md`
- `docs/briefs/claude-code-brief-campaign-studio-referrals.md`
- `docs/briefs/claude-code-brief-invoicing-payments.md`
- Estimator v5 mobile build plan + `estimator-v2-progress.md`
- `estimates-tab-and-automations-mockup.html` (this round's phone mockup)
- Commit this file as `docs/briefs/customer-funnel-map-and-automation-plan.md` today.

## 9. Acceptance (for the plan)
- [ ] Tom confirms the stage list and the six views
- [ ] ⚑1–5 answered or defaulted
- [ ] Appendix A copy approved or edited
- [ ] Mockup approved on phone → Estimates tab brief → automation engine brief

---

# Appendix A — Message copy for the builder

Conventions: `{first_name}` `{address}` `{range}` (e.g. "$6,400–$7,900 inc. GST") `{link}` `{estimator}` `{brand}` `{date}` `{painter}` `{window}` `{expiry}`. Chat messages are plain text, no headings, no images — they must read as if {estimator} typed them. SMS ≤ 2 segments. Every message is editable per brand in the builder; defaults below use `{brand}` so one copy serves both.

### Lead stage

**L1 range-reminder — SMS**
> Hi {first_name}, it's {estimator} from {brand}. Your price range for {address} is saved here: {link}. Open it any time.

**L2 range-nudge — Chat**
> Hi {first_name}, {estimator} here from {brand}. Your range for {address} came out at {range}.
> From here you can tighten the price with a few room details, book a visit, or just reply to this message with any questions. The range moves most with ceiling height, how much prep is needed and whether the house is occupied — so if any of that wasn't quite right, let me know and I'll adjust it.

**L3 range-human — Chat**
> Hi {first_name}, just checking in. Happy to talk through the {address} job if that's easier than the online steps — reply with a good time and I'll call you.

**L4 range-last — Chat**
> Hi {first_name}, one last note from me. We finished a similar job in {showcase_suburb} recently at {showcase_range} — photos here: {showcase_link}. If you'd like to go ahead, we can usually start within {lead_time}. Your range for {address} is still here: {link}.

**L5 tighten-resume — SMS**
> Hi {first_name}, you were {rooms_done} rooms in. Pick up where you left off: {link} — {brand}

**L6 tighten-help — Chat**
> Hi {first_name}, measuring is the fiddly part. If you don't have a tape, one big step is about a metre — walk the long wall then the short wall and type those in. Or skip it entirely and I'll measure on a visit: {visit_link}.

**L7 tightened-close — SMS**
> Hi {first_name}, your closer range for {address} is ready: {range}. Book a time for us to confirm it: {link} — {estimator}, {brand}

**L8 tightened-call — Staff task**
> Call {first_name} ({phone}) — tightened {address} to {range}, no booking yet. Phone-closable: {yes/no}.

**L9 help-alert — Staff alert**
> {first_name} needs help on {address} (step: {step}). "{message}". Reply in thread: {link}

**L10 visit-request-alert — Staff alert / customer Chat (+1 day)**
> Staff: Visit request from {first_name}, {address}, {zone} ({pre-arranged/out of area}). Reply by {due}.
> Customer: Hi {first_name}, thanks for the visit request for {address}. I'm sorting a time and will come back to you by {due}. — {estimator}

**L11 visit-reminders — SMS**
> −1 day: Hi {first_name}, {estimator} from {brand} is visiting {address} tomorrow between {window}. Reply to this message if you need to change it.
> −2 h: Hi {first_name}, {estimator} will be with you between {window} today.

**L12 visit-no-show — SMS**
> Hi {first_name}, we missed each other at {address} today. Rebook here: {link} — {estimator}, {brand}

**L13 call-request-alert — Staff alert**
> {first_name} asked for a call about {address} ({range}). Phone {phone}. Log the call: {link}

### Estimate stage

**E1 visit-to-estimate-overdue — Staff alert**
> {address} visited {days} days ago, estimate not sent. Open: {link}

**E2 sent-unopened — SMS**
> Hi {first_name}, your quote for {address} is ready: {link} — {estimator}, {brand}

**E3 sent-unopened-2 — Chat + staff task**
> Chat: Hi {first_name}, I sent your quote for {address} a few days ago — here it is again: {link}. If it's gone to the wrong place or you'd rather I run through it on the phone, just reply.
> Task: Call {first_name} — quote unopened 5 days.

**E4 viewed-no-reply-1 — Chat**
> Hi {first_name}, I saw you've had a look at the quote for {address}. Anything you'd like changed or explained? Reply here and I'll sort it.

**E5 viewed-no-reply-2 — Chat**
> Hi {first_name}, a couple of things worth knowing before you decide: we can start from {earliest_start}, everything's covered by our 2-year workmanship warranty, and you'll get photos and updates from the painter every day on your {brand} page. The quote's here: {link}.

**E6 viewed-no-reply-call — Staff task**
> Call {first_name} — quote viewed, no reply 7 days. Record reason.

**E7 viewed-no-reply-3 — Chat**
> Hi {first_name}, no pressure at all — your price for {address} is held until {expiry}. If timing's the issue, tell me roughly when suits and I'll pencil it in.

**E8 question-alert — Staff alert**
> {first_name} asked on {address}: "{question}". Reply: {link}

**E9 expiry-warning — SMS + Chat**
> SMS: Hi {first_name}, your {brand} quote for {address} is valid until {expiry}: {link}
> Chat: Hi {first_name}, just a heads-up that the price on your quote is valid until {expiry}. After that I'd need to re-check materials and availability. Happy to extend it if you're close to deciding — just reply.

**E10 expired — Chat**
> Hi {first_name}, your quote for {address} has lapsed. If you'd still like the work done, reply here and I'll refresh the price for you.

**E11 declined-reason — Chat**
> Thanks for letting us know, {first_name}. So we can improve, which was it? [Price] [Timing] [Went with someone else] [Not going ahead] — one tap, no reply needed.

**E12 declined-timing — Chat**
> Hi {first_name}, you mentioned the timing wasn't right for {address} a couple of months ago. If that's changed, here's your quote — I'll refresh the price if anything's moved: {link}.

### Won stage

**W1 accepted-welcome — Chat + SMS**
> SMS: Thanks {first_name} — we've got your acceptance for {address}. Deposit and next steps: {link} — {brand}
> Chat: Thank you, {first_name}. Here's what happens next: the deposit ({deposit_amount} inc. GST) is here {pay_link}; once that's in we'll confirm your start date and your painter; you'll be able to follow the whole job on this page, with photos each day. Any questions, reply here.

**W2 deposit-due — SMS + Chat (start −3 days)**
> SMS: Hi {first_name}, your {address} job starts on {date}. The deposit of {deposit_amount} is due before then: {pay_link} — {brand}
> Chat: Hi {first_name}, we start at {address} on {date} with {painter}. The deposit of {deposit_amount} inc. GST is still outstanding — here's the link: {pay_link}. Once it's through we're all set.

**W3 colours-tbc — SMS**
> Hi {first_name}, we start {address} on {date} and still need your colours confirmed. Book a quick colour consult: {link} — {brand}

**W4 start-reminder — SMS**
> Hi {first_name}, {painter} will arrive at {address} on {date} between {window}. Updates will appear on your {brand} page each day.

### After the job

**R1 review-request — SMS** (existing wording, check brand)
> Hi {first_name}, thanks for having us at {address}. If you were happy with the work, a Google review would mean a lot: {review_link} — {brand}

**R2 referral — Chat**
> Hi {first_name}, if you know anyone thinking about painting, here's your link to share: {referral_link}. If they go ahead, {reward_text}.

**R3 anniversary-12 — Chat**
> Hi {first_name}, it's been a year since we painted {address}. How's it holding up? If anything needs a touch-up under the warranty, reply here with a photo. And if there's another room on the list, your old quote makes a new one quick: {link}.

**R4 anniversary-24 — Chat**
> Hi {first_name}, two years on from {address} — your workmanship warranty finishes on {warranty_end}. If anything needs looking at, now's the time to tell us. {exterior_line}

**R5 cold-nurture — Chat (quarterly max)**
> Hi {first_name}, {seasonal_line}. We just finished one in {showcase_suburb} at {showcase_range}: {showcase_link}. If you'd like a fresh range for {address}, it takes a couple of minutes: {link}. (Reply STOP and I won't message again.)
