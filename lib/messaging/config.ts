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
};

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
 * "0422 453 136" → "+61422453136"; already-international numbers pass through.
 * Returns null when the number can't be made sendable.
 */
export function normalisePhoneAU(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, "");
  if (/^\+\d{7,15}$/.test(s)) return s;
  if (/^61\d{9}$/.test(s)) return `+${s}`;
  if (/^0\d{9}$/.test(s)) return `+61${s.slice(1)}`;
  return null;
}
