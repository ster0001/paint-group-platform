import { melbourneParts } from "@/lib/time/businessHours";
import { parseQuietHours, withinSendingHours } from "@/lib/automations/controls";
import type { VisitRow } from "./types";

/** Lead L11 (17 Nov 2026) — the pure half of the two-hour visit text; the send is lib/visits/notify.ts. */

const two = (n: number) => String(n).padStart(2, "0");
const HOUR = 3_600_000;

/**
 * Pure: which booked visits are due the two-hour text now. Due from two hours
 * before the start until one hour before — never closer, so a sweep that runs
 * late never texts someone whose estimator is at the door. Inside quiet hours
 * nothing is due: an 8:30 visit's window (6:30–7:30) falls before sending
 * hours open, and that customer already had the evening-before text.
 */
export function dueForTwoHourReminder<V extends Pick<VisitRow, "starts_at" | "status" | "customer_phone">>(visits: V[], now: Date, quietHours: unknown = undefined): V[] {
  if (!withinSendingHours(now, parseQuietHours(quietHours))) return [];
  const t = now.getTime();
  return visits.filter((v) => {
    if (v.status !== "booked" || !v.customer_phone) return false;
    const start = Date.parse(v.starts_at);
    return t >= start - 2 * HOUR && t < start - HOUR;
  });
}

/** "10:00 am and 11:00 am" — Appendix A's {window}, Melbourne time. */
export function visitWindow(startsAt: string, endsAt: string): string {
  const t = (iso: string) => { const p = melbourneParts(new Date(iso)); return `${p.h % 12 === 0 ? 12 : p.h % 12}:${two(p.min)} ${p.h < 12 ? "am" : "pm"}`; };
  return `${t(startsAt)} and ${t(endsAt)}`;
}

