# Messaging automations — inventory (as built, 16 Sep 2026)

> **Session 1 (16 Sep, evening) changed the plumbing:** every automatic row below now goes through `lib/automations/dispatch.ts` — channel (Text/Email/Both), "office approves first", sending hours (8–7 weekdays, 9–5 Sat, none Sun) and the 3-a-day cap are Settings → Automations controls; held or pending messages sit in `automation_holds` and surface at CRM → Messages to approve. Three sends were added to the registry (tenant access text, CRM record reply, Google Calendar push) and the six staff alerts have editable wording. Section 6 items 6 and 8 are done; the rest stand.

Every message the platform sends to customers, contractors (painters) and staff, taken from
the code on `main`. Source of truth for the switchable ones is `lib/automations/registry.ts`,
rendered at Settings → Automations. Each automatic send asks `automationOn(cfg, key)` first;
manual ones are listed but not gated. Templates live on the `messaging` settings row
(`lib/messaging/config.ts`, `DEFAULT_MESSAGING`). Every send goes through
`lib/messaging/send.ts` (email = Resend, SMS = Twilio) and is recorded in `messages`.

Legend — **auto** fires on an event; **manual** a person presses Send; **planned** recorded
but nothing is sent; **⚠** a caveat worth knowing before building on it.

---

## 1. Customers

