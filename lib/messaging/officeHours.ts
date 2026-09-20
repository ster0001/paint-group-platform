/**
 * Office hours for the customer chat (Tom, 20 Sep 2026): Monday to Friday,
 * 8:30am to 4:30pm, Melbourne time. Outside them the chat tells the customer
 * the message is received and when the office is back. Client-safe, no
 * offset written down (Melbourne is +10 or +11 — the zone decides).
 */
export const OFFICE_HOURS = {
  timezone: "Australia/Melbourne",
  days: ["mon", "tue", "wed", "thu", "fri"] as const,
  open: "08:30",
  close: "16:30",
};
export const OFFICE_HOURS_LINE = "Monday to Friday, 8:30am to 4:30pm";
export const AFTER_HOURS_NOTE = `Thanks — we've received your message. Our office hours are ${OFFICE_HOURS_LINE}; we'll get back to you as soon as we're open.`;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function officeOpenAt(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: OFFICE_HOURS.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3);
  if (!(OFFICE_HOURS.days as readonly string[]).includes(day)) return false;
  const m = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return m >= minutes(OFFICE_HOURS.open) && m < minutes(OFFICE_HOURS.close);
}
