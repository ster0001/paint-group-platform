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
};

const P = {
  estimate: ["{{first_name}}", "{{name}}", "{{company_name}}", "{{estimate_title}}", "{{total}}", "{{estimator_name}}", "{{link}}"],
  preStart: ["{{first_name}}", "{{company_name}}", "{{start_date}}", "{{address}}", "{{estimate_title}}"],
  appt: ["{{first_name}}", "{{company_name}}", "{{address}}", "{{start_date}}", "{{painter_name}}", "{{walkthrough_line}}"],
  offer: ["{{first_name}}", "{{company_name}}", "{{wo_ref}}", "{{link}}"],
  variation: ["{{company_name}}", "{{wo_ref}}", "{{action}}", "{{link}}"],
  qaFail: ["{{company_name}}", "{{wo_ref}}", "{{link}}"],
  walkthrough: ["{{first_name}}", "{{customer_name}}", "{{painter_name}}", "{{painter_first_name}}", "{{walkthrough_when}}", "{{address}}", "{{company_name}}"],
  signed: ["{{first_name}}", "{{job_title}}", "{{signed_by}}", "{{company_name}}"],
  chat: ["{{company_name}}", "{{link}}"],
  receipt: ["{{first_name}}", "{{amount}}", "{{invoice_number}}", "{{receipt_number}}", "{{company_name}}"],
  remittance: ["{{contractor_company}}", "{{invoice_number}}", "{{wo_ref}}", "{{amount}}", "{{bank_reference}}", "{{remittance_number}}", "{{company_name}}"],
  wizardSaved: ["{{company_name}}", "{{next_step}}"],
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
    trigger: "A staff member posts a reply on an estimate's chat — the customer is told there's a new message.",
    templates: [
      { field: "chatReplySubject", label: "Email subject", kind: "subject", placeholders: P.chat },
      { field: "chatReplySms", label: "Text message", kind: "sms", placeholders: P.chat },
    ],
  },
  {
    key: "wizard_saved_link", name: "Estimate saved — sign-in link", audience: "customer", channels: ["email"], kind: "automatic",
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
    trigger: "The job is booked in — the painter accepts the offer, or the office assigns one directly.",
    templates: [
      { field: "apptConfirmSubject", label: "Email subject", kind: "subject", placeholders: P.appt },
      { field: "apptConfirmBody", label: "Email body", kind: "body", placeholders: P.appt },
    ],
    guard: "Once per booked start date — a re-book to a new date sends again.",
  },
  {
    key: "pre_start_checklist", name: "Pre-start checklist", audience: "customer", channels: ["email"], kind: "automatic",
    trigger: "The office ticks “Pre-start checklist” on the job's pre-start list; the email goes out N days before the start date.",
    templates: [
      { field: "preStartDaysBefore", label: "Days before start", kind: "number" },
      { field: "preStartSubject", label: "Email subject", kind: "subject", placeholders: P.preStart },
      { field: "preStartBody", label: "Checklist (email body)", kind: "body", placeholders: P.preStart },
    ],
    guard: "Once per job.",
  },
  {
    key: "walkthrough_invite", name: "Final walkthrough calendar invite", audience: "customer", channels: ["email", "ics"], kind: "automatic",
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
    trigger: "A job is offered, re-offered or reassigned to a painter. The offer holds for 24 hours.",
    templates: [
      { field: "offerSms", label: "Text message", kind: "sms", placeholders: P.offer },
      { field: "offerEmailSubject", label: "Email subject", kind: "subject", placeholders: P.offer },
      { field: "offerEmailIntro", label: "Email body", kind: "body", placeholders: P.offer },
    ],
    note: "Text needs a mobile on the painter's profile.",
  },
  {
    key: "variation_auto_release", name: "Approved variations go straight to the painter", audience: "painter", channels: [], kind: "automatic",
    trigger: "The customer signs a priced addition. On: it lands on the painter's home page for their acceptance at once. Off: the office releases it from the job page.",
    special: "variation_release",
  },
  {
    key: "contractor_variation_released", name: "Variation waiting on you", audience: "painter", channels: ["sms"], kind: "automatic",
    trigger: "An approved variation is released to the painter (automatically at signing, or by the office).",
    templates: [{ field: "variationReleasedSms", label: "Text message", kind: "sms", placeholders: P.variation }],
    guard: "Once per variation.",
  },
  {
    key: "contractor_qa_fail", name: "Quality check — put right", audience: "painter", channels: ["sms"], kind: "automatic",
    trigger: "The office records a failed quality check on the painter's job.",
    templates: [{ field: "qaFailSms", label: "Text message", kind: "sms", placeholders: P.qaFail }],
    guard: "Once per check.",
  },
  {
    key: "contractor_remittance", name: "Remittance advice", audience: "painter", channels: ["email", "pdf"], kind: "automatic",
    trigger: "The office marks a painter's invoice as paid.",
    templates: [
      { field: "remittanceSubject", label: "Email subject", kind: "subject", placeholders: P.remittance },
      { field: "remittanceBody", label: "Email body", kind: "body", placeholders: P.remittance },
    ],
  },

  // ---- office / trade -----------------------------------------------------
  {
    key: "external_approval", name: "External approval request", audience: "customer", channels: ["email"], kind: "automatic",
    trigger: "A trade customer sends an estimate to an approver, assessor or owner for sign-off; the sender is emailed the decision.",
    wording: "Fixed wording.",
  },
  {
    key: "trade_daily_digest", name: "Trade daily digest", audience: "customer", channels: ["email"], kind: "automatic",
    trigger: "Once a day, each trade-organisation admin gets a summary of what moved on their properties.",
    wording: "Fixed wording; each person sets their own time under Team.",
    note: "Needs the trade-digest cron scheduled in vercel.json — it is not, today.",
  },
  {
    key: "assistant_handoff", name: "Assistant — someone wants a person", audience: "office", channels: ["sms"], kind: "automatic",
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

  // ---- recorded, not yet sent ---------------------------------------------
  {
    key: "signoff_nudges", name: "Sign-off reminders", audience: "customer", channels: [], kind: "planned",
    trigger: "0h / 24h / 48h after the walkthrough with no signature. The copy exists in the database; nothing sends it yet.",
  },
  {
    key: "review_request", name: "Review request", audience: "customer", channels: [], kind: "planned",
    trigger: "After sign-off. Recorded as a follow-up task; no message goes out yet.",
  },
  {
    key: "booking_chase", name: "Booking chase", audience: "customer", channels: [], kind: "planned",
    trigger: "An accepted estimate with no booking. Shows as a card on the CRM board; no automatic message.",
  },
  {
    key: "wizard_abandoned", name: "Abandoned wizard follow-up", audience: "customer", channels: [], kind: "planned",
    trigger: "A wizard run left unfinished. Logged as a CRM event so a campaign can pick it up; nothing sends by itself.",
  },
];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  customer: "Customers",
  painter: "Painters",
  office: "Office",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email", sms: "Text", ics: "Calendar invite", pdf: "PDF attached",
};

export function automationByKey(key: string): Automation | undefined {
  return AUTOMATIONS.find((a) => a.key === key);
}