| # | Key | Message | Channel | Kind | Trigger | Guard / notes |
|---|-----|---------|---------|------|---------|---------------|
| 1 | `estimate_send` | Estimate sent | email + SMS | manual | Send in the estimate builder. Templates pre-fill the dialog. | Logged on the estimate activity feed. Templates: `emailSubject`, `emailIntro`, `smsTemplate`. |
| 2 | `estimate_chat_reply` | Reply on the estimate chat | email + SMS | auto | Staff post a reply on an estimate's chat — from the builder, the staff dock, or an emailed reply to the alert below (20 Sep). | Templates: `chatReplySubject`, `chatReplySms`. One implementation: `lib/estimates/chatReply.ts`. |
| 2b | `office_estimate_chat` | Customer wrote on the estimate chat (office alert) | email + SMS | auto | A customer sends a chat message from their estimate (20 Sep). Per-person routing under Staff logins (**Customer chat message**); nobody routed → the office address is emailed. | Once per message (`staff_notifications`). Templates: `officeEstimateChatSubject`, `officeEstimateChatBody`; `{{hours_tag}}` / `{{hours_line}}` say when it came outside Mon–Fri 08:30–16:30. The customer's box shows the after-hours note client-side. |
| 3 | `wizard_saved_link` | Estimate saved — sign-in link | email | auto | Customer finishes the online wizard and gets a price. | Skipped if already signed in. Templates: `wizardSavedSubject`, `wizardSavedBody`. |
| 4 | `wizard_abandoned` | Abandoned wizard — pick up where you left off | email | auto | Wizard run idle 45 min with an email on it. Sent by the wizard sweep (cron every 30 min) and whenever staff open CRM Today or Estimates → Wizard. | One link per run. Never to a run without an email or to a test address. Templates: `wizardResumeSubject`, `wizardResumeBody`. |
| 5 | `visit_confirmation` | Visit booked — confirmation email (+ .ics when Google is not sending the invitation) | email (+ .ics) | auto | Estimator visit booked (by the customer online — S3 — or office on the record / Diary). Move = updated invite; cancel = pulls it. | One per booking and per move, recorded on the visit. Templates: `visitConfirmSubject`, `visitConfirmBody` with `{{invite_line}}` (S7, 7 Oct): when the estimator's Google Calendar can write visits, Google sends the invitation and this email carries NO second .ics — it names the sender to expect (`{{company_email}}`), because Gmail flags a first invitation from info@ as "unknown sender". |
| 6 | `visit_reminder` | Visit reminder text | SMS | auto | Evening before an estimator visit. Rides the wo-sweep at 6 pm Melbourne all year (Session 2). | Once per visit; a moved visit is reminded again. Template: `visitReminderSms`. |
| 5a | `visit_code` | Text code to book a visit | SMS | manual, always on | Customer picks a site-visit time online (visit booking S3). Never held, never approved, outside the cap. | One per hold + 3 resends; 5 per mobile and 15 per address every 10 min (`visit_code_sends`). Template: `visitCodeSms`. `lib/visits/holds.ts`. |
| 5b | `visit_booked` | Visit booked — text | SMS | auto | Customer confirms the visit with the code (S3). The confirmation email is row 5. | Once per booking. Template: `visitBookedSms`; `visit_when` reads "Monday 5 October, 2:00 pm to 3:00 pm" (R32); names the invitation's sender (`{{company_email}}`, S7). |
| 5c | `request_received` | Request received — email | email | auto | Customer asks for a visit before the range, or requests a time (pre-arranged, none suit, nothing free, unmapped) — visit booking S4. | Once per request. Templates `requestReceivedSubject/Body`. `lib/visits/requests.ts`. |
| 5d | `call_request_received` | Call request received — email | email | auto | Customer taps Speak with us on the guide range (S4, R25). Server-checked against the R34 caps. | Once per request. Templates `callRequestReceivedSubject/Body`. |
| 5e | `time_offered` | Time offered by staff — text and email (+ .ics via row 5) | SMS + email | auto | Staff answer a request by booking a time on /crm/visit-requests/[id] (S4, §4.4). No text code. | Once per offered visit. Templates `timeOfferedSms`, `timeOfferedSubject/Body`. |
| 5f | `customer_message` | Customer message — email to the office, copy to the customer | email | manual, always on | Customer sends a message from the wizard or the range (S4, R26/R35). The message itself is posted into the estimate chat (after the range) or the website chat (before it). | One per message; a retry with the same client id is not sent again (`customer_message_receipts`). Templates `customerMessageSubject/Body`. |
| 5g | `visit_cancelled` | Visit cancelled — text | SMS | auto | The guest declined the Google Calendar invitation, or the estimator deleted the visit in Google (S5, R22/R27). The visit is cancelled in the platform; the cancel email (row 5, METHOD CANCEL) goes too. | Once per cancelled visit. Template `visitCancelledSms`. `lib/gcal/inbound.ts`. |
| 7 | `appointment_confirmation` | Booking confirmed | email | auto | Job booked in — painter accepts the offer, or office assigns directly. wo-sweep re-checks recent acceptances (3 days) as a backstop. | Once per booked start date; a re-book sends again. Templates: `apptConfirmSubject`, `apptConfirmBody`. |
| 8 | `pre_start_checklist` | Pre-start checklist | email | auto | Office ticks "Pre-start checklist" on the job; wo-sweep sends it N days before start. | Once per job. Templates: `preStartDaysBefore`, `preStartSubject`, `preStartBody`. |
| 9 | `walkthrough_invite` | Final walkthrough calendar invite | email + .ics | auto | Walkthrough booked, moved or cancelled. Customer AND painter each get a self-updating invite. | Only when date/time actually changed. Templates: `walkthroughInviteSubject`, `walkthroughInviteCustomerBody`, `walkthroughInvitePainterBody`. |
| 10 | `customer_update` | Progress update (with photos) | email + SMS | manual | wo-sweep DRAFTS a day's update from the day's ticks; office approves and sends from the Projects console. | Sweep never sends unapproved. `lib/workorder/sendUpdate.ts`. |
| 11 | `variation_signature_request` | Variation — please sign | email + SMS | manual (email fires the moment it is priced; text is a deliberate tap) | A priced change is sent for signature. | `app/quote/revisionActions.ts`. Same rails as estimates. |
| 12 | `signed_completion_report` | Signed completion report | email + PDF | auto | Customer signs off (painter's device or remotely). | Also copied to the property's assessor if on file. Templates: `signedReportSubject`, `signedReportBody`. |
| 13 | `invoice_issued` | Invoice issued | email + SMS | manual | Issue and send from Invoicing (deposit, progress, final, variation). | `lib/invoicing/sendInvoice.ts`. |
| 14 | `payment_receipt` | Payment receipt | email | auto | Payment recorded (office, or card via payment page). | Templates: `receiptSubject`, `receiptBody`. |
| 15 | `portal_magic_link` | Sign-in link | email | manual, always on | Customer asks to sign in to their account. | No switch — without it nobody can get in. `lib/portal/auth.ts`. |
| 16 | `external_approval` | External approval request | email | auto | Trade customer sends an estimate to an approver / assessor / owner; sender is emailed the decision. | Off = link still created, just not emailed. `app/account/(portal)/approvals/actions.ts`, `app/a/[token]/actions.ts`. |
| 17 | `trade_daily_digest` | Trade daily digest | email | auto | Once a day per trade-organisation admin, at the hour each person picks under Team. | Scheduled hourly since Session 2 (16 Sep). |
| 18 | `campaigns` | Marketing / follow-up campaigns | email + SMS | manual approval | Campaign sweep (cron every 30 min) enrols and QUEUES steps; a person approves in CRM → Campaigns queue. Approved-but-held steps are then sent by the sweep inside the window. | See §4 for the engine rules. |
| 19 | — (not in registry) | Tenant access text | SMS | manual | Trade customer sends a tenant a link from the portal quote page. | `app/account/(portal)/quote/[id]/tenant/actions.ts`. Link expires after TENANT_LINK_DAYS. |
| 20 | — (not in registry) | Reply from the CRM record | email + SMS | manual | Staff send a reply from the customer record. | `app/crm/recordActions.ts` `sendReply`. Recorded, routed, delivery-tracked. |
| 21 | `signoff_reminder` | Sign-off reminders | email + SMS | auto | 0h / 24h / 48h after the completion pack goes out, unsigned (Session 3). | The DB ladder records the rung; the sweep sends it once. Stops at signature. |
| 24 | `customer_accepted_welcome` | Welcome — what happens next | email + SMS | auto | On acceptance (Session 3). | Once per estimate. |
| 25 | `invoice_reminder` | Unpaid invoice reminders | email (+ SMS on 3–4) | auto, **office approves first** | Due +1/+4/+7/+14 days (Session 3). | Stops on payment; `invoices.chase_hold_reason` pauses. Trade: finance seat. |
| 26 | `deposit_reminder` | Deposit reminder | SMS | auto, office approves first | +3 days after issue, 5 days before start (Session 3). | Stops when paid. |
| 27 | `variation_reminder` | Variation waiting — reminder | SMS | auto | 24 h / 48 h after priced (Session 3). | Stops on answer. |
| 22 | `review_request` | Review request | — | **planned** | After sign-off. | Recorded as a follow-up task only. (A `job_completed` campaign trigger could carry it — see §4.) |
| 23 | `booking_chase` | Booking chase | — | **planned** | Accepted estimate with no booking. | CRM board card only; no message. |

### Customer-side controls
- **Customer alert settings** (portal → Notifications, `accounts.notify_prefs`): five types the customer can switch off per channel — Estimates, Visits, Property & job updates, Invoices & payments, Replies to your messages. Enforced in `lib/messaging/send.ts` by the send's `ctx.kind`. Untagged sends (sign-in links, office mail, campaigns) are never checked. Unset = on.
- **Marketing permission** is separate: `permit_email` / `permit_sms` on the account, set from the portal (provenance `portal`) or by staff in the CRM.
- **Inbound SMS STOP / START** (`lib/campaigns/inboundSms.ts`, Twilio webhook): whole-message keyword match writes `marketing_unsubscribed_at`. Not a substring match.
- **Reply routing**: with `REPLY_DOMAIN` set, email replies come back into the CRM thread (`reply+<token>@…`). SMS delivery receipts land on `/api/sms/status`.

---

### Gaps shown by the estimate's live-progress example (Tom, 19 Sep 2026 — to be built, not blocking that build)

The example phone on the customer estimate (`docs/briefs/claude-code-brief-estimate-live-progress-v4.md`) shows two customer texts that no automation sends today:

| Gap | Message | Channel | Nearest existing row |
|---|---|---|---|
| Arrival text | "Good morning {first_name}. {lead} and the team have arrived at {street_address}. Follow today's progress: {link}" (commercial: "signed in on site at 6:30am") | SMS | none — #7 confirms the booking days earlier; nothing fires on the morning the crew arrives |
| Job finished / walkthrough text | "{first_name}, {street_address} is finished. Your walkthrough with {lead} is at 2pm today." | SMS | #9 sends a calendar invite when the walkthrough is booked; #12 sends the report after sign-off; nothing says "finished, walkthrough today" |

## 2. Contractors (painters)

| # | Key | Message | Channel | Kind | Trigger | Guard / notes |
|---|-----|---------|---------|------|---------|---------------|
| 1 | `contractor_offer` | Job offer | SMS + email | auto | Job offered, re-offered or reassigned. Holds 24 h. | Text needs a mobile on the painter profile (`contractors.phone`); email = login address. Templates: `offerSms`, `offerEmailSubject`, `offerEmailIntro`. `lib/contractor/notify.ts`. |
| 2 | `variation_auto_release` | Approved variations go straight to the painter | (switch, not a message) | auto | Customer signs a priced addition. On: lands on painter's home page at once. Off: office releases from the job page. | Lives in SQL (`wo_loop_setting('variationRelease')`); the Automations screen just exposes the switch. |
| 3 | `contractor_variation_released` | Variation waiting on you | SMS | auto | Approved variation released to the painter (auto at signing, or by office). | Once per variation. Template: `variationReleasedSms`. |
| 4 | `contractor_qa_fail` | Quality check — put right | SMS | auto | Office records a failed quality check. | Once per check. Template: `qaFailSms`. |
| 5 | `contractor_remittance` | Remittance advice | email + PDF | auto | Office marks a painter's invoice paid. | Templates: `remittanceSubject`, `remittanceBody`. |
| 6 | `walkthrough_invite` (painter copy) | Final walkthrough calendar invite | email + .ics | auto | Same event as customer #9. | Template: `walkthroughInvitePainterBody`. |
| 7 | — (not in registry) | Google Calendar push | GCal event | auto | Booked jobs pushed to the contractor's Google Calendar as 07:30–15:30 blocks; per-action pings, with a wo-sweep reconcile as backstop. | `lib/gcal/sync.ts`, `lib/gcal/ping.ts`. Not a message, but a contractor-facing automation. |
| 9 | `contractor_invoice_prompt` | Job signed off — send your invoice | SMS | auto | At sign-off, again +3 days if still a draft (Session 3). | Stops when submitted. |
| 10 | `contractor_offer_reminder` | Job offer still waiting — reminder | SMS | auto | 12 h and 20 h after `booking_offers.offered_at` while the offer is still `offered` and unexpired (Session 4, D7). Runs in the half-hour campaign sweep (`lib/automations/sweeps/moneySignoff.ts` `offerReminders`). | Each rung claimed once per offer; an answered, withdrawn or expired offer cancels what is left (`stillNeeded`). Own night window: nothing 22:00–04:59 Melbourne — a due rung is held UNCLAIMED for the first sweep after 5 am, then re-checked. Exempt from the office sending hours and the daily cap. Template: `offerReminderSms` (suburb, start date, expiry time, `/portal/requests` link). Text needs a mobile on the painter profile. |
| 11 | `contractor_standards_invite` | Finish standards — please read and confirm | SMS + email | manual | The office presses **Send standards invite** on a painter (Contractors page, or "Invite N to confirm the standards" for everyone not yet invited). Records the invite and starts the grace period (`standards_invite`, Settings → `standards_rules.graceDays`, default 7) whether or not the message goes. New painters are invited the moment they join, with no message — the sign-off is their first screen. | Templates: `standardsInviteSms`, `standardsInviteEmailSubject`, `standardsInviteEmailIntro`. `lib/standards/notify.ts`. Outcome on `contractor_events` (`standards_invite_sent`). |
| 12 | `contractor_standards_reminder` | Finish standards — reminder | SMS | auto | Days 2, 4 and 6 after the invite at 9 am Melbourne (`standards_rules.reminderDays` / `reminderHour`) while unsigned; runs in the half-hour campaign sweep (`lib/automations/sweeps/standardsReminders.ts`). Also the PC queue card's **Send reminder text** and the painter page's button (rung `office`). | One claim per (painter + invite instant, rung) in `automation_claims`; stops the moment the six sections are confirmed (`stillNeeded`). Template: `standardsReminderSms`. |
| 13 | `contractor_standards_confirmed` | Finish standards — your copy | email + PDF | auto | The painter ticks the sixth section. The PDF is rendered from the standards data (`lib/standards/pdfHtml.ts`), saved as a `contractor_documents` row (kind `standards`) and attached. | Once per painter per version — the document row is the guard. Templates: `standardsConfirmedEmailSubject`, `standardsConfirmedEmailIntro`. |
| 14 | `contractor_standards_new_version` | Finish standards — updated, confirm again | SMS + email | auto | `standards_publish_version` publishes a MATERIAL version: every painter not confirmed on it is re-invited with the same grace, and the next sweep sends this once. | Claimed per (painter, version). Templates: `standardsNewVersionSms`, `standardsNewVersionEmailSubject`, `standardsNewVersionEmailIntro`. |
| 8 | — (not a send) | Offer expiry | — | auto | wo-sweep (and every board load) expires offers nobody answered in 24 h; job drops back to the unscheduled tray. | No message to the painter; the office is told via `office_job_declined` only if they actively decline. |

Painter portal links (`/w/[token]`, `/crew/[token]`) are shared by hand; no automated send.

---

## 3. Staff / office

All six event alerts are one automation switch each (registry key = event key) AND per-person
delivery: each staff member ticks which events they want, by email and/or SMS, under
Settings → Staff logins → Staff alerts (`profiles.staff_notify`, `lib/staff/notifyEvents.ts`).
A `staff_notifications` row is claimed per (event, entity) BEFORE sending, so a webhook
redelivery never tells anyone twice. `lib/staff/notify.ts`.

| # | Key | Message | Channel | Trigger | Notes |
|---|-----|---------|---------|---------|-------|
| 1 | `office_estimate_accepted` | Estimate accepted | email (+ per-person SMS) | Customer or trade approver accepts. | Office address `messaging.officeEmail` always gets it (templates `acceptedOfficeSubject`, `acceptedOfficeBody`); staff who ticked it also get it, minus the office address. Guard `office_accept_notified` on `estimate_events`. `lib/estimate/acceptedNotify.ts`. |
| 2 | `office_job_accepted` | Job accepted by the painter | email + SMS | Painter accepts (or accepts with a new date proposed). | Once per offer. Fixed wording. |
| 3 | `office_job_declined` | Job declined by the painter | email + SMS | Painter declines; job back with the office. | Once per offer. Fixed wording. |
| 4 | `office_invoice_paid` | Invoice paid | email + SMS | Payment recorded against a customer invoice. | Once per payment. Fixed wording. |
| 5 | `office_variation_raised` | Variation raised | email + SMS | Painter raises a variation from their portal. | Once per variation. Fixed wording. |
| 6 | `office_contractor_invoice` | Contractor invoice submitted | email + SMS | Painter submits an invoice / payment claim. | Once per invoice. Fixed wording. |
| 10 | `office_signoff_overdue` | Sign-off overdue | email + SMS | Completion pack out 72 h, unsigned (Session 3). | Once per job. |
| 7 | `assistant_handoff` | Assistant — someone wants a person | SMS | Customer in the assistant chat asks for a human inside support hours → on-duty roster texted. A claim past the SLA → escalation list texted. | Roster, hours and SLA under Admin → Assistant. Off = the handoff card still appears in Today → Messages. `lib/agent/gateway.ts`, `app/api/agent/website/route.ts`. |
| 8 | — (in-app, not a send) | Staff chat dock | Realtime + chime | Customer message on an estimate chat. | Browser only; no email/SMS to staff. |
| 14 | — (in-app, work queue) | Customer declined the visit | screen | `visits.cancel_reason = declined_invitation` in the last 30 days (S5, R22). | Kind `visit_declined`, dismissable. |
| 15 | — (in-app, work queue) | Visit moved in Google | screen | A `staff_gcal_events` row whose `google_start` differs from the visit's start (S5, R27). Nothing changed in the platform. | Kind `visit_moved_in_google`; cleared by moving the visit on the Diary (the sweep sees them agree) or dismissing. |
| 16 | — (in-app, work queue) | Google Calendar sync failing / not connected | screen | `staff_gcal_connections.sync_error` set; or, with Booking rules → calendar required, a zone's estimator with no connection that can write visits (S5, 4.6). | Kinds `gcal_sync_failed`, `estimator_calendar_missing`; action → Diary → Google Calendar card. |
| 12 | — (in-app, work queue) | Visit / call request waiting | screen | A `visit_requests` row with no `answered_at` (S4). Due at the end of the next working day, public holidays excluded. | Kind `visit_request`; action → /crm/visit-requests/[id] (offer a time / mark answered). No message is sent to staff. |
| 13 | — (in-app, work queue) | Next year's public holidays missing | screen | From 1 November, Booking rules has no dates for next year (S4, §4.4). | Kind `holidays_next_year`; action → Settings → Booking rules. |
| 11 | — (in-app, work queue) | Unmapped suburb | screen | A customer's address names a Victorian suburb the visit-zones list does not know (`visit_unmapped_suburbs`, written by `lib/visits/zones.ts` `resolveZone`). | Visit booking addendum A S1 (5 Oct 2026). Derived item, kind `unmapped_suburb`, due next business morning; cleared when the suburb is added under Settings → Visit zones. No message is sent. |
| 9 | — (in-app) | CRM work queue / Today cards | screen | Derived from `crm_account_facts` (followup_due, waiting, lapsed, accepted-not-booked, wizard drop-outs). | Refreshed by crm-sweep every 30 min. No message goes out; these are the prompts a human acts on. |

---

## 4. The campaign engine (customer follow-up and marketing)

`lib/campaigns/*`. Campaigns are defined in CRM → Campaigns; the code supplies the rules.

- **Two classes**: `followup` (quote follow-up) and `marketing`.
- **Entry**: by event, or by audience segment. Event triggers available: `estimate_sent`, `estimate_viewed` (first open only), `estimate_lapsed`, `estimate_declined`, `job_completed`, `visit_completed`, `invoice_paid`.
- **Per-step send conditions**: always / only if unopened / only if opened and went quiet / only if not replied / only if not accepted.
- **Exit rules** (sequence ends): they reply on any channel (always on for followup), they ring us, they accept (always on for both), they decline (followup), marked do-not-contact (always on), staff log a call/email/text (machine steps back).
- **Marketing limits**: one marketing message per customer per month (C10); weekdays 9am–6pm Melbourne (C11); never to a declined channel or a quiet customer.
- **Human in the loop**: the sweep (every 30 min) enrols and queues; a person approves ("Approve & send" / "Approve all") in the queue. An approved step outside the window is held and sent by the next sweep inside it. Guard chain re-checked at delivery time, not queue time.
- **Personalisation tokens**: `first_name`, `name`, `suburb`, `estimate_total`, `last_job_date`, `estimator`, `company`, plus `{{estimate_in_account}}`. Links are tracked. Optional AI draft (`lib/campaigns/ai.ts`, `write_email` tool).
- ⚠ Whether any campaign is actually configured in production is a data question, not a code one — check CRM → Campaigns.

---

## 5. Scheduled jobs (vercel.json, region syd1)

| Cron | Schedule (UTC) | What it sends or drafts |
|------|----------------|-------------------------|
| `/api/cron/wo-sweep` | 07:00 and 08:00 UTC; runs only in the one that is 6 pm Melbourne (Session 2, D5); `?force=1` runs it any time | DRAFTS customer progress updates; SENDS pre-start checklists and visit reminder texts; appointment-confirmation backstop; expires unanswered offers; QA cadence and GCal reconcile backstops. |
| `/api/cron/campaign-sweep` | every 30 min | Enrols + queues campaign steps; sends approved-held steps inside the window. |
| `/api/cron/wizard-sweep` | every 30 min | Abandoned-wizard resume email (45 min idle); also runs on staff screen loads. |
| `/api/cron/crm-sweep` | every 30 min | Lapses estimates past valid_until; refreshes CRM facts. No messages. |
| `/api/cron/agent-sweep` | every 15 min | Logs `wizard_abandoned` events for guided assistant conversations that went quiet (30 min). No messages. |
| `/api/cron/trade-digest` | hourly | Trade daily digest — each admin's chosen Melbourne hour picks their run (Session 2). |

---

## 6. Gaps and things to decide before building more

1. ~~Trade daily digest not scheduled~~ — DONE Session 2 (hourly).
2. ~~Sign-off nudges~~ DONE Session 3. Still planned: review request (Session 6), booking chase (Session 5).
3. **No painter-facing reminders**: nothing the day before a job starts, nothing when an offer is about to expire, nothing for an unanswered variation.
4. **No customer-facing "job starts tomorrow" or "painter on the way" text** — only the pre-start checklist email (N days before) and the booking confirmation.
5. ~~No payment reminders~~ DONE Session 3 (four-rung ladder, office approves first).
6. **Two sends sit outside the registry** and therefore have no switch and don't appear on Settings → Automations: the tenant access text and CRM record replies. Google Calendar push is also outside it.
7. ~~Wizard resume email once a day~~ — DONE Session 2 (every 30 minutes).
8. **Adding a new automation** = registry entry + template fields in `DEFAULT_MESSAGING` + `loadMessaging` + `automationOn` check at the send site + a `messages`-recorded send. `registry.test.ts` pins that every template field has a default.

## 7. Dashboard capture (session 0b, 19 Sep 2026)

Every `messages` row now carries `sender_role` — customer · staff · system · assistant (legacy unsigned outbound = unknown, counted as a reply so nothing old resurfaces). Every registry send is `system`; so are campaigns, the welcome, the tenant text, the sign-in link, staff alerts, receipts and remittances. A person's send (estimate, chat reply, variation, invoice, job update, contractor invite, a logged call or text, a portal reply) is `staff`. The account's facts row carries `last_inbound_at` and `last_staff_reply_at`; "customers awaiting reply" = the first is later than the second, and an automation never moves the second. The customer opening their thread (token chat or portal) sets `read_at` with `readSource = portal`; a Resend open sets it with `readSource = email_open, readIsBestEffort = true`. Migration 20270176.
