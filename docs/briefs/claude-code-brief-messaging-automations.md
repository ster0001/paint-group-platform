# Claude Code Brief — Messaging & Automations: Filling the Gaps

**Owner:** Tom Roman · **Date:** 16 Sep 2026
**Save to:** `docs/briefs/claude-code-brief-messaging-automations.md`
**Status:** Sessions 1–2 BUILT 16 Sep 2026 (S1 merged 0bf15c6; S2 on `feat/automations-s2-timing`) (branch `feat/automations-s1-control-screen`, migration 20270150). Rulings 16 Sep: the invoicing attention queue = the CRM work queue; `acceptance-to-paid-workflow.md` approved with its defaults; sign-off reminders use the existing 0/24/48 h slots. D1–D12 defaults accepted; every one is editable in Settings.

---

## 0. What we're building, in one paragraph

Every message the platform sends, or should send, becomes something the office can control from one screen: switch it on or off, choose **Text, Email or Both**, choose **Send automatically** or **Office approves first**, set the timing, and edit the wording. On that foundation we add the missing messages: a welcome when a customer says yes, unpaid-invoice reminders, sign-off reminders, painter offer reminders, "starts tomorrow" texts, lead alerts, office cover rules and summaries.

---

## 1. Read first (reference files)

Commit this brief, read these, and **confirm the list back before writing any code**. If any file is missing, STOP and report (CLAUDE.md rule).

| File | Why |
|---|---|
| `CLAUDE.md` | Standards, missing-reference rule, gate-run rule (no migrations mid-run) |
| `docs/briefs/messaging-automations-inventory.md` | What exists today, and the recipe for adding an automation |
| `docs/briefs/acceptance-to-paid-workflow.md` | Invoice reminder ladder. ⚠ Previously missing from the repo; if still missing, STOP Session 3 and report |
| `docs/briefs/work-order-completion-workflow.md` + `claude-code-brief-wo-loop-pc-command.md` | Sign-off rules, deemed sign-off stays OFF, walkthrough flow |
| `docs/briefs/claude-code-brief-invoicing-payments.md` | Invoice states, attention queue (`lib/invoicing/attention.ts`) |
| `lib/automations/registry.ts` + `registry.test.ts` | Automation switches |
| `lib/messaging/config.ts`, `lib/messaging/send.ts` | Templates and the one send path |
| `lib/staff/notify.ts`, `lib/staff/notifyEvents.ts` | Staff alerts and duplicate protection |
| `lib/contractor/notify.ts` | Painter messages |
| `lib/campaigns/*` | Campaign engine, approval queue, send window |
| `lib/agent/gateway.ts` | Existing on-duty roster and escalation (reuse for office cover) |
| `app/api/cron/*`, `vercel.json` | Scheduled jobs |

---

## 2. Rules that apply to every session

1. **One send path.** Everything goes through `lib/messaging/send.ts` and is recorded in `messages`. No module sends on its own.
2. **Every automation is a registry entry.** Its wording has defaults in `DEFAULT_MESSAGING`, the send site checks `automationOn`, and `registry.test.ts` passes.
3. **Every customer send carries its alert type (`ctx.kind`),** so the customer's notification settings are respected.
4. **Once only.** Each message or reminder rung is claimed before sending (per invoice, per offer, per rung), so a sweep running twice never double-sends.
5. **Reminders stop themselves.** A reminder re-checks at send time and cancels once the thing is done (paid, signed, accepted, answered).
6. **Money and dates are never written by AI.** Wording only.
7. **Deemed sign-off stays OFF.** Sign-off reminders use neutral wording and never say the job will be treated as signed.
8. **Test in the test project** (`qarfyjrzgdeoqbnbbxfp`), logged in as the real role.
9. **Help file.** Each shipped screen gets its `docs/help/` page (definition of done).

---

## 3. Sessions

### Session 1 — The control screen (foundation)

**Goal:** every automation, old and new, is controlled from Settings → Automations.

