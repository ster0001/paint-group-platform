/**
 * Every automated communication the platform sends — one list, one screen.
 *
 * Tom, 3 Sep 2026: "one place to see all communications, including the
 * ability to change or stop them when required." Settings → Automations
 * renders this registry. Each entry says WHO it goes to, HOW, WHAT fires it,
 * which template fields (on the `messaging` settings row) hold its wording,
 * and whether it can be switched off.
 *
 * Three kinds:
 *   automatic — fires on its own from an event; has an on/off switch, and
 *               every send site asks `automationOn()` before sending.
 *   manual    — a person presses Send on that message (an estimate, an
 *               invoice, a daily update). Listed so the office sees the whole
 *               picture; no kill switch — turning it off would just break the
 *               button. Templates editable where they exist.
 *   planned   — an event the system records but nothing is sent yet. Listed
 *               so nobody assumes a message is going out.
 *
 * Client-safe: no secrets, no server imports. Adding an automation = one
 * entry here + `automationOn(cfg, key)` at its send site. Keys are stable —
 * they are what the `disabled` list stores.
 */
import type { MessagingSettings } from "@/lib/messaging/config";
import type { ChannelChoice, SendMode } from "./controls";

export type Audience = "customer" | "painter" | "office";
export type Channel = "email" | "sms" | "ics" | "pdf";
export type AutomationKind = "automatic" | "manual" | "planned";

export type TemplateField = {
  field: keyof MessagingSettings;
  label: string;
  kind: "subject" | "body" | "sms" | "number";
  /** Placeholders this template understands, shown beside the box. */
  placeholders?: string[];
};

export type TimingDef = {
  /** Stored under controls[key].timing[id]. */
  id: string;
  label: string;
  unit: "days" | "hours" | "minutes";
  default: number;
  min?: number;
  max?: number;
};

export type Automation = {
  key: string;
  name: string;
  audience: Audience;
  channels: Channel[];
  kind: AutomationKind;
  /** Plain English: what makes it go out. */
  trigger: string;
  /** Where the wording lives when it isn't a template here. */
  wording?: string;
  templates?: TemplateField[];
  /** Once-only guard, in words, so the office knows a re-fire won't double up. */
  guard?: string;
  /** A switch that lives elsewhere (the wo_loop row) — rendered specially. */
  special?: "variation_release";
  /** Something the office should know — a cron not scheduled, a caveat. */
  note?: string;
  /** Deep link to where a manual one is sent / configured. */
  href?: string;

  // ---- Session 1 controls (16 Sep 2026). Absent = the automation's send site
  // decides on its own (manual sends, planned ones, the wo_loop switch).
  /** The channel the office gets when they have never chosen. Must be among `channels`. */
  defaultChannel?: ChannelChoice;
  /** Whether it may be queued for approval; `defaultMode` is what ships. Office alerts are never queued. */
  approvable?: boolean;
  defaultMode?: SendMode;
  /** D1: goes out at any hour (a job offer, a receipt, a sign-in link). */
  quietExempt?: boolean;
  /** D2: does not count toward, and is never blocked by, the daily cap (payment, sign-off). */
  capExempt?: boolean;
  /** The `ctx.kind` the dispatcher stamps on the send, so the customer's alert settings apply. */
  sendKind?: string;
  /** Numbers the office can tune (days before, hours after…). */
  timing?: TimingDef[];
};

const P = {
  estimate: ["{{first_name}}", "{{name}}", "{{company_name}}", "{{estimate_title}}", "{{total}}", "{{estimator_name}}", "{{link}}"],
  preStart: ["{{first_name}}", "{{company_name}}", "{{start_date}}", "{{address}}", "{{estimate_title}}"],
  appt: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{start_date}}", "{{painter_name}}", "{{walkthrough_line}}"],
  offer: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{link}}"],
  offerReminder: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{suburb}}", "{{start_date}}", "{{expiry_time}}", "{{link}}"],
  assignment: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{address}}", "{{start_date}}", "{{dates}}", "{{link}}"],
  variation: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{action}}", "{{link}}"],
  variationAdded: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{pay_line}}", "{{link}}"],
  leadChanged: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{address}}", "{{link}}"],
  employeeVariation: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{hours_line}}", "{{link}}"],
  expenseDecided: ["{{first_name}}", "{{company_name}}", "{{amount}}", "{{wo_ref}}", "{{decision}}", "{{reason_line}}"],
  leaveDecided: ["{{first_name}}", "{{company_name}}", "{{kind_word}}", "{{dates}}", "{{decision}}", "{{reason_line}}"],
  qaFail: ["{{company_name}}", "{{wo_ref}}", "{{link}}"],
  jobUpdate: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{suburb}}", "{{day_label}}", "{{link}}"],
  standards: ["{{first_name}}", "{{company_name}}", "{{link}}", "{{version}}"],
  status: ["{{first_name}}", "{{company_name}}", "{{colour}}", "{{link}}"],
  callback: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{day}}", "{{what}}", "{{link}}"],
  walkthrough: ["{{first_name}}", "{{customer_name}}", "{{painter_name}}", "{{painter_first_name}}", "{{walkthrough_when}}", "{{address}}", "{{company_name}}"],
  visit: ["{{first_name}}", "{{estimator_name}}", "{{visit_when}}", "{{address}}", "{{company_name}}"],
  visitCode: ["{{code}}", "{{company_name}}"],
  visitBooked: ["{{first_name}}", "{{visit_when}}", "{{address}}", "{{company_name}}"],
  requestReceived: ["{{first_name}}", "{{address}}", "{{company_name}}"],
  callReceived: ["{{first_name}}", "{{mobile}}", "{{company_name}}"],
  timeOffered: ["{{first_name}}", "{{visit_when}}", "{{address}}", "{{estimator_name}}", "{{company_name}}"],
  customerMessage: ["{{customer}}", "{{job}}", "{{message}}"],
  visitCancelled: ["{{first_name}}", "{{visit_when}}", "{{company_name}}"],
  signed: ["{{first_name}}", "{{job_title}}", "{{signed_by}}", "{{company_name}}"],
  chat: ["{{company_name}}", "{{link}}"],
  receipt: ["{{first_name}}", "{{amount}}", "{{invoice_number}}", "{{receipt_number}}", "{{company_name}}"],
  remittance: ["{{contractor_company}}", "{{invoice_number}}", "{{wo_ref}}", "{{amount}}", "{{bank_reference}}", "{{remittance_number}}", "{{company_name}}"],
  wizardSaved: ["{{company_name}}", "{{next_step}}"],
  wizardResume: ["{{company_name}}", "{{where}}", "{{page}}"],
  accepted: ["{{estimate_title}}", "{{accepted_name}}", "{{accepted_at}}", "{{total}}", "{{deposit}}", "{{company_name}}", "{{link}}"],
};

