import { nextOpen } from "@/lib/time/businessHours";
import type { StaffEventKey, StaffNotifyChannel } from "./notifyEvents";

/**
 * Lead L9 / L10 / L13 (R4, 17 Nov 2026) — the pure half: which request event
 * is which alert, and the office-hours switch. Client-safe; the sends are
 * lib/staff/requestAlerts.ts.
 */

/** The CRM event types that are a customer asking for a person. */
export const REQUEST_ALERT_TYPES: ReadonlySet<string> = new Set([
  "wizard_help_requested", "wizard_question_asked", "visit_request_made", "callback_requested",
]);

type Payload = { kind?: unknown; requestId?: unknown; phone?: unknown; note?: unknown; page?: unknown; zone?: unknown };

/** Which alert an event is: L9 help, L10 visit, L13 call — or none. Pure. */
export function requestAlertKey(type: string, payload: unknown): StaffEventKey | null {
  const p = (payload ?? {}) as Payload;
  if (type === "wizard_help_requested" || type === "wizard_question_asked") return "office_lead_help";
  if (type === "visit_request_made") return p.kind === "call" ? "office_call_request" : "office_visit_request";
  if (type === "callback_requested") return "office_call_request";
  return null;
}

/** R4's switch. Pure: in office hours, email (and the pop-up); out of hours, the text as well. */
export function requestAlertRoute(now: Date, holidays: ReadonlySet<string>): { inHours: boolean; channels: StaffNotifyChannel[] } {
  const inHours = nextOpen(now, holidays).getTime() === now.getTime();
  return { inHours, channels: inHours ? ["email"] : ["email", "sms"] };
}

const DUE = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** "Tue 18 Nov, 5:00 pm" — a reply-by in Melbourne time. */
export const dueWords = (iso: string): string => DUE.format(new Date(iso));

