/**
 * Availability and slots (P6, deep dive §4.6.2; brief ruling 3) — PURE.
 *
 * The wizard offers zone half-day WINDOWS (morning / afternoon), never exact
 * times: visits cluster geographically and the estimator keeps the order of
 * the day. A window is offered when at least one estimator who takes visits
 * works that day and still has a free block of their visit length inside it,
 * after the visits already booked. Booking a window picks the estimator with
 * the most room and the earliest free block — so the Diary shows a real
 * start and end, and the exclusion constraint has something to check.
 *
 * Every instant is Melbourne wall time via lib/time/businessHours; the host
 * clock never leaks in. Tested in availability.test.ts.
 */

import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";
import type { StaffAvailability, VisitsSettings } from "./types";

export type Busy = { staffId: string | null; startsAt: string; endsAt: string };

export type Window = {
  /** `YYYY-MM-DD|am` — what the wizard sends back. */
  key: string;
  date: string;
  part: "am" | "pm";
  /** "Tue 9 Sep · morning (9–12)" — the string the customer sees. */
  label: string;
  /** Estimators with room in it, most room first. */
  staffIds: string[];
};

export type Slot = { staffId: string; startsAt: string; endsAt: string };

const DAY_MS = 86_400_000;
const hm = (s: string): [number, number] => { const [h, m] = s.split(":").map(Number); return [h || 0, m || 0]; };
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Melbourne calendar date + wall time → instant. */
export function at(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hm(time);
  return melbourneInstant(y, m, d, h, min);
}

const clock12 = (time: string) => {
  const [h, m] = hm(time);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}` : `${hh}`;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 8 Sep" — composed, not Intl-formatted: ICU builds differ ("Sept", commas). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DOW[dow]} ${d} ${MON[m - 1]}`;
}

export function windowLabel(date: string, part: "am" | "pm", settings: VisitsSettings): string {
  const [from, to] = settings.windows[part];
  return `${dayLabel(date)} · ${part === "am" ? "morning" : "afternoon"} (${clock12(from)}–${clock12(to)})`;
}

/** The free blocks of `minutes` an estimator has between two instants, after their bookings. */
export function freeStarts(
  staffId: string, from: Date, to: Date, minutes: number, busy: Busy[], stepMinutes = 15,
): Date[] {
  const mine = busy.filter((b) => b.staffId === staffId)
    .map((b) => ({ s: new Date(b.startsAt).getTime(), e: new Date(b.endsAt).getTime() }));
  const out: Date[] = [];
  const len = minutes * 60_000;
  for (let t = from.getTime(); t + len <= to.getTime(); t += stepMinutes * 60_000) {
    const clash = mine.some((b) => t < b.e && t + len > b.s);
    if (!clash) out.push(new Date(t));
  }
  return out;
}

/** The instants a window occupies for one estimator: the window clipped to their day. */
function windowSpan(date: string, part: "am" | "pm", s: StaffAvailability, settings: VisitsSettings): { from: Date; to: Date } | null {
  const [wFrom, wTo] = settings.windows[part];
  const from = new Date(Math.max(at(date, wFrom).getTime(), at(date, s.dayStart).getTime()));
  const to = new Date(Math.min(at(date, wTo).getTime(), at(date, s.dayEnd).getTime()));
  return to > from ? { from, to } : null;
}

/**
 * The windows to offer: the next `horizonDays` business days on which some
 * estimator works, minus anything closer than the cutoff, minus windows with
 * no room left. Business days = days at least one estimator marks as theirs.
 */
export function offeredWindows(staff: StaffAvailability[], busy: Busy[], settings: VisitsSettings, now: Date): Window[] {
  const takers = staff.filter((s) => s.takesVisits);
  if (takers.length === 0) return [];
  const out: Window[] = [];
  const cutoff = now.getTime() + settings.cutoffHours * 3_600_000;
  const start = melbourneParts(now);
  let businessDays = 0;
  for (let i = 0; i <= settings.horizonDays * 2 + 7 && businessDays < settings.horizonDays; i++) {
    const dayInstant = new Date(melbourneInstant(start.y, start.m, start.d, 12).getTime() + i * DAY_MS);
    const p = melbourneParts(dayInstant);
    const date = ymd(p.y, p.m, p.d);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const working = takers.filter((s) => s.days.includes(dow));
    if (working.length === 0) continue;
    let offeredToday = false;
    for (const part of ["am", "pm"] as const) {
      const [, wTo] = settings.windows[part];
      if (at(date, wTo).getTime() <= cutoff) continue;
      const room: Array<{ id: string; free: number }> = [];
      for (const s of working) {
        const span = windowSpan(date, part, s, settings);
        if (!span) continue;
        const from = new Date(Math.max(span.from.getTime(), cutoff));
        const n = freeStarts(s.staffId, from, span.to, s.visitMinutes, busy).length;
        if (n > 0) room.push({ id: s.staffId, free: n });
      }
      if (room.length === 0) continue;
      room.sort((a, b) => b.free - a.free);
      out.push({ key: `${date}|${part}`, date, part, label: windowLabel(date, part, settings), staffIds: room.map((r) => r.id) });
      offeredToday = true;
    }
    // The horizon is ten days a customer can actually pick, not ten calendar entries.
    if (offeredToday) businessDays += 1;
  }
  return out;
}

export function parseWindowKey(key: string): { date: string; part: "am" | "pm" } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\|(am|pm)$/.exec(key);
  return m ? { date: m[1], part: m[2] as "am" | "pm" } : null;
}

/**
 * Turn a chosen window into a real slot: the estimator with the most room,
 * their earliest free block. Null when the window has filled since it was
 * offered — the caller offers the list again.
 */
export function pickSlot(
  key: string, staff: StaffAvailability[], busy: Busy[], settings: VisitsSettings, now: Date,
  minutesOverride?: number,
): Slot | null {
  const parsed = parseWindowKey(key);
  if (!parsed) return null;
  const windows = offeredWindows(staff, busy, settings, now);
  const w = windows.find((x) => x.key === key);
  if (!w) return null;
  const cutoff = now.getTime() + settings.cutoffHours * 3_600_000;
  for (const id of w.staffIds) {
    const s = staff.find((x) => x.staffId === id);
    if (!s) continue;
    const span = windowSpan(parsed.date, parsed.part, s, settings);
    if (!span) continue;
    const minutes = minutesOverride ?? s.visitMinutes;
    const from = new Date(Math.max(span.from.getTime(), cutoff));
    const first = freeStarts(id, from, span.to, minutes, busy)[0];
    if (first) return { staffId: id, startsAt: first.toISOString(), endsAt: new Date(first.getTime() + minutes * 60_000).toISOString() };
  }
  return null;
}

/** Is this exact block free for this estimator? (Staff booking an exact time.) */
export function blockIsFree(staffId: string, startsAt: string, endsAt: string, busy: Busy[], ignoreVisitId?: string): boolean {
  const s = new Date(startsAt).getTime(), e = new Date(endsAt).getTime();
  return !busy.some((b) => {
    if (b.staffId !== staffId) return false;
    if (ignoreVisitId != null && (b as Busy & { id?: string }).id === ignoreVisitId) return false;
    return s < new Date(b.endsAt).getTime() && e > new Date(b.startsAt).getTime();
  });
}
