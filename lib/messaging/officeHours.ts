import { CLOSE_HOUR, OPEN_HOUR } from "@/lib/time/businessHours";

/**
 * Office hours for the customer chat. Since 12 Nov 2026 (Tom: "8–5, as the
 * brief") they are the one set in lib/time/businessHours — Monday to Friday,
 * 8am to 5pm, Melbourne time. Outside them the chat tells the customer
 * the message is received and when the office is back. Client-safe, no
 * offset written down (Melbourne is +10 or +11 — the zone decides).
 */
export const OFFICE_HOURS = {
  timezone: "Australia/Melbourne",
  days: ["mon", "tue", "wed", "thu", "fri"] as const,
  open: `${String(OPEN_HOUR).padStart(2, "0")}:00`,
  close: `${String(CLOSE_HOUR).padStart(2, "0")}:00`,
};
const ampm = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
export const OFFICE_HOURS_LINE = `Monday to Friday, ${ampm(OPEN_HOUR)} to ${ampm(CLOSE_HOUR)}`;
/** The same hours as the wizard words them for the phone lines. */
export const PHONE_HOURS_LINE = `${ampm(OPEN_HOUR)} \u2013 ${ampm(CLOSE_HOUR)}, Monday to Friday`;
export const AFTER_HOURS_NOTE = `Thanks — we've received your message. Our office hours are ${OFFICE_HOURS_LINE}; we'll get back to you as soon as we're open.`;
/** Estimates tab session 4 (brief §4.4): the Work queue banner out of hours, read from the same hours. */
export const AFTER_HOURS_NOTE_STAFF = `Out of office hours (${OFFICE_HOURS_LINE}). Call-back and help requests that come in now wait until the office opens.`;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function officeOpenAt(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: OFFICE_HOURS.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3);
  if (!(OFFICE_HOURS.days as readonly string[]).includes(day)) return false;
  const m = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return m >= minutes(OFFICE_HOURS.open) && m < minutes(OFFICE_HOURS.close);
}