For each automation, the row shows:
- **On / Off**
- **Channel:** `Text` · `Email` · `Both` (only channels that automation supports are offered)
- **Mode:** `Send automatically` · `Office approves first`
- **Timing** fields where relevant (for example "2 days after due")
- **Edit wording:** email subject + body, and text message
  - token picker (`{{first_name}}`, `{{address}}`, `{{start_date}}`, `{{amount}}`, `{{link}}`, etc.) with only the tokens valid for that message
  - live preview filled with a real example job
  - text length counter showing how many SMS parts it will use
  - **Send test to me**
  - **Reset to default wording**

Build:
- Store channel, mode and timing per automation on the messaging settings row, with defaults, so existing behaviour is unchanged until someone edits it.
- **"Office approves first" queue** for job messages: one "Messages to approve" list in Today (reuse the campaign queue design). Approve, Edit then send, or Skip. Content is re-checked at send time.
- **Quiet hours** for automatic customer and painter messages. Held messages go out at the next opening. Painter job offers and payment receipts are exempt (⚑ D1).
- **Daily limit per customer** for automatic job messages, with a list of exempt types (⚑ D2).
- **Missing contact detail:** if the chosen channel isn't possible (no mobile on file), fall back to the other channel and record the fallback (⚑ D3).
- **Bring in the unlisted sends:** tenant access text and CRM record reply are listed as manual (editable wording, no switch). Google Calendar push is listed as a switch.
- **Make office alert wording editable** (the six staff alerts currently have fixed wording).
- **One reminder helper** (`lib/automations/reminders.ts`): define rungs (for example +1, +4, +7, +14 days), claim each rung once, check a "still needed?" condition at send time, and stop. Sessions 3–7 all use it.

**Acceptance criteria**
- Every registry entry appears on the screen with working switch, channel, mode and wording edit.
- Changing channel to Text-only means no email is sent, and the reverse (tested).
- "Office approves first" puts the message in the queue; nothing sends until approved (tested).
- Quiet hours hold a message and release it at the next opening (tested with a fixed clock).
- Daily limit blocks the extra message and records why (tested).
- Test send works for both channels. Preview never shows a raw `{{token}}`.
- Existing automations behave exactly as before with default settings (regression test).

### Session 2 — Timing and housekeeping

- Run the **abandoned-wizard email**, the **trade daily digest** and all new reminders from the existing **30-minute sweep** instead of once a day. Confirm the hosting plan allows it (⚑ D4).
- **Pin times to Melbourne time** so daylight saving (starts 4 Oct 2026) doesn't move evening messages from 6pm to 7pm. Visit reminder stays at 6pm Melbourne all year (⚑ D5).
- **Read-only report back to Tom:** are any campaigns set up in production? Do text replies from customers land in the CRM thread? Is the zero-tick painter catch built? Are painter insurance expiry dates stored? Do we count repeat views of a quote?

**Acceptance:** the wizard email arrives within about an hour of the 45-minute idle point. The trade digest sends at each person's chosen hour. Tests cover a date either side of the 4 Oct change.

### Session 3 — Money and sign-off

| Key | Message | To | Default channel | Default mode | Timing |
|---|---|---|---|---|---|
| `customer_accepted_welcome` | Thanks, what happens next, portal link, deposit link if issued | Customer | Both | Automatic | On acceptance |
| `invoice_reminder` | Friendly reminder → firmer reminder (4 rungs, separate wording each) | Customer (trade: finance contact) | Rung 1–2 Email, rung 3–4 Both | **Office approves first** (first month) | Due +1, +4, +7, +14 days (⚑ D6) |
| `deposit_reminder` | Deposit reminder so the start date holds | Customer | Text | Office approves first | 3 days after issue, then 5 days before start |
| `signoff_reminder` | Please review and sign off (use existing wording in the database) | Customer | Both | Automatic | 0h, 24h, 48h after walkthrough with no signature |
| `variation_reminder` | A change is waiting for your approval | Customer | Text | Automatic | 24h unopened, 48h opened but not signed |
| `contractor_invoice_prompt` | Job signed off, please send your invoice (link) | Painter | Text | Automatic | At sign-off, again +3 days if none |
| `office_signoff_overdue` | Walkthrough done, still not signed after 72h | Office | Email | Automatic | +72h |

