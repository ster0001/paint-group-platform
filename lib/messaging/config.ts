/**
 * Messaging settings — the email/SMS wording sent with an estimate.
 *
 * Stored in the `settings` table under one key so the Settings page and the
 * send dialog read the same source. Placeholders are rendered with
 * renderTemplate() just before sending, so the saved templates stay generic.
 *
 * This module is imported on both client (dialog, settings UI) and server
 * (delivery) — keep it free of secrets and server-only imports.
 */

export const MESSAGING_KEY = "messaging";

export type MessagingSettings = {
  emailSubject: string;
  emailIntro: string;
  smsEnabled: boolean;
  smsTemplate: string;
  /**
   * The pre-start checklist (Tom, 23 Aug): emailed to the customer N days
   * before the job starts, when the office ticks "Pre-start checklist" on the
   * job's pre-start list. Placeholders: first_name, company_name, start_date,
   * address, estimate_title.
   */
  preStartDaysBefore: number;
  preStartSubject: string;
  preStartBody: string;
  /**
   * Appointment confirmation (Tom, 1 Sep): emailed to the customer the moment
   * their job is booked in (the contractor accepts, or the office assigns
   * directly). Placeholders: first_name, company_name, address, start_date,
   * painter_name, walkthrough_line (a whole sentence — the booked final's
   * date/time, or "we'll confirm it with you" when not yet organised).
   */
  apptConfirmSubject: string;
  apptConfirmBody: string;

  // ---- Automations (Tom, 3 Sep 2026) ---------------------------------------
  // Every automatic message the platform sends is listed in
  // lib/automations/registry.ts. The office can switch any automatic one off
  // here (`disabled` holds the registry keys) and edit the wording below.
  // Manual sends (an estimate, an invoice, a customer update) keep their
  // per-send choices; they are listed for completeness, not gated.

  /** Registry keys switched OFF. Absent key = on (the shipped default). */
  disabled: string[];

  /** Painter: "you have a job offer" (send / reassign / re-offer). */
  offerSms: string;
  offerEmailSubject: string;
  offerEmailIntro: string;
  /** Painter: an approved addition is waiting for their acceptance. */
  variationReleasedSms: string;
  /** Painter: a failed quality check, areas to put right. */
  qaFailSms: string;
  /** Customer + painter: the final walkthrough calendar invite. */
  walkthroughInviteSubject: string;
  walkthroughInviteCustomerBody: string;
  walkthroughInvitePainterBody: string;
  /** Customer: the signed completion report. */
  signedReportSubject: string;
  signedReportBody: string;
  /** Customer: a staff reply on the estimate chat. */
  chatReplySubject: string;
  chatReplySms: string;
  /** Customer: a payment receipt. */
  receiptSubject: string;
  receiptBody: string;
  /** Painter: remittance advice when their invoice is paid. */
  remittanceSubject: string;
  remittanceBody: string;
  /** Customer: the wizard saved their estimate (sign-in link). */
  wizardSavedSubject: string;
  wizardSavedBody: string;
};

