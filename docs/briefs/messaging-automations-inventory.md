# Messaging automations — inventory (as built, 16 Sep 2026)

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
| 2 | `estimate_chat_reply` | Reply on the estimate chat | email + SMS | auto | Staff post a reply on an estimate's chat. | Templates: `chatReplySubject`, `chatReplySms`. |
| 3 | `wizard_saved_link` | Estimate saved — sign-in link | email | auto | Customer finishes the online wizard and gets a price. | Skipped if already signed in. Templates: `wizardSavedSubject`, `wizardSavedBody`. |
| 4 | `wizard_abandoned` | Abandoned wizard — pick up where you left off | email | auto | Wizard run idle 45 min with an email on it. Sent by the wizard sweep (cron daily 21:00 UTC) and whenever staff open CRM Today or Estimates → Wizard. | One link per run. Never to a run without an email or to a test address. Templates: `wizardResumeSubject`, `wizardResumeBody`. |
| 5 | `visit_confirmation` | Visit booked — calendar invite | email + .ics | auto | Estimator visit booked (by customer in the estimate, or office on the record / Diary). Move = updated invite; cancel = pulls it. | One per booking and per move, recorded on the visit. Templates: `visitConfirmSubject`, `visitConfirmBody`. |
| 6 | `visit_reminder` | Visit reminder text | SMS | auto | Evening before an estimator visit. Rides the daily wo-sweep (cron 08:00 UTC = 18:00 Melbourne AEST). | Once per visit; a moved visit is reminded again. Template: `visitReminderSms`. |
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
| 17 | `trade_daily_digest` | Trade daily digest | email | auto | Once a day per trade-organisation admin, at the hour each person picks under Team. | ⚠ Cron route exists (`/api/cron/trade-digest`) but is NOT in `vercel.json`. Nothing goes out today. |
| 18 | `campaigns` | Marketing / follow-up campaigns | email + SMS | manual approval | Campaign sweep (cron every 30 min) enrols and QUEUES steps; a person approves in CRM → Campaigns queue. Approved-but-held steps are then sent by the sweep inside the window. | See §4 for the engine rules. |
| 19 | — (not in registry) | Tenant access text | SMS | manual | Trade customer sends a tenant a link from the portal quote page. | `app/account/(portal)/quote/[id]/tenant/actions.ts`. Link expires after TENANT_LINK_DAYS. |
| 20 | — (not in registry) | Reply from the CRM record | email + SMS | manual | Staff send a reply from the customer record. | `app/crm/recordActions.ts` `sendReply`. Recorded, routed, delivery-tracked. |
| 21 | `signoff_nudges` | Sign-off reminders | — | **planned** | 0h / 24h / 48h after walkthrough with no signature. | Copy exists in the DB; nothing sends it. |
| 22 | `review_request` | Review request | — | **planned** | After sign-off. | Recorded as a follow-up task only. (A `job_completed` campaign trigger could carry it — see §4.) |
| 23 | `booking_chase` | Booking chase | — | **planned** | Accepted estimate with no booking. | CRM board card only; no message. |

### Customer-side controls
- **Customer alert settings** (portal → Notifications, `accounts.notify_prefs`): five types the customer can switch off per channel — Estimates, Visits, Property & job updates, Invoices & payments, Replies to your messages. Enforced in `lib/messaging/send.ts` by the send's `ctx.kind`. Untagged sends (sign-in links, office mail, campaigns) are never checked. Unset = on.
- **Marketing permission** is separate: `permit_email` / `permit_sms` on the account, set from the portal (provenance `portal`) or by staff in the CRM.
- **Inbound SMS STOP / START** (`lib/campaigns/inboundSms.ts`, Twilio webhook): whole-message keyword match writes `marketing_unsubscribed_at`. Not a substring match.
- **Reply routing**: with `REPLY_DOMAIN` set, email replies come back into the CRM thread (`reply+<token>@…`). SMS delivery receipts land on `/api/sms/status`.

---

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
| 7 | `assistant_handoff` | Assistant — someone wants a person | SMS | Customer in the assistant chat asks for a human inside support hours → on-duty roster texted. A claim past the SLA → escalation list texted. | Roster, hours and SLA under Admin → Assistant. Off = the handoff card still appears in Today → Messages. `lib/agent/gateway.ts`, `app/api/agent/website/route.ts`. |
| 8 | — (in-app, not a send) | Staff chat dock | Realtime + chime | Customer message on an estimate chat. | Browser only; no email/SMS to staff. |
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
| `/api/cron/wo-sweep` | daily 08:00 (18:00 Melbourne AEST, 19:00 AEDT) | DRAFTS customer progress updates; SENDS pre-start checklists and visit reminder texts; appointment-confirmation backstop; expires unanswered offers; QA cadence and GCal reconcile backstops. |
| `/api/cron/campaign-sweep` | every 30 min | Enrols + queues campaign steps; sends approved-held steps inside the window. |
| `/api/cron/wizard-sweep` | daily 21:00 | Abandoned-wizard resume email (45 min idle). ⚠ Daily only because of the hosting plan; also runs on staff screen loads. |
| `/api/cron/crm-sweep` | every 30 min | Lapses estimates past valid_until; refreshes CRM facts. No messages. |
| `/api/cron/agent-sweep` | every 15 min | Logs `wizard_abandoned` events for guided assistant conversations that went quiet (30 min). No messages. |
| `/api/cron/trade-digest` | **not scheduled** | Trade daily digest — route built, never fires. |

---

## 6. Gaps and things to decide before building more

1. **Trade daily digest** is built but not scheduled. One line in `vercel.json` (hourly, or 17:00 Melbourne) turns it on.
2. **Three planned customer messages have no send**: sign-off nudges (0/24/48 h), review request, booking chase. Sign-off copy already exists in the DB.
3. **No painter-facing reminders**: nothing the day before a job starts, nothing when an offer is about to expire, nothing for an unanswered variation.
4. **No customer-facing "job starts tomorrow" or "painter on the way" text** — only the pre-start checklist email (N days before) and the booking confirmation.
5. **No payment reminders** on overdue invoices (the customer alert hint mentions them, but nothing sends them).
6. **Two sends sit outside the registry** and therefore have no switch and don't appear on Settings → Automations: the tenant access text and CRM record replies. Google Calendar push is also outside it.
7. **Wizard resume email runs once a day**, so a 45-minute idle rule behaves like "next evening" unless a staff member opens CRM Today.
8. **Adding a new automation** = registry entry + template fields in `DEFAULT_MESSAGING` + `loadMessaging` + `automationOn` check at the send site + a `messages`-recorded send. `registry.test.ts` pins that every template field has a default.