**Acceptance:** each reminder stops when paid, signed or submitted (tested). A dispute hold pauses invoice reminders. A payment clears the ladder instantly. Trade invoices go to the finance-only role where one exists. Sign-off wording never implies deemed acceptance.

### Session 4 — Painters

| Key | Message | To | Default channel | Mode | Timing |
|---|---|---|---|---|---|
| `contractor_offer_reminder` | Offer still waiting, expires at [time] | Painter | Text | Automatic | 12h and 20h after offer (⚑ D7) |
| `office_offer_expired` | Nobody answered the offer, job back in the tray | Office (staff alert, per-person choice) | Both | Automatic | On expiry |
| `contractor_job_pack` | Tomorrow's job: address, access, parking, colours, equipment, portal link | Painter | Both | Automatic | 3pm the day before start |
| `contractor_portal_link` | Your job page link | Painter | Text | Automatic | On accepting a job, replacing hand-sharing |
| `contractor_job_changed` | Colours or scope changed, please check and tap to acknowledge | Painter | Text | Automatic | When changed after acceptance |
| `contractor_variation_reminder` | Approved change still waiting on you | Painter | Text | Automatic | 24h after release if not acted on |

**Acceptance:** an offer that is answered cancels its reminders. On expiry the office is told once. The job pack shows "Colours: to be confirmed" if not final. Acknowledgement is recorded on the job.

### Session 5 — Job-day messages for customers

| Key | Message | Default channel | Mode | Timing |
|---|---|---|---|---|
| `customer_starts_tomorrow` | Your painters start tomorrow, [name], arriving about 7:30am | Text | Automatic | 4pm the day before |
| `customer_colours_prompt` | Let's lock in your colours, book your consult | Both | Automatic | 10 days before start if colours not final, repeat at 5 days |
| `customer_estimator_on_way` | [Name] is about [x] minutes away | Text | Manual one-tap in the Diary | — |
| `customer_painters_arrived` | Your painters have arrived | Text | Automatic | First check-in or first tick on day one (⚑ D8) |
| `booking_chase` | Customer: let's get your start date booked. Office: accepted but not booked | Customer: Email; Office: alert | Customer: office approves; office: automatic | Office at 3 days, customer at 5 days (⚑ D9) |
| `start_date_moved` | Upgrade the existing rebooking message to include a reason field the office fills in | Both | Automatic | On rebook |

**Acceptance:** nothing sends for cancelled or rebooked jobs using the old date. "Arrived" sends once per job, not each day.

### Session 6 — Leads and follow-up