export const DEFAULT_MESSAGING: MessagingSettings = {
  emailSubject: "Your painting estimate from {{company_name}}",
  emailIntro:
    "Hi {{first_name}},\n\n" +
    "Thanks for the opportunity to quote on your painting project. Your estimate is ready — " +
    "click the button below to view it.\n\n" +
    "If anything needs adjusting, just reply to this email or give us a call and we'll update it for you.",
  smsEnabled: false,
  smsTemplate:
    "Hi {{first_name}}, your painting estimate from {{company_name}} is ready. View it here: {{link}}",
  preStartDaysBefore: 2,
  preStartSubject: "Your painting starts {{start_date}} — a quick checklist",
  preStartBody:
    "Hi {{first_name}},\n\n" +
    "We're looking forward to starting at {{address}} on {{start_date}}. A few things that make the first day go smoothly:\n\n" +
    "• Clear a metre or so in front of the walls being painted — furniture pulled forward is fine.\n" +
    "• Take down pictures, mirrors, curtains and blinds where we're working.\n" +
    "• Small items off shelves, benches and windowsills.\n" +
    "• Let us know about pets, parking and access on the day.\n" +
    "• Colours are confirmed on your job sheet — tell us straight away if anything has changed.\n\n" +
    "Any questions, just reply to this email or give us a call.",
  apptConfirmSubject: "Your painting is booked in — starting {{start_date}}",
  apptConfirmBody:
    "Hello {{first_name}},\n\n" +
    "Good news — your painting at {{address}} is booked in, starting {{start_date}}.\n\n" +
    "Your painter will be {{painter_name}}. We start between 07:30 and 08:00 each morning.\n\n" +
    "{{walkthrough_line}}\n\n" +
    "Being there for the final walkthrough really matters: it's when we walk the finished job together, so you can confirm you're happy with the result — or point out anything that needs another touch before we sign off.\n\n" +
    "You'll also receive regular progress updates in your dashboard as the job moves along, photos included.\n\n" +
    "Any questions before we start, just reply to this email or give us a call.",

  disabled: [],

  offerSms:
    "{{company_name}}: you have a job offer ({{wo_ref}}) — it holds for 24 hours. Open your portal to see it and answer: {{link}}",
  offerEmailSubject: "You have a job offer — {{wo_ref}}",
  offerEmailIntro:
    "Hi {{first_name}},\n\n" +
    "{{company_name}} has offered you a job ({{wo_ref}}). The offer holds for 24 hours — " +
    "sign in to your portal to see the dates, the price and the job sheet, and give your answer.",
  variationReleasedSms:
    "{{company_name}}: a variation on {{wo_ref}} is approved and waiting on you — {{action}} it in your dashboard: {{link}}",
  qaFailSms:
    "{{company_name}}: the quality check on {{wo_ref}} found areas that need rectifying. The details and photos are on the job in your portal: {{link}}",
  walkthroughInviteSubject: "Final walk through — ({{customer_name}} x {{painter_name}})",
  walkthroughInviteCustomerBody:
    "Hello {{first_name}},\n\n" +
    "Your final walkthrough with {{painter_first_name}} is booked for {{walkthrough_when}} at {{address}}.\n\n" +
    "The attached invite drops it straight into your calendar — if the date ever moves, the entry updates itself.\n\n" +
    "Being there matters: it's when we walk the finished job together so you can confirm you're happy, or point out anything that needs another touch before sign-off.",
  walkthroughInvitePainterBody:
    "Final walkthrough with {{customer_name}} booked for {{walkthrough_when}} at {{address}}. The attached invite goes in your calendar and follows any date change.",
  signedReportSubject: "Your completion report — {{job_title}}",
  signedReportBody:
    "Hi {{first_name}},\n\n" +
    "Thanks — the work at {{job_title}} has been signed off{{signed_by}}.\n\n" +
    "Your completion report and warranty details are yours to keep — open them any time from the button below. They also live under Documents in your account.\n\n" +
    "Anything you notice later is covered by your two-year warranty — just reply to this email.",
  chatReplySubject: "New message about your estimate",
  chatReplySms: "{{company_name}}: you have a new message about your estimate. Open the chat: {{link}}",
  receiptSubject: "Receipt {{receipt_number}} — {{company_name}}",
  receiptBody:
    "Hello {{first_name}},\n\n" +
    "We have received your payment of {{amount}} against invoice {{invoice_number}}. " +
    "Your receipt number is {{receipt_number}}. You can see the up-to-date balance on your invoice at any time using the button below.",
  remittanceSubject: "Remittance advice {{remittance_number}} — {{company_name}}",
  remittanceBody:
    "Hello {{contractor_company}},\n\n" +
    "We've paid your invoice {{invoice_number}} for job {{wo_ref}} — {{amount}}{{bank_reference}}. " +
    "Your remittance advice {{remittance_number}} is attached below.",
  wizardSavedSubject: "Your estimate is saved",
  wizardSavedBody:
    "Your estimate is saved in your {{company_name}} account.\n\n" +
    "The button below signs you straight in — no password needed. {{next_step}}\n\n" +
    "The sign-in link lasts an hour; you can always ask for a fresh one from the account page.",
};

/**
 * Is an automation switched on? Absent from `disabled` = on. Callers pass the
 * MERGED settings ({...DEFAULT_MESSAGING, ...saved}) or a bare partial — a
 * missing or malformed list never switches anything off.
 */
export function automationOn(cfg: Partial<MessagingSettings> | null | undefined, key: string): boolean {
  const list = cfg?.disabled;
  return !(Array.isArray(list) && list.includes(key));
}

/** Placeholders offered in the Settings UI — keep this list in step with renderTemplate. */
export const TEMPLATE_PLACEHOLDERS = [
  "{{first_name}}",
  "{{name}}",
  "{{company_name}}",
  "{{estimate_title}}",
  "{{total}}",
  "{{estimator_name}}",
  "{{link}}",
] as const;

export type TemplateVars = {
  first_name?: string;
  start_date?: string;
  address?: string;
  name?: string;
  company_name?: string;
  estimate_title?: string;
  total?: string;
  estimator_name?: string;
  link?: string;
  /** Appointment confirmation (1 Sep): the assigned painter's first name. */
  painter_name?: string;
  /** A whole sentence about the final walkthrough — booked or to-be-confirmed. */
  walkthrough_line?: string;
  // Automations (3 Sep) — each template documents which of these it uses.
  wo_ref?: string;
  action?: string;
  customer_name?: string;
  painter_first_name?: string;
  walkthrough_when?: string;
  job_title?: string;
  signed_by?: string;
  receipt_number?: string;
  invoice_number?: string;
  amount?: string;
  contractor_company?: string;
  bank_reference?: string;
  remittance_number?: string;
  next_step?: string;
};

/** Fill {{placeholders}}; unknown or missing values render as empty string. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? "";
  });
}

/**
 * Normalise an Australian phone number to E.164 for SMS.
 * "0491 570 006" → "+61491570006"; already-international numbers pass through.
 * Returns null when the number can't be made sendable.
 */
export function normalisePhoneAU(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, "");
  if (/^\+\d{7,15}$/.test(s)) return s;
  if (/^61\d{9}$/.test(s)) return `+${s}`;
  if (/^0\d{9}$/.test(s)) return `+61${s.slice(1)}`;
  return null;
}
