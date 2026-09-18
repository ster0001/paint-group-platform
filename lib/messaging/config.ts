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

import type { AutomationControl, QuietHours } from "@/lib/automations/controls";

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

  // ---- Session 1 controls (Tom's brief, 16 Sep 2026) ------------------------
  /** Per automation: channel (Text/Email/Both), mode (auto / office approves first), timing numbers. Absent = registry default. */
  controls: Record<string, AutomationControl>;
  /** D1: when automatic customer and painter messages may go out (Melbourne). Held otherwise, released at the next opening. */
  quietHours: QuietHours;
  /** D2: automatic job messages per customer per day; the registry marks the exempt ones. */
  dailyCap: number;

  /** Staff alerts — wording (was fixed in code before Session 1). Placeholders per event, see the registry. */
  officeJobAcceptedSubject: string;
  officeJobAcceptedBody: string;
  officeJobDeclinedSubject: string;
  officeJobDeclinedBody: string;
  officeInvoicePaidSubject: string;
  officeInvoicePaidBody: string;
  officeVariationRaisedSubject: string;
  officeVariationRaisedBody: string;
  officeContractorInvoiceSubject: string;
  officeContractorInvoiceBody: string;
  /** The tenant access text a trade customer sends from the portal (manual; wording editable). */
  tenantLinkSms: string;

  // ---- Session 3 (16 Sep 2026): money and sign-off ---------------------------
  welcomeSubject: string;
  welcomeBody: string;
  welcomeSms: string;
  invoiceReminder1Subject: string;
  invoiceReminder1Body: string;
  invoiceReminder2Subject: string;
  invoiceReminder2Body: string;
  invoiceReminder3Subject: string;
  invoiceReminder3Body: string;
  invoiceReminder4Subject: string;
  invoiceReminder4Body: string;
  invoiceReminderSms: string;
  depositReminderSms: string;
  signoffReminderSubject: string;
  signoffReminderBody: string;
  signoffReminderSms: string;
  variationReminderSms: string;
  contractorInvoicePromptSms: string;
  officeSignoffOverdueSubject: string;
  officeSignoffOverdueBody: string;

  /** Painter: "you have a job offer" (send / reassign / re-offer). */
  offerSms: string;
  offerEmailSubject: string;
  offerEmailIntro: string;
  /** Employee (employed-painters S2): a job is assigned — open it and tap Accept. */
  assignmentSms: string;
  assignmentEmailSubject: string;
  assignmentEmailIntro: string;
  /** Employee: their dates on a job changed — accept again. */
  assignmentDatesChangedSms: string;
  /** Employee: taken off a job. */
  assignmentReleasedSms: string;
  /** Employee (S7): they are now the lead painter on a job. */
  leadChangedSms: string;
  /** Employee (S7): the customer approved a change on their job — hours added, no price. */
  employeeVariationApprovedSms: string;
  /** Painter (S7): an expense claim was approved or rejected. */
  expenseDecidedSms: string;
  /** Employee (S7): leave / RDO approved or declined. */
  leaveDecidedSms: string;
  /** Painter: an approved addition is waiting for their acceptance. */
  variationReleasedSms: string;
  /** Painter: a failed quality check, areas to put right. */
  qaFailSms: string;
  /** P6 — Customer: the estimator visit, confirmed with a calendar invite; and the text the evening before. */
  visitConfirmSubject: string;
  visitConfirmBody: string;
  visitReminderSms: string;
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
  /** Customer: they dropped out of the wizard — pick up where they left off (Tom, 7 Sep). */
  wizardResumeSubject: string;
  wizardResumeBody: string;
  /** Office: an estimate was accepted (Tom, 4 Sep). */
  officeEmail: string;
  acceptedOfficeSubject: string;
  acceptedOfficeBody: string;
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

  controls: {},
  quietHours: { weekday: [8, 19], saturday: [9, 17], sunday: null },
  dailyCap: 3,

  officeJobAcceptedSubject: "Job accepted — {{painter}} · {{job}}",
  officeJobAcceptedBody: "{{painter}} has accepted {{wo_ref}} ({{job}}) starting {{start_date}}.{{proposed_line}}{{note_line}}",
  officeJobDeclinedSubject: "Job declined — {{painter}} · {{job}}",
  officeJobDeclinedBody: "{{painter}} has declined {{wo_ref}} ({{job}}) for {{start_date}}.{{reason_line}}\n\nThe job is back with the office to re-offer.",
  officeInvoicePaidSubject: "Invoice paid — {{amount}} · {{job}}",
  officeInvoicePaidBody: "{{who}} has paid {{amount}} on invoice {{invoice_number}} for {{job}} ({{method}}).",
  officeVariationRaisedSubject: "Variation raised — {{job}}",
  officeVariationRaisedBody: "{{painter}} has raised a variation on {{wo_ref}} ({{job}}): {{category}}{{hours_line}}.\n\n“{{comment}}”\n\nIt is waiting to be priced.",
  officeContractorInvoiceSubject: "Contractor invoice in — {{painter}} · {{amount}}",
  officeContractorInvoiceBody: "{{painter}} has submitted invoice {{invoice_number}} for {{amount}} on {{wo_ref}} ({{job}}). It is waiting for approval in Payments.",
  // THE TENANT TEXT IS THE ONE MESSAGE THAT GOES TO SOMEONE WHO NEVER ASKED US
  // FOR ANYTHING (Tom, 18 Sep 2026). A tenant gets an unexpected text from a
  // painting company asking them to photograph their home, so it says who we
  // are, who asked, and — the line that stops the phone call to the agent —
  // that it has nothing to do with their bond or their lease. This default WAS
  // a terser line, which silently replaced the careful wording the moment this
  // field was added (it is used whenever it is non-blank, and it is never
  // blank). `tenantMessage()` in lib/portal/tenant-link.ts renders THIS string,
  // so the words live in exactly one place. Under 320 characters = two segments.
  tenantLinkSms:
    "Hi — this is {{company_name}}, painters. {{who_asked}} to quote some painting at {{address}}. "
    + "Could you take a few photos on your phone so we can plan it without a visit? "
    + "It's nothing to do with your bond or your lease. "
    + "Photos go here: {{link}}",

  welcomeSubject: "Thank you for choosing {{company_name}} — what happens next",
  welcomeBody:
    "Hello {{first_name}},\n\n" +
    "Thank you for choosing {{company_name}} for {{address}}. Here's what happens next: we'll confirm your painter and start date, then keep you updated at every step.\n\n" +
    "Everything — updates, invoices, colours and messages — lives in your account.{{deposit_line}}\n\n" +
    "Any questions, just reply to this email or give us a call.",
  welcomeSms: "Hello {{first_name}}, thank you for choosing {{company_name}}. We'll confirm your painter and start date and keep you posted. Your account: {{link}}",
  invoiceReminder1Subject: "A quick reminder — invoice {{invoice_number}}",
  invoiceReminder1Body:
    "Hello {{first_name}},\n\n" +
    "A quick reminder that invoice {{invoice_number}} for {{amount}} was due on {{due_date}}. You can pay here: {{link}}\n\n" +
    "If you've already paid, thank you, and please ignore this.",
  invoiceReminder2Subject: "Invoice {{invoice_number}} — still outstanding",
  invoiceReminder2Body:
    "Hello {{first_name}},\n\n" +
    "Invoice {{invoice_number}} for {{amount}} was due on {{due_date}} and we haven't seen the payment come through yet. The invoice, the pay-by-card link and our bank details are here: {{link}}\n\n" +
    "If something isn't right with the invoice, reply to this email or give us a call and we'll sort it out.",
  invoiceReminder3Subject: "Invoice {{invoice_number}} is {{days_overdue}} days overdue",
  invoiceReminder3Body:
    "Hello {{first_name}},\n\n" +
    "Invoice {{invoice_number}} for {{amount}} is now {{days_overdue}} days overdue. Please arrange payment here: {{link}}\n\n" +
    "If there's a reason it can't be paid yet, let us know a date we can expect it and we'll note it on your account.",
  invoiceReminder4Subject: "Invoice {{invoice_number}} — please call us",
  invoiceReminder4Body:
    "Hello {{first_name}},\n\n" +
    "Invoice {{invoice_number}} for {{amount}} is {{days_overdue}} days overdue and we haven't heard from you. Please pay here: {{link}} — or call us today so we can agree a way forward.",
  invoiceReminderSms: "{{company_name}}: invoice {{invoice_number}} for {{amount}} is {{days_overdue}} days overdue. Pay or see the details here: {{link}}",
  depositReminderSms: "{{company_name}}: a reminder that your deposit of {{amount}} holds your start date of {{start_date}}. Pay here: {{link}}",
  signoffReminderSubject: "Your painting at {{address}} — please review and sign off",
  signoffReminderBody:
    "Hello {{first_name}},\n\n" +
    "{{reminder}}\n\n" +
    "Review the finished work and sign off here: {{link}}\n\n" +
    "Any questions, just reply to this email.",
  signoffReminderSms: "{{company_name}}: your painting at {{address}} is complete. When you have a moment, please review and sign off here: {{link}}",
  variationReminderSms: "{{company_name}}: a change to your painting job is waiting for your approval. Review it here: {{link}}",
  contractorInvoicePromptSms: "{{company_name}}: {{wo_ref}} is signed off — please send your invoice from your Money tab so we can pay you: {{link}}",
  officeSignoffOverdueSubject: "Sign-off overdue — {{job}}",
  officeSignoffOverdueBody: "The walkthrough on {{wo_ref}} ({{job}}) was done and the completion pack sent {{hours_since}} hours ago, but {{customer_name}} has not signed off. Worth a call.",

  offerSms:
    "{{company_name}}: you have a job offer ({{wo_ref}}) — it holds for 24 hours. Open your portal to see it and answer: {{link}}",
  offerEmailSubject: "You have a job offer — {{wo_ref}}",
  offerEmailIntro:
    "Hi {{first_name}},\n\n" +
    "{{company_name}} has offered you a job ({{wo_ref}}). The offer holds for 24 hours — " +
    "sign in to your portal to see the dates, the price and the job sheet, and give your answer.",
  assignmentSms:
    "{{company_name}}: you're on {{wo_ref}} from {{start_date}} ({{address}}). Open your work order and tap Accept: {{link}}",
  assignmentEmailSubject: "You're on a job — {{wo_ref}}, from {{start_date}}",
  assignmentEmailIntro:
    "Hi {{first_name}},\n\n" +
    "{{company_name}} has put you on {{wo_ref}} at {{address}}, {{dates}}. " +
    "Open your work order to see the job sheet, and tap Accept so the office knows you've seen it.",
  assignmentDatesChangedSms:
    "{{company_name}}: your dates on {{wo_ref}} have changed to {{dates}}. Open the job and tap Accept again: {{link}}",
  assignmentReleasedSms:
    "{{company_name}}: you're no longer needed on {{wo_ref}} ({{address}}). Nothing to do — your calendar is updated.",
  leadChangedSms:
    "{{company_name}}: you're now the lead painter on {{wo_ref}} ({{address}}) — the customer's updates and walkthrough go through you: {{link}}",
  employeeVariationApprovedSms:
    "{{company_name}}: the customer approved a change on {{wo_ref}}{{hours_line}}. It's on your job page: {{link}}",
  expenseDecidedSms:
    "{{company_name}}: your expense claim of {{amount}} on {{wo_ref}} was {{decision}}.{{reason_line}}",
  leaveDecidedSms:
    "{{company_name}}: your {{kind_word}} request for {{dates}} was {{decision}}.{{reason_line}}",
  variationReleasedSms:
    "{{company_name}}: a variation on {{wo_ref}} is approved and waiting on you — {{action}} it in your dashboard: {{link}}",
  qaFailSms:
    "{{company_name}}: the quality check on {{wo_ref}} found areas that need rectifying. The details and photos are on the job in your portal: {{link}}",
  visitConfirmSubject: "Your visit is booked — {{visit_when}}",
  visitConfirmBody:
    "Hello {{first_name}},\n\n" +
    "{{estimator_name}} from {{company_name}} will be at {{address}} on {{visit_when}} to look at the job with you.\n\n" +
    "The attached invite drops it into your calendar. It usually takes about an hour: we walk through what's being painted, check the surfaces, and confirm your price.\n\n" +
    "If that time no longer suits, reply to this email or call us and we'll move it.",
  visitReminderSms:
    "{{company_name}}: a reminder that {{estimator_name}} is visiting {{address}} tomorrow, {{visit_when}}. Reply or call us if anything's changed.",
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
  officeEmail: "info@paintgroup.com.au",
  acceptedOfficeSubject: "Estimate accepted — {{estimate_title}} ({{total}})",
  acceptedOfficeBody:
    "{{accepted_name}} has accepted the estimate for {{estimate_title}}.\n\n" +
    "Total: {{total}} incl. GST\nDeposit: {{deposit}}\nAccepted: {{accepted_at}}\n\n" +
    "A work order has been created and the deposit invoice is drafted. Open the estimate to book it in.",
  wizardResumeSubject: "Pick up where you left off — your estimate is saved",
  wizardResumeBody:
    "You were part-way through your {{company_name}} estimate for {{where}} — your answers are saved.\n\n" +
    "The button below signs you straight in, no password needed. Your estimate is on your account page, " +
    "marked \"not yet submitted\" — finish it whenever suits.\n\n" +
    "The sign-in link lasts an hour; you can always ask for a fresh one from the account page.",
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
  /** S7: "approved" | "declined" | "rejected", and "leave" | "RDO". */
  decision?: string;
  kind_word?: string;
  dates?: string;
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
  /** P6: "Tue 8 Sep at 10:00 am" for the visit confirmation and reminder. */
  visit_when?: string;
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
  /** Wizard resume (7 Sep): the address or suburb, and the page they stopped on. */
  where?: string;
  page?: string;
  accepted_name?: string;
  accepted_at?: string;
  deposit?: string;
  // Session 1 (16 Sep): staff-alert wording and the tenant text.
  painter?: string;
  job?: string;
  proposed_line?: string;
  note_line?: string;
  reason_line?: string;
  who?: string;
  method?: string;
  category?: string;
  hours_line?: string;
  comment?: string;
  who_asked?: string;
  agency_line?: string;
  // Session 3: money and sign-off reminders.
  due_date?: string;
  days_overdue?: string;
  deposit_line?: string;
  reminder?: string;
  hours_since?: string;
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