- **New campaign trigger `wizard_priced`**, plus a default follow-up campaign: "here's your next step" for customers who got a price online but didn't request a visit or call.
- **Abandoned wizard:** add a Text option (next day if the email wasn't opened).
- **Repeat views:** count quote opens. At 2+ opens with no reply, show a "call now" card on Today and send an optional staff alert `office_hot_estimate`.
- **Struggling in the wizard:** optional "Can we give you a quick call?" text (`wizard_needs_help`), office approves first.
- **Review request:** default **follow-up** campaign on `job_completed` (not marketing, so the one-per-month marketing limit doesn't block it), 3 days after sign-off, with the Google review link. Exits if the customer raises a problem (⚑ D10).
- **Quote follow-up defaults** set up as campaigns (switched off until Tom reviews them): not opened, price expiring in 14 days, declined (ask why with 3 tap reasons), expired (offer a refreshed price), 30-day "how's the paint holding up?", 11- and 23-month warranty checks.
- **New-lead staff alert `office_new_lead`:** a price was reached online, a visit was requested, or a call-back was asked for.

**Acceptance:** the default campaigns exist but are OFF. The review request never goes to a job with an open touch-up or a flagged area. All campaign wording is editable in the same editor style as Session 1.

### Session 7 — Office cover and summaries

- **Chat alerts when no one's watching:** a customer chat message sends a staff alert (`office_customer_message`) if no staff member has the dashboard open within 5 minutes.
- **Slow reply escalation (`office_reply_overdue`):** a customer message unanswered for 2 working hours goes to the on-duty person, then to Tom.
- **Days-off cover:** reuse the assistant's on-duty roster for all staff alerts. On the admin's days off, her alerts go to Tom (⚑ D11).
- **Daily brief (`staff_daily_brief`):** tomorrow's visits, job starts, walkthroughs, offers waiting, and money overdue. Sent at 6pm Melbourne (⚑ D12).
- **Weekly wrap (`owner_weekly_wrap`):** Friday 4pm to Tom. Signed, completed, collected, overdue, and leads in and out.

**Acceptance:** cover rules are tested for a Wednesday and a Monday. The brief and wrap numbers come from the same functions the dashboards use. None are typed separately.

### Session 8 — Full check and handover

- End-to-end run in the test project for **every** automation. Each must:
  - send on the chosen channel;
  - stay silent when switched off;
  - respect the customer's opt-out;
  - be held by quiet hours;
  - go to the approval queue when set to approve first;
  - cancel once resolved;
  - never double-send.
- Update `messaging-automations-inventory.md` so it lists everything as built.
- Help pages for Settings → Automations and the approval queue.
- Report back: a table of every automation with its default channel, mode and timing, so Tom can review before switching the new ones on.

---

## 4. Default wording (English tone, all editable)

- **Welcome:** "Hello {{first_name}}, thank you for choosing Paint Group. Here's what happens next: we'll confirm your painter and start date, then keep you updated at every step. Everything is in your account: {{link}}"
- **Invoice reminder 1:** "Hello {{first_name}}, a quick reminder that invoice {{invoice_number}} for {{amount}} was due on {{due_date}}. You can pay here: {{link}}. If you've already paid, thank you, and please ignore this."
- **Sign-off reminder:** "Hello {{first_name}}, your painting at {{address}} is complete. When you have a moment, please review the finished work and sign off here: {{link}}. Any questions, just reply."
- **Starts tomorrow:** "Hello {{first_name}}, your painters start tomorrow at {{address}}, arriving about 7:30am. Your checklist is here: {{link}}"
- **Painter offer reminder:** "Job offer at {{suburb}} ({{start_date}}) is still waiting and expires at {{expiry_time}}. Accept or decline: {{link}}"
- **Painter job pack:** "Tomorrow: {{address}}, start 7:30am. Access: {{access_notes}}. Colours: {{colour_status}}. Full job page: {{link}}"
- **Review request:** "Thank you for choosing Paint Group, {{first_name}}. If you're happy with the finish, a quick Google review would mean a great deal to our team: {{review_link}}"

---

## 5. Decisions for Tom (defaults in brackets, all editable later)

| # | Decision | Default |
|---|---|---|
| D1 | Quiet hours | 8am–7pm weekdays, 9am–5pm Saturday, none Sunday. Offers and receipts exempt |
| D2 | Daily limit per customer | 3 automatic job messages. Payment and sign-off messages exempt |
| D3 | No mobile on file when Text is chosen | Fall back to email |
| D4 | Hosting plan allows the 30-minute sweep to carry everything | Yes (check before Session 2) |
| D5 | Pin evening messages to Melbourne time | Yes, 6pm all year |
| D6 | Invoice reminder rungs and the first-month approve mode | +1/+4/+7/+14 days, office approves first. **No late fees mentioned** until legal review |
| D7 | Offer reminders and expiry | 12h and 20h. On expiry, alert only (no automatic re-offer). **Tom, 16 Sep (late): no offer reminder between 22:00 and 04:59 Melbourne** — held until 05:00, then re-checked and dropped if the offer has lapsed or been answered. Own window on the row, separate from the office sending hours |
| D8 | What counts as "painters arrived" | First tick or check-in on day one |
| D9 | Booking chase | Office at 3 days, customer at 5 days |
| D10 | Review request timing | 3 days after sign-off. ⚠ Confirm with your adviser that sending it without marketing consent is fine |
| D11 | Days-off cover | Wednesday and Friday office alerts go to Tom |
| D12 | Daily brief | 6pm the evening before, to Tom and the office |

---

## 6. Kickoff message to paste into Claude Code

> Commit `docs/briefs/claude-code-brief-messaging-automations.md`. Read every file in section 1 and confirm the list back to me, noting anything missing. Don't write code until I reply. Then start Session 1.