export const AUTOMATIONS: Automation[] = [
  // ---- customers · the estimate ------------------------------------------
  {
    key: "estimate_send", name: "Estimate sent", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "You press Send in the estimate builder. The wording below pre-fills the send dialog; you can still edit it per estimate.",
    templates: [
      { field: "emailSubject", label: "Email subject", kind: "subject", placeholders: P.estimate },
      { field: "emailIntro", label: "Email introduction", kind: "body", placeholders: P.estimate },
      { field: "smsTemplate", label: "Text message", kind: "sms", placeholders: P.estimate },
    ],
    guard: "Each send is logged on the estimate's activity feed.",
  },
  {
    key: "estimate_chat_reply", name: "Reply on the estimate chat", audience: "customer", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", approvable: true, defaultMode: "auto", sendKind: "chat_reply", quietExempt: true,
    trigger: "A staff member posts a reply on an estimate's chat — the customer is told there's a new message.",
    templates: [
      { field: "chatReplySubject", label: "Email subject", kind: "subject", placeholders: P.chat },
      { field: "chatReplySms", label: "Text message", kind: "sms", placeholders: P.chat },
    ],
  },
  {
    key: "wizard_saved_link", name: "Estimate saved — sign-in link", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", quietExempt: true, capExempt: true, sendKind: "wizard_saved",
    trigger: "A customer finishes the online wizard and gets a price. The link signs them into their account.",
    templates: [
      { field: "wizardSavedSubject", label: "Email subject", kind: "subject", placeholders: P.wizardSaved },
      { field: "wizardSavedBody", label: "Email body", kind: "body", placeholders: P.wizardSaved },
    ],
    note: "Skipped for customers already signed in.",
  },

  // ---- customers · the job -----------------------------------------------
  {
    key: "appointment_confirmation", name: "Booking confirmed", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", approvable: true, defaultMode: "auto", sendKind: "appointment",
    trigger: "The job is booked in — the painter accepts the offer, or the office assigns one directly.",
    templates: [
      { field: "apptConfirmSubject", label: "Email subject", kind: "subject", placeholders: P.appt },
      { field: "apptConfirmBody", label: "Email body", kind: "body", placeholders: P.appt },
    ],
    guard: "Once per booked start date — a re-book to a new date sends again.",
  },
  {
    key: "pre_start_checklist", name: "Pre-start checklist", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", approvable: true, defaultMode: "auto", sendKind: "pre_start",
    trigger: "The office ticks “Pre-start checklist” on the job's pre-start list; the email goes out N days before the start date.",
    templates: [
      { field: "preStartDaysBefore", label: "Days before start", kind: "number" },
      { field: "preStartSubject", label: "Email subject", kind: "subject", placeholders: P.preStart },
      { field: "preStartBody", label: "Checklist (email body)", kind: "body", placeholders: P.preStart },
    ],
    guard: "Once per job.",
  },
  {
    key: "visit_confirmation", name: "Visit booked — calendar invite", audience: "customer", channels: ["email", "ics"], kind: "automatic",
    defaultChannel: "email", sendKind: "visit_confirmation", quietExempt: true,
    trigger: "An estimator visit is booked — by the customer in the estimate, or by the office on the record or Diary. A move sends the updated invite; a cancellation pulls it.",
    templates: [
      { field: "visitConfirmSubject", label: "Subject", kind: "subject", placeholders: P.visit },
      { field: "visitConfirmBody", label: "Email", kind: "body", placeholders: P.visit },
    ],
    guard: "One per booking (and one per move), recorded on the visit.",
  },
  {
    key: "visit_code", name: "Text code to book a visit", audience: "customer", channels: ["sms"], kind: "manual",
    trigger: "A customer picks a site-visit time online (visit booking S3). Always on and never held — without it nobody can book.",
    templates: [{ field: "visitCodeSms", label: "Text", kind: "sms", placeholders: P.visitCode }],
    guard: "One per hold plus up to three resends; five per mobile and fifteen per address every ten minutes.",
  },
  {
    key: "visit_booked", name: "Visit booked — text", audience: "customer", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "visit_booked", quietExempt: true,
    trigger: "A customer confirms a site visit online with the text code (visit booking S3). The calendar invitation goes by email through 'Visit booked — calendar invite'.",
    templates: [{ field: "visitBookedSms", label: "Text", kind: "sms", placeholders: P.visitBooked }],
    guard: "Once per booking.",
  },
  {
    key: "request_received", name: "Request received — email", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "request_received", quietExempt: true,
    trigger: "A customer asks for a site visit before the price range, requests a time (pre-arranged area, none of the times suit, or a suburb we do not know), from the wizard (visit booking S4).",
    templates: [
      { field: "requestReceivedSubject", label: "Subject", kind: "subject", placeholders: P.requestReceived },
      { field: "requestReceivedBody", label: "Email", kind: "body", placeholders: P.requestReceived },
    ],
    guard: "Once per request.",
  },
  {
    key: "call_request_received", name: "Call request received — email", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "call_request_received", quietExempt: true,
    trigger: "A customer taps Speak with us on the guide range (visit booking S4, R25).",
    templates: [
      { field: "callRequestReceivedSubject", label: "Subject", kind: "subject", placeholders: P.callReceived },
      { field: "callRequestReceivedBody", label: "Email", kind: "body", placeholders: P.callReceived },
    ],
    guard: "Once per request.",
  },
  {
    key: "time_offered", name: "Time offered by staff — text and email", audience: "customer", channels: ["sms", "email", "ics"], kind: "automatic",
    defaultChannel: "both", sendKind: "time_offered", quietExempt: true,
    trigger: "Staff answer a request by booking a time for the customer (visit booking S4, 4.4). No text code is needed.",
    templates: [
      { field: "timeOfferedSms", label: "Text", kind: "sms", placeholders: P.timeOffered },
      { field: "timeOfferedSubject", label: "Email subject", kind: "subject", placeholders: P.timeOffered },
      { field: "timeOfferedBody", label: "Email", kind: "body", placeholders: P.timeOffered },
    ],
    guard: "Once per offered visit; the invitation rides on the email.",
  },
  {
    key: "customer_message", name: "Customer message — email to the office, copy to the customer", audience: "customer", channels: ["email"], kind: "manual",
    trigger: "A customer sends a message from the wizard or the guide range (visit booking S4, R26/R35). The message is posted into their chat in the platform AND emailed to the office address with a copy to the customer. Always on.",
    templates: [
      { field: "customerMessageSubject", label: "Subject", kind: "subject", placeholders: P.customerMessage },
      { field: "customerMessageBody", label: "Email", kind: "body", placeholders: P.customerMessage },
    ],
    guard: "Once per message (a retry with the same client id is not sent again).",
  },
  {
    key: "visit_cancelled", name: "Visit cancelled — text", audience: "customer", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "visit_cancelled", quietExempt: true,
    trigger: "The customer declined the calendar invitation, or the estimator deleted the visit in Google Calendar (visit booking S5, R22/R27). The visit is cancelled in the platform and the customer is told.",
    templates: [{ field: "visitCancelledSms", label: "Text", kind: "sms", placeholders: P.visitCancelled }],
    guard: "Once per cancelled visit.",
  },
  {
    key: "visit_reminder", name: "Visit reminder text", audience: "customer", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "visit_reminder", quietExempt: true,
    trigger: "The evening before an estimator visit, to the customer's mobile.",
    templates: [{ field: "visitReminderSms", label: "Text", kind: "sms", placeholders: P.visit }],
    guard: "Once per visit; a moved visit is reminded again for its new day.",
    note: "Rides the evening sweep (18:00 Melbourne).",
  },
  {
    key: "walkthrough_invite", name: "Final walkthrough calendar invite", audience: "customer", channels: ["email", "ics"], kind: "automatic",
    defaultChannel: "email", sendKind: "walkthrough_invite", quietExempt: true,
    trigger: "The final walkthrough is booked, moved or cancelled. The customer AND the painter each get a calendar invite that updates itself.",
    templates: [
      { field: "walkthroughInviteSubject", label: "Subject (also the calendar entry's title)", kind: "subject", placeholders: P.walkthrough },
      { field: "walkthroughInviteCustomerBody", label: "Customer's email", kind: "body", placeholders: P.walkthrough },
      { field: "walkthroughInvitePainterBody", label: "Painter's email", kind: "body", placeholders: P.walkthrough },
    ],
    guard: "Only when the date or time actually changed.",
  },
  {
    key: "customer_update", name: "Progress update", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "The office approves and sends a day's update from the Projects console — photos included.",
    wording: "The update is what you type; the email frame is fixed.",
    href: "/pc",
  },
  {
    key: "variation_signature_request", name: "Variation — please sign", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "A priced change is sent for the customer's signature (emailed automatically the moment it is priced; text is a deliberate tap).",
    wording: "Fixed wording, built around the change's own description.",
  },
  {
    key: "signed_completion_report", name: "Signed completion report", audience: "customer", channels: ["email", "pdf"], kind: "automatic",
    defaultChannel: "email", approvable: true, defaultMode: "auto", sendKind: "signoff_report", capExempt: true,
    trigger: "The customer signs off the job (on the painter's device or remotely). The report PDF is attached.",
    templates: [
      { field: "signedReportSubject", label: "Email subject", kind: "subject", placeholders: P.signed },
      { field: "signedReportBody", label: "Email body", kind: "body", placeholders: P.signed },
    ],
    note: "Also copied to the property's assessor when one is on file.",
  },

  // ---- customers · money -------------------------------------------------
  {
    key: "invoice_issued", name: "Invoice issued", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "You issue and send an invoice (deposit, progress, final, variation) from Invoicing.",
    wording: "Fixed wording plus your personal message; bank details from Invoicing settings.",
    href: "/invoices",
  },
  {
    key: "payment_receipt", name: "Payment receipt", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "receipt", quietExempt: true, capExempt: true,
    trigger: "A payment is recorded against an invoice — by the office, or by card through the payment page.",
    templates: [
      { field: "receiptSubject", label: "Email subject", kind: "subject", placeholders: P.receipt },
      { field: "receiptBody", label: "Email body", kind: "body", placeholders: P.receipt },
    ],
  },
  {
    key: "portal_magic_link", name: "Sign-in link", audience: "customer", channels: ["email"], kind: "manual",
    trigger: "A customer asks to sign in to their account. Always on — without it nobody can get in.",
    wording: "Fixed wording.",
  },

  // ---- painters ----------------------------------------------------------
  {
    key: "contractor_offer", name: "Job offer", audience: "painter", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "both", sendKind: "offer", quietExempt: true, capExempt: true,
    trigger: "A job is offered, re-offered or reassigned to a painter. The offer holds for 24 hours.",
    templates: [
      { field: "offerSms", label: "Text message", kind: "sms", placeholders: P.offer },
      { field: "offerEmailSubject", label: "Email subject", kind: "subject", placeholders: P.offer },
      { field: "offerEmailIntro", label: "Email body", kind: "body", placeholders: P.offer },
    ],
    note: "Text needs a mobile on the painter's profile.",
  },
  {
    key: "contractor_offer_reminder", name: "Job offer still waiting — reminder", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "offer_reminder", quietExempt: true, capExempt: true,
    trigger: "A job offer has had no answer: a text 12 h after it went out, again at 20 h, each saying when the offer expires. An answered, withdrawn or expired offer cancels what is left.",
    templates: [
      { field: "offerReminderSms", label: "Text message", kind: "sms", placeholders: P.offerReminder },
    ],
    timing: [
      { id: "first", label: "First reminder", unit: "hours", default: 12, min: 1, max: 23 },
      { id: "second", label: "Second reminder", unit: "hours", default: 20, min: 1, max: 23 },
    ],
    guard: "Each rung once per offer; stops the moment the offer is answered or lapses.",
    note: "Has its own night window instead of the office sending hours: nothing goes between 10 pm and 4:59 am Melbourne — a reminder due then waits for the first sweep after 5 am and is dropped if the offer was answered meanwhile.",
  },
  // Employed painters (Session 2). Same "painter" audience: an employee is a
  // painter with an assignment instead of an offer.
  {
    key: "employee_assigned", name: "Job assigned — tap Accept", audience: "painter", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "both", sendKind: "assignment", quietExempt: true, capExempt: true,
    trigger: "The office puts an employed painter on a job. It is in their calendar already; Accept only says they have seen it.",
    templates: [
      { field: "assignmentSms", label: "Text message", kind: "sms", placeholders: P.assignment },
      { field: "assignmentEmailSubject", label: "Email subject", kind: "subject", placeholders: P.assignment },
      { field: "assignmentEmailIntro", label: "Email body", kind: "body", placeholders: P.assignment },
    ],
    note: "Text needs a mobile on the painter's profile.",
  },
  {
    key: "employee_dates_changed", name: "Your dates changed — accept again", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "assignment_dates", quietExempt: true, capExempt: true,
    trigger: "The office moves an employed painter's days on a job. Their earlier Accept is cleared.",
    templates: [{ field: "assignmentDatesChangedSms", label: "Text message", kind: "sms", placeholders: P.assignment }],
  },
  {
    key: "employee_released", name: "Taken off a job", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "assignment_released", capExempt: true,
    trigger: "The office takes an employed painter off a job. Past ticks stay; future days come off their calendar.",
    templates: [{ field: "assignmentReleasedSms", label: "Text message", kind: "sms", placeholders: P.assignment }],
  },
  // Employed painters (Session 7, brief §3.9): the rest of the employee moments.
  {
    key: "employee_lead_changed", name: "You're now the lead painter", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "lead_changed", capExempt: true,
    trigger: "The office makes a different employed painter the lead on a job (the customer sees the new name on their next load).",
    templates: [{ field: "leadChangedSms", label: "Text message", kind: "sms", placeholders: P.leadChanged }],
  },
  {
    key: "employee_variation_approved", name: "The customer approved a change (employee wording)", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "variation_approved_employee", capExempt: true,
    trigger: "A customer signs a priced change on a job with employed painters on it. Every painter on the job is told — hours, never a price.",
    templates: [{ field: "employeeVariationApprovedSms", label: "Text message", kind: "sms", placeholders: P.employeeVariation }],
  },
  {
    key: "expense_decided", name: "Expense claim decided", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "expense_decided", capExempt: true,
    trigger: "The office approves or rejects a painter's expense claim.",
    templates: [{ field: "expenseDecidedSms", label: "Text message", kind: "sms", placeholders: P.expenseDecided }],
  },
  {
    key: "leave_decided", name: "Leave / RDO decided", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "leave_decided", capExempt: true,
    trigger: "The office approves or declines an employed painter's leave or RDO request.",
    templates: [{ field: "leaveDecidedSms", label: "Text message", kind: "sms", placeholders: P.leaveDecided }],
  },
  {
    key: "variation_auto_release", name: "Approved variations go straight to the painter", audience: "painter", channels: [], kind: "automatic",
    trigger: "The customer signs a priced addition. On: it lands on the painter's home page for their acceptance at once. Off: the office releases it from the job page.",
    special: "variation_release",
  },
  {
    key: "contractor_variation_added", name: "A signed change is on your job", audience: "painter", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "both", sendKind: "variation_added", capExempt: true,
    trigger: "The customer signs a change from the revision working scope on a job a contractor already has. It lands on their job sheet, tick list and pay — they are told, not asked (Tom, 24 Sep 2026).",
    templates: [
      { field: "variationAddedSms", label: "Text message", kind: "sms", placeholders: P.variationAdded },
      { field: "variationAddedEmailSubject", label: "Email subject", kind: "subject", placeholders: P.variationAdded },
      { field: "variationAddedEmailIntro", label: "Email body", kind: "body", placeholders: P.variationAdded },
    ],
    guard: "Once per change. A painter with no mobile is emailed; with neither on file the job's record says so (Tom, 7 Oct 2026 — 12A Cavell Court).",
  },
  {
    key: "contractor_variation_released", name: "Variation waiting on you", audience: "painter", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "both", sendKind: "variation_released", capExempt: true,
    trigger: "An approved variation is released to the painter (automatically at signing, or by the office).",
    templates: [
      { field: "variationReleasedSms", label: "Text message", kind: "sms", placeholders: P.variation },
      { field: "variationReleasedEmailSubject", label: "Email subject", kind: "subject", placeholders: P.variation },
      { field: "variationReleasedEmailIntro", label: "Email body", kind: "body", placeholders: P.variation },
    ],
    guard: "Once per variation — the office can send it again from the job page (Remind the painter).",
  },
  {
    key: "contractor_job_update_reminder", name: "Update your work order — reminders", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "job_update_reminder", quietExempt: true, capExempt: true,
    trigger: "A booked job is under way. Day 1 at 7:30 am, then by job length: 1 day — 3:30 pm the same day; 2 days — day 2 at 3:30 pm; 3–6 days — half way and the last day at 3:30 pm; 7 days or more — 30%, 60% and the last day at 3:30 pm. Every painter on the job (the contractor and any assigned crew) gets the text, asking them to tick what is done and add the day's photos. If nothing lands, again at 10:30 am and 1:30 pm (a morning moment) or 5:30 pm and 7:00 pm (an afternoon one) — Settings → job_update_rules. Nothing after 7 pm.",
    templates: [
      { field: "contractorJobUpdateSms", label: "First text", kind: "sms", placeholders: P.jobUpdate },
      { field: "contractorJobUpdateSms2", label: "Second text (nothing landed yet)", kind: "sms", placeholders: P.jobUpdate },
      { field: "contractorJobUpdateSms3", label: "Third and last text", kind: "sms", placeholders: P.jobUpdate },
      { field: "contractorJobUpdateSms3Green", label: "Third text for a Green painter", kind: "sms", placeholders: P.jobUpdate },
    ],
    guard: "Up to three texts per moment, each claimed on the moment's row (wo_reminder_moments) before it goes; they stop the instant a tick or a photo lands that day, on a day the PC marked No work, or once the job reaches its quality check, walkthrough or close. The days are the painter's booked working days (weekends only if they work them).",
    note: "7:30 am is before the office's sending hours, so this text is exempt from quiet hours by design.",
  },
  // ---- Painter status (brief: standards / status / call backs, Step 6) -------
  {
    key: "contractor_status_changed", name: "Painter status — your colour changed", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "status_changed", capExempt: true,
    trigger: "The evaluator writes a different colour for a painter who already had one (every half hour, or straight after a check, a call back or an update). Not on the first colour (New at launch), and not while status is staff-only (Settings → painter_status_rules.statusVisibleToPainters).",
    templates: [
      { field: "statusGreenSms", label: "Reached Green — contractor", kind: "sms", placeholders: P.status },
      { field: "statusGreenLeadSms", label: "Reached Green — employed lead painter", kind: "sms", placeholders: P.status },
      { field: "statusDroppedSms", label: "Any other change", kind: "sms", placeholders: P.status },
    ],
    guard: "Once per change — the writer RPC diffs before it reports one, and the text goes only when the colour it reports differs from the colour it replaced.",
  },
  // ---- Finish standards (brief: standards / status / call backs, Step 2) -----
  {
    key: "contractor_standards_invite", name: "Finish standards — please read and confirm", audience: "painter", channels: ["sms", "email"], kind: "manual",
    defaultChannel: "both", sendKind: "standards_invite", capExempt: true,
    trigger: "The office presses Send standards invite on a painter (Contractors page) — once, when the standards launch or a painter is added later. New painters are invited the moment they join, without a message: the sign-off is on their first screen.",
    templates: [
      { field: "standardsInviteSms", label: "Text message", kind: "sms", placeholders: P.standards },
      { field: "standardsInviteEmailSubject", label: "Email subject", kind: "subject", placeholders: P.standards },
      { field: "standardsInviteEmailIntro", label: "Email body", kind: "body", placeholders: P.standards },
    ],
    guard: "Sent on the press; the invite itself (the grace period) is recorded by standards_invite whether or not the message goes.",
    href: "/contractors",
  },
  {
    key: "contractor_standards_reminder", name: "Finish standards — reminder", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "standards_reminder", capExempt: true,
    trigger: "Days 2, 4 and 6 after the invite at 9 am (Settings → standards_rules), while the painter has not confirmed; also the PC's Send reminder text on the queue card.",
    templates: [{ field: "standardsReminderSms", label: "Text message", kind: "sms", placeholders: P.standards }],
    guard: "Each day once per painter (automation_claims); stops the moment the six sections are confirmed.",
  },
  {
    key: "contractor_standards_confirmed", name: "Finish standards — your copy", audience: "painter", channels: ["email", "pdf"], kind: "automatic",
    defaultChannel: "email", sendKind: "standards_confirmed", capExempt: true,
    trigger: "The painter confirms the sixth section. The PDF is generated from the standards data, saved in their documents and attached.",
    templates: [
      { field: "standardsConfirmedEmailSubject", label: "Email subject", kind: "subject", placeholders: P.standards },
      { field: "standardsConfirmedEmailIntro", label: "Email body", kind: "body", placeholders: P.standards },
    ],
    guard: "Once per painter per version — the document row is the guard.",
  },
  {
    key: "contractor_standards_new_version", name: "Finish standards — updated, confirm again", audience: "painter", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "both", sendKind: "standards_new_version", capExempt: true,
    trigger: "A material new version of the standards is published (standards_publish_version): every painter not confirmed on it is re-invited with the same grace period.",
    templates: [
      { field: "standardsNewVersionSms", label: "Text message", kind: "sms", placeholders: P.standards },
      { field: "standardsNewVersionEmailSubject", label: "Email subject", kind: "subject", placeholders: P.standards },
      { field: "standardsNewVersionEmailIntro", label: "Email body", kind: "body", placeholders: P.standards },
    ],
    guard: "Once per painter per version (automation_claims).",
  },
  {
    key: "contractor_callback_booked", name: "Call back booked", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "callback_booked", capExempt: true,
    trigger: "A call back's return visit is booked or moved (any of the four routes, or Book the visit on the job page). Goes to the painter booked to fix it.",
    templates: [{ field: "callbackBookedSms", label: "Text message", kind: "sms", placeholders: P.callback }],
    guard: "Once per call back per visit day (wo_events callback_notified).",
  },
  {
    key: "contractor_qa_fail", name: "Quality check — put right", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "qa_fail",
    trigger: "The office records a failed quality check on the painter's job.",
    templates: [{ field: "qaFailSms", label: "Text message", kind: "sms", placeholders: P.qaFail }],
    guard: "Once per check.",
  },
  {
    key: "contractor_remittance", name: "Remittance advice", audience: "painter", channels: ["email", "pdf"], kind: "automatic",
    defaultChannel: "email", sendKind: "remittance", quietExempt: true, capExempt: true,
    trigger: "The office marks a painter's invoice as paid.",
    templates: [
      { field: "remittanceSubject", label: "Email subject", kind: "subject", placeholders: P.remittance },
      { field: "remittanceBody", label: "Email body", kind: "body", placeholders: P.remittance },
    ],
  },

  // ---- office / trade -----------------------------------------------------
  {
    key: "office_estimate_accepted", name: "Estimate accepted — tell the office", audience: "office", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A customer (or a trade approver) accepts an estimate. The office address below is emailed with the title, total and deposit, and a link to the estimate.",
    templates: [
      { field: "officeEmail", label: "Send to (email address)", kind: "subject" },
      { field: "acceptedOfficeSubject", label: "Email subject", kind: "subject", placeholders: P.accepted },
      { field: "acceptedOfficeBody", label: "Email body", kind: "body", placeholders: P.accepted },
    ],
    guard: "Once per estimate.",
    note: "Also reaches each staff member who has ticked it under Staff alerts below.",
  },
  // Tom, 10 Sep: the staff alerts. Who gets each one, and by email or text, is
  // per person — the routing table under the Staff heading on the screen
  // (profiles.staff_notify, lib/staff/notifyEvents.ts). The switch here is the
  // master kill for everyone.
  {
    key: "office_job_accepted", name: "Job accepted by the painter", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A painter accepts a job offer, or accepts it with a different start date proposed.",
    templates: [
      { field: "officeJobAcceptedSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{start_date}}", "{{proposed_line}}", "{{note_line}}", "{{link}}"] },
      { field: "officeJobAcceptedBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{start_date}}", "{{proposed_line}}", "{{note_line}}", "{{link}}"] },
    ],
    guard: "Once per offer.",
  },
  {
    key: "office_estimate_chat", name: "Customer wrote on the estimate chat", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A customer sends a message from the chat on their estimate (Ask a question / Chat with us / Message us). Who is told, and how, is each person's routing under Settings → Staff logins; with nobody routed, the office address is emailed. Out of hours the subject carries an (after hours) tag.",
    templates: [
      { field: "officeEstimateChatSubject", label: "Email subject", kind: "subject", placeholders: ["{{customer}}", "{{job}}", "{{message}}", "{{hours_tag}}", "{{hours_line}}", "{{link}}"] },
      { field: "officeEstimateChatBody", label: "Message", kind: "body", placeholders: ["{{customer}}", "{{job}}", "{{message}}", "{{hours_tag}}", "{{hours_line}}", "{{link}}"] },
    ],
    guard: "Once per chat message.",
  },
  // Tom, 1 Oct 2026: "staff to receive email if an offered estimate is
  // rejected / expires". Same path as the other office alerts: the master
  // switch here, who gets it per login under Staff logins.
  {
    key: "office_estimate_declined", name: "Estimate declined by the customer", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "email", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A customer presses Decline on their estimate page. Staff who ticked Estimate declined under Staff logins are told, with the customer's reason and a link to the estimate.",
    templates: [
      { field: "officeEstimateDeclinedSubject", label: "Email subject", kind: "subject", placeholders: ["{{customer}}", "{{job}}", "{{total}}", "{{reason_line}}", "{{link}}"] },
      { field: "officeEstimateDeclinedBody", label: "Message", kind: "body", placeholders: ["{{customer}}", "{{job}}", "{{total}}", "{{reason_line}}", "{{link}}"] },
    ],
    guard: "Once per estimate.",
  },
  {
    key: "office_estimate_expired", name: "Estimate expired without an answer", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "email", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "The daily CRM sweep finds a sent estimate past its valid-until date and marks it expired. Staff who ticked Estimate expired under Staff logins are told, with a link to the estimate.",
    templates: [
      { field: "officeEstimateExpiredSubject", label: "Email subject", kind: "subject", placeholders: ["{{customer}}", "{{job}}", "{{total}}", "{{valid_until}}", "{{link}}"] },
      { field: "officeEstimateExpiredBody", label: "Message", kind: "body", placeholders: ["{{customer}}", "{{job}}", "{{total}}", "{{valid_until}}", "{{link}}"] },
    ],
    guard: "Once per estimate.",
  },
  {
    key: "office_job_declined", name: "Job declined by the painter", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A painter declines a job offer — the job is back with the office to re-offer.",
    templates: [
      { field: "officeJobDeclinedSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{start_date}}", "{{reason_line}}", "{{link}}"] },
      { field: "officeJobDeclinedBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{start_date}}", "{{reason_line}}", "{{link}}"] },
    ],
    guard: "Once per offer.",
  },
  {
    key: "office_invoice_paid", name: "Invoice paid", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A payment is recorded against a customer invoice — by the office, or by card through the payment page.",
    templates: [
      { field: "officeInvoicePaidSubject", label: "Email subject", kind: "subject", placeholders: ["{{who}}", "{{amount}}", "{{invoice_number}}", "{{job}}", "{{method}}", "{{link}}"] },
      { field: "officeInvoicePaidBody", label: "Message", kind: "body", placeholders: ["{{who}}", "{{amount}}", "{{invoice_number}}", "{{job}}", "{{method}}", "{{link}}"] },
    ],
    guard: "Once per payment.",
  },
  {
    key: "office_variation_raised", name: "Variation raised", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A painter raises a variation from their portal — it is waiting to be priced.",
    templates: [
      { field: "officeVariationRaisedSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{category}}", "{{hours_line}}", "{{comment}}", "{{link}}"] },
      { field: "officeVariationRaisedBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{category}}", "{{hours_line}}", "{{comment}}", "{{link}}"] },
    ],
    guard: "Once per variation.",
  },
  {
    key: "office_variation_declined", name: "Painter declined an approved change", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "Tom, 7 Oct 2026: the client approved a change from Revise scope, it went to the painter for their approval, and they declined it with a note — it is back in PC Command.",
    templates: [
      { field: "officeVariationDeclinedSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{hours_line}}", "{{comment}}", "{{link}}"] },
      { field: "officeVariationDeclinedBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{hours_line}}", "{{comment}}", "{{link}}"] },
    ],
    guard: "Once per variation.",
  },
  {
    key: "office_update_drafted", name: "Customer update drafted from the painter's ticks", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: false, capExempt: true,
    trigger: "Tom, 7 Oct 2026: a painter ticks work off (or the evening sweep catches it) and a customer update is drafted for the day — someone in the office confirms and sends it.",
    templates: [
      { field: "officeUpdateDraftedSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{link}}"] },
      { field: "officeUpdateDraftedBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{job}}", "{{wo_ref}}", "{{link}}"] },
    ],
    guard: "Once per job per day.",
  },
  {
    key: "office_update_due", name: "Customer due an update", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: false, capExempt: true,
    trigger: "Tom, 7 Oct 2026: a job in progress whose customer has heard nothing for the 'update every N days' setting, with nothing drafted — the evening sweep reminds the office to write one.",
    templates: [
      { field: "officeUpdateDueSubject", label: "Email subject", kind: "subject", placeholders: ["{{job}}", "{{wo_ref}}", "{{hours_line}}", "{{link}}"] },
      { field: "officeUpdateDueBody", label: "Message", kind: "body", placeholders: ["{{job}}", "{{wo_ref}}", "{{hours_line}}", "{{link}}"] },
    ],
    guard: "Once per job per day while it is due.",
  },
  {
    key: "office_contractor_invoice", name: "Contractor invoice submitted", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "A painter submits an invoice or a payment claim — it is waiting for approval in Payments.",
    templates: [
      { field: "officeContractorInvoiceSubject", label: "Email subject", kind: "subject", placeholders: ["{{painter}}", "{{amount}}", "{{invoice_number}}", "{{wo_ref}}", "{{job}}", "{{link}}"] },
      { field: "officeContractorInvoiceBody", label: "Message", kind: "body", placeholders: ["{{painter}}", "{{amount}}", "{{invoice_number}}", "{{wo_ref}}", "{{job}}", "{{link}}"] },
    ],
    guard: "Once per invoice.",
  },
  {
    key: "external_approval", name: "External approval request", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "approval", quietExempt: true, capExempt: true,
    trigger: "A trade customer sends an estimate to an approver, assessor or owner for sign-off; the sender is emailed the decision.",
    wording: "Fixed wording.",
  },
  {
    key: "trade_daily_digest", name: "Trade daily digest", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", sendKind: "digest", quietExempt: true, capExempt: true,
    trigger: "Once a day, each trade-organisation admin gets a summary of what moved on their properties.",
    wording: "Fixed wording; each person sets their own time under Team.",
    note: "Runs hourly; each admin's chosen hour (Melbourne) picks their run.",
  },
  {
    key: "assistant_handoff", name: "Assistant — someone wants a person", audience: "office", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", sendKind: "assistant_handoff", quietExempt: true, capExempt: true,
    trigger: "A customer in the assistant chat asks for a human inside support hours; the on-duty roster is texted. A claim past the SLA texts the escalation list.",
    wording: "Fixed wording; roster and hours are under Admin → Assistant.",
    href: "/admin/agent",
  },
  {
    key: "campaigns", name: "Marketing campaigns", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "Campaign steps are queued by the engine and sent only after a person approves them in the CRM queue.",
    wording: "Campaign templates live in CRM → Campaigns.",
    href: "/crm/campaigns",
  },

  // ---- Session 3 (16 Sep 2026): money and sign-off ----------------------------
  {
    key: "customer_accepted_welcome", name: "Welcome — thanks, what happens next", audience: "customer", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", approvable: true, defaultMode: "auto", sendKind: "job_welcome", quietExempt: true, capExempt: true,
    trigger: "A customer accepts an estimate. Thanks, what happens next, and a link to their account — with the deposit link when the deposit invoice has been issued.",
    templates: [
      { field: "welcomeSubject", label: "Email subject", kind: "subject", placeholders: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{link}}", "{{deposit_line}}"] },
      { field: "welcomeBody", label: "Email body", kind: "body", placeholders: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{link}}", "{{deposit_line}}"] },
      { field: "welcomeSms", label: "Text message", kind: "sms", placeholders: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{link}}"] },
    ],
    guard: "Once per estimate.",
  },
  {
    key: "invoice_reminder", name: "Unpaid invoice reminders", audience: "customer", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", approvable: true, defaultMode: "approve", sendKind: "invoice_reminder", capExempt: true,
    trigger: "An issued invoice passes its due date with a balance owing. Four reminders, each with its own wording; the first two are email only, the last two add a text. Stops the moment a payment lands, and pauses while the invoice is marked \"reminders paused\" (a dispute).",
    templates: [
      { field: "invoiceReminder1Subject", label: "Reminder 1 · subject", kind: "subject", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder1Body", label: "Reminder 1 · body", kind: "body", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder2Subject", label: "Reminder 2 · subject", kind: "subject", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder2Body", label: "Reminder 2 · body", kind: "body", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder3Subject", label: "Reminder 3 · subject", kind: "subject", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder3Body", label: "Reminder 3 · body", kind: "body", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder4Subject", label: "Reminder 4 · subject", kind: "subject", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminder4Body", label: "Reminder 4 · body", kind: "body", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
      { field: "invoiceReminderSms", label: "Text (reminders 3 and 4)", kind: "sms", placeholders: ["{{first_name}}", "{{invoice_number}}", "{{amount}}", "{{due_date}}", "{{days_overdue}}", "{{company_name}}", "{{link}}"] },
    ],
    timing: [
      { id: "rung1", label: "Reminder 1", unit: "days", default: 1, min: 0, max: 60 },
      { id: "rung2", label: "Reminder 2", unit: "days", default: 4, min: 0, max: 90 },
      { id: "rung3", label: "Reminder 3", unit: "days", default: 7, min: 0, max: 120 },
      { id: "rung4", label: "Reminder 4", unit: "days", default: 14, min: 0, max: 180 },
    ],
    guard: "Each reminder once per invoice; a missed one is never sent late in a burst. Trade customers: the account's finance contact where one exists.",
    note: "No late fees are ever mentioned — that wording waits for legal review.",
  },
  {
    key: "deposit_reminder", name: "Deposit reminder", audience: "customer", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "approve", sendKind: "deposit_reminder", capExempt: true,
    trigger: "A deposit invoice is issued and not paid: a reminder some days after issue, and again some days before the start date, so the date holds.",
    templates: [
      { field: "depositReminderSms", label: "Text message", kind: "sms", placeholders: ["{{first_name}}", "{{company_name}}", "{{amount}}", "{{start_date}}", "{{invoice_number}}", "{{link}}"] },
    ],
    timing: [
      { id: "afterIssue", label: "Days after issue", unit: "days", default: 3, min: 0, max: 60 },
      { id: "beforeStart", label: "Days before start", unit: "days", default: 5, min: 0, max: 60 },
    ],
    guard: "Each of the two once per invoice; stops when the deposit is paid.",
  },
  {
    key: "signoff_reminder", name: "Sign-off reminders", audience: "customer", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "both", approvable: true, defaultMode: "auto", sendKind: "signoff_reminder", capExempt: true,
    trigger: "The completion pack is sent and the customer has not signed: at once, then 24 h and 48 h later. The reminder line is the wording already held in the database (it never says the job will be treated as signed).",
    templates: [
      { field: "signoffReminderSubject", label: "Email subject", kind: "subject", placeholders: ["{{first_name}}", "{{address}}", "{{reminder}}", "{{company_name}}", "{{link}}"] },
      { field: "signoffReminderBody", label: "Email body", kind: "body", placeholders: ["{{first_name}}", "{{address}}", "{{reminder}}", "{{company_name}}", "{{link}}"] },
      { field: "signoffReminderSms", label: "Text message", kind: "sms", placeholders: ["{{first_name}}", "{{address}}", "{{company_name}}", "{{link}}"] },
    ],
    guard: "Each rung once per job; stops at signature.",
  },
  {
    key: "variation_reminder", name: "Variation waiting for approval — reminder", audience: "customer", channels: ["sms", "email"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "variation_reminder",
    trigger: "A priced change was sent for the customer's approval and nothing has come back: a text after 24 h, again at 48 h.",
    templates: [
      { field: "variationReminderSms", label: "Text message", kind: "sms", placeholders: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{link}}"] },
    ],
    timing: [
      { id: "first", label: "First reminder", unit: "hours", default: 24, min: 1, max: 240 },
      { id: "second", label: "Second reminder", unit: "hours", default: 48, min: 1, max: 480 },
    ],
    guard: "Each rung once per variation; stops when they approve or decline.",
  },
  {
    key: "contractor_invoice_prompt", name: "Job signed off — send your invoice", audience: "painter", channels: ["sms"], kind: "automatic",
    defaultChannel: "sms", approvable: true, defaultMode: "auto", sendKind: "contractor_invoice_prompt", capExempt: true,
    trigger: "The customer signs off and the painter's invoice draft is waiting: a text at sign-off, and again some days later if it still hasn't been submitted.",
    templates: [
      { field: "contractorInvoicePromptSms", label: "Text message", kind: "sms", placeholders: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{link}}"] },
    ],
    timing: [{ id: "again", label: "Again after", unit: "days", default: 3, min: 1, max: 30 }],
    guard: "Twice at most per job; stops when the invoice is submitted.",
  },
  {
    key: "office_signoff_overdue", name: "Sign-off overdue", audience: "office", channels: ["email", "sms"], kind: "automatic",
    defaultChannel: "email", sendKind: "office_alert", quietExempt: true, capExempt: true,
    trigger: "The completion pack went out and, after the set number of hours, the customer still hasn't signed off.",
    templates: [
      { field: "officeSignoffOverdueSubject", label: "Email subject", kind: "subject", placeholders: ["{{job}}", "{{wo_ref}}", "{{customer_name}}", "{{hours_since}}", "{{link}}"] },
      { field: "officeSignoffOverdueBody", label: "Message", kind: "body", placeholders: ["{{job}}", "{{wo_ref}}", "{{customer_name}}", "{{hours_since}}", "{{link}}"] },
    ],
    timing: [{ id: "after", label: "After", unit: "hours", default: 72, min: 1, max: 720 }],
    guard: "Once per job. Reaches each staff member who ticked it under Staff alerts.",
  },

  // ---- brought onto the list in Session 1 (16 Sep) -------------------------
  {
    key: "tenant_access_text", name: "Tenant access text", audience: "customer", channels: ["sms"], kind: "manual",
    trigger: "A trade customer texts a tenant a link to the photos and plan from the property page. The link lasts a set number of days.",
    templates: [
      { field: "tenantLinkSms", label: "Text message", kind: "sms", placeholders: ["{{company_name}}", "{{who_asked}}", "{{agency_line}}", "{{address}}", "{{link}}"] },
    ],
  },
  {
    key: "crm_record_reply", name: "Reply from the customer record", audience: "customer", channels: ["email", "sms"], kind: "manual",
    trigger: "A staff member writes a reply on the customer's CRM record and presses Send. Free wording each time.",
    wording: "Typed per message on the record.",
    href: "/crm",
  },
  {
    key: "contractor_gcal_push", name: "Google Calendar — jobs on the painter's calendar", audience: "painter", channels: [], kind: "automatic",
    trigger: "A booked job is written to the painter's connected Google Calendar as a 07:30–15:30 block; moves and cancellations follow. Off: nothing is written or changed.",
    wording: "Not a message — the calendar entry carries the job address and portal link.",
  },

  // ---- recorded, not yet sent ---------------------------------------------
  {
    key: "review_request", name: "Review request", audience: "customer", channels: [], kind: "planned",
    trigger: "After sign-off. Recorded as a follow-up task; no message goes out yet.",
  },
  {
    key: "booking_chase", name: "Booking chase", audience: "customer", channels: [], kind: "planned",
    trigger: "An accepted estimate with no booking. Shows as a card on the CRM board; no automatic message.",
  },
  {
    key: "wizard_abandoned", name: "Abandoned wizard — pick up where you left off", audience: "customer", channels: ["email"], kind: "automatic",
    defaultChannel: "email", quietExempt: true, capExempt: true, sendKind: "wizard_resume",
    trigger: "A wizard run sits idle for 45 minutes with an email on it. One sign-in link per run, landing on the customer's account page where the unfinished estimate waits. Sent by the sweep — every 30 minutes, and whenever staff open CRM Today or Estimates → Wizard.",
    templates: [
      { field: "wizardResumeSubject", label: "Email subject", kind: "subject", placeholders: P.wizardResume },
      { field: "wizardResumeBody", label: "Email body", kind: "body", placeholders: P.wizardResume },
    ],
    note: "Never sent to a run without an email (the contact page is last), nor to a test address.",
  },
];

// Tom, 10 Sep: the screen is broken into Customers / Contractors / Staff.
export const AUDIENCE_LABEL: Record<Audience, string> = {
  customer: "Customers",
  painter: "Contractors",
  office: "Staff",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email", sms: "Text", ics: "Calendar invite", pdf: "PDF attached",
};

export function automationByKey(key: string): Automation | undefined {
  return AUTOMATIONS.find((a) => a.key === key);
}
