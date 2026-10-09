/**
 * Visit schedule — the vocabulary, the standard week, the booking rules and
 * THE ONE availability function (visit booking addendum A, S2 §4.2).
 *
 * Pure. No database, no network, no clock of its own: it takes the week, the
 * bookings, the holds, the busy times, the rules, the customer's zone and
 * far-edge flag, and "now", and says which slots are offered. Everything that
 * decides "can this customer see this time" is here and nowhere else — the
 * server action that books (S3) re-runs it inside its transaction.
 *
 * All times are Melbourne wall-clock; instants are made with
 * `melbourneInstant`, which measures the offset from the zone, so daylight
 * saving never shifts a slot (the Monday after it starts still offers 08:00).
 */
import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";
import { isZoneKey, type ZoneKey } from "./zones";

// ---- slots -------------------------------------------------------------------

export type SlotCond = { zone: ZoneKey; ifPrevZone: ZoneKey };

/** One slot of an estimator's week. */
export type WeekSlot = {
  id?: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes after midnight, Melbourne (08:00 = 480). */
  startMinutes: number;
  /** The whole run: visit + travel (R12, 90). */
  lengthMinutes: number;
  zones: ZoneKey[];
  /** R14: also `zone` when the slot directly before is a confirmed `ifPrevZone` visit. */
  cond: SlotCond | null;
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const Z = (...n: number[]): ZoneKey[] => n.map((i) => `zone_${i}` as ZoneKey);
const S = (weekday: number, h: number, m: number, zones: ZoneKey[], cond: SlotCond | null = null): WeekSlot =>
  ({ weekday, startMinutes: h * 60 + m, lengthMinutes: 90, zones, cond });

/** Tom's week, section 5 of the addendum. 21 slots; per-zone totals 16/13/6/5/9. */
export const STANDARD_WEEK: readonly WeekSlot[] = [
  S(1, 8, 0, Z(5, 2, 1)), S(1, 9, 30, Z(5, 2, 1)), S(1, 11, 0, Z(1)), S(1, 12, 30, Z(1)), S(1, 14, 0, Z(1)), S(1, 15, 30, Z(1)),
  S(2, 8, 0, Z(1, 2, 3, 4, 5)), S(2, 15, 0, Z(3, 4, 1)),
  S(3, 8, 0, Z(1, 2, 5)), S(3, 9, 30, Z(2)), S(3, 11, 0, Z(2)), S(3, 12, 30, Z(2)), S(3, 14, 0, Z(5, 1)),
  S(4, 8, 0, Z(1, 2, 3, 4, 5)), S(4, 16, 30, Z(1, 2, 3, 4, 5)),
  S(5, 8, 0, Z(4, 3, 1)), S(5, 9, 30, Z(3, 1)), S(5, 11, 0, Z(1, 2)), S(5, 12, 30, Z(2), { zone: "zone_1", ifPrevZone: "zone_1" }), S(5, 14, 0, Z(2, 5)), S(5, 15, 30, Z(2, 5, 1)),
];

/** Slots a week each zone can book — unconditional membership only (section 5's seed check). */
export function slotsPerZone(week: readonly WeekSlot[]): Record<ZoneKey, number> {
  const out: Record<ZoneKey, number> = { zone_1: 0, zone_2: 0, zone_3: 0, zone_4: 0, zone_5: 0 };
  for (const s of week) for (const z of s.zones) out[z]++;
  return out;
}

/** Section 8, test 18: a slot that starts inside another's run, same estimator and day. */
export function overlaps(a: Pick<WeekSlot, "weekday" | "startMinutes" | "lengthMinutes">, b: Pick<WeekSlot, "weekday" | "startMinutes" | "lengthMinutes">): boolean {
  return a.weekday === b.weekday && a.startMinutes < b.startMinutes + b.lengthMinutes && b.startMinutes < a.startMinutes + a.lengthMinutes;
}

export const minutesToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const timeToMinutes = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

/** "2:00 pm" — customer wording (section 9). */
export function timeWords(m: number): string {
  const h = Math.floor(m / 60), min = m % 60;
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

// ---- booking rules -----------------------------------------------------------

export const BOOKING_RULES_KEY = "visit_booking_rules";
export type GateOrder = "details_first" | "range_first";

export type BookingRules = {
  /** Customers can book today (R15). */
  sameDay: boolean;
  /** A slot must start at least this far ahead (R15: 2 hours). */
  minNoticeMinutes: number;
  /** How far ahead a customer can book (R16: 3 weeks). */
  windowDays: number;
  /** A hold while the code is entered (4.3: 10 minutes). */
  holdMinutes: number;
  /** Slot = visit + travel (R12: 90). */
  slotMinutes: number;
  /** What the customer is shown (R32: 60). */
  visitMinutes: number;
  /** R34: Speak with us when the TOP of the range is at or under these, AUD inc GST. */
  speakInteriorCapCents: number;
  speakExteriorCapCents: number;
  /** R36: the reminder text, Melbourne wall clock the day before ("18:00"). */
  reminderTime: string;
  /** R33 / decision 1: YYYY-MM-DD, Melbourne. No slots on these days; not working days. */
  publicHolidays: string[];
  /** R18: far-edge suburbs of these zone pairs are never back to back. */
  farEdgePairs: Array<[ZoneKey, ZoneKey]>;
  /** R6: switched by hand. */
  gateOrder: GateOrder;
  /** S5 (4.6): customers can only book into a zone whose estimator has a connected Google Calendar that we can write to. Off = book without one (the test project). */
  calendarRequired: boolean;
};

export const DEFAULT_BOOKING_RULES: BookingRules = {
  sameDay: true,
  minNoticeMinutes: 120,
  windowDays: 21,
  holdMinutes: 10,
  slotMinutes: 90,
  visitMinutes: 60,
  speakInteriorCapCents: 600_000,
  speakExteriorCapCents: 1_200_000,
  reminderTime: "18:00",
  publicHolidays: [],
  farEdgePairs: [["zone_4", "zone_3"]],
  gateOrder: "details_first",
  calendarRequired: true,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A saved row (or anything) merged over the defaults; every field bounded. */
export function mergeBookingRules(raw: unknown): BookingRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof BookingRules, unknown>>;
  const int = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  const pairs: Array<[ZoneKey, ZoneKey]> = Array.isArray(r.farEdgePairs)
    ? r.farEdgePairs.filter((p): p is [ZoneKey, ZoneKey] => Array.isArray(p) && p.length === 2 && isZoneKey(p[0]) && isZoneKey(p[1]) && p[0] !== p[1])
    : DEFAULT_BOOKING_RULES.farEdgePairs;
  return {
    sameDay: typeof r.sameDay === "boolean" ? r.sameDay : DEFAULT_BOOKING_RULES.sameDay,
    minNoticeMinutes: int(r.minNoticeMinutes, DEFAULT_BOOKING_RULES.minNoticeMinutes, 0, 7 * 24 * 60),
    windowDays: int(r.windowDays, DEFAULT_BOOKING_RULES.windowDays, 1, 90),
    holdMinutes: int(r.holdMinutes, DEFAULT_BOOKING_RULES.holdMinutes, 2, 60),
    slotMinutes: int(r.slotMinutes, DEFAULT_BOOKING_RULES.slotMinutes, 15, 480),
    visitMinutes: int(r.visitMinutes, DEFAULT_BOOKING_RULES.visitMinutes, 15, 480),
    speakInteriorCapCents: int(r.speakInteriorCapCents, DEFAULT_BOOKING_RULES.speakInteriorCapCents, 0, 100_000_000),
    speakExteriorCapCents: int(r.speakExteriorCapCents, DEFAULT_BOOKING_RULES.speakExteriorCapCents, 0, 100_000_000),
    reminderTime: typeof r.reminderTime === "string" && /^\d{2}:\d{2}$/.test(r.reminderTime) ? r.reminderTime : DEFAULT_BOOKING_RULES.reminderTime,
    publicHolidays: Array.isArray(r.publicHolidays) ? [...new Set(r.publicHolidays.filter((d): d is string => typeof d === "string" && DATE_RE.test(d)))].sort() : [],
    farEdgePairs: pairs,
    gateOrder: r.gateOrder === "range_first" ? "range_first" : "details_first",
    calendarRequired: typeof r.calendarRequired === "boolean" ? r.calendarRequired : true,
  };
}

// ---- availability --------------------------------------------------------------

/** A confirmed booking of this estimator (status `booked`), as the rules need it. */
export type ScheduleBooking = { startsAt: string; zone: ZoneKey | null; farEdge: boolean };
/** A live hold on a slot (S3). Expired holds are ignored. */
export type ScheduleHold = { startsAt: string; expiresAt: string };
/** Anything else in the estimator's calendar (4.6). An all-day entry hides the day. */
export type ScheduleBusy = { start: string; end: string } | { allDay: string };

export type AvailabilityInput = {
  week: readonly WeekSlot[];
  bookings: readonly ScheduleBooking[];
  holds: readonly ScheduleHold[];
  busy: readonly ScheduleBusy[];
  rules: BookingRules;
  /** `"any"` is the STAFF view (§4.4: staff may offer any free slot, whatever its zone list). Far edges still apply. */
  customer: { zone: ZoneKey | "any"; farEdge: boolean };
  now: Date;
};

/**
 * R25 / R34: "Speak with us" is offered when the TOP of the guide range is at
 * or under the phone limit — interior for an inside job, the exterior limit
 * for anything with an outside. Decided on the server; the browser only
 * shows or hides the button.
 */
export function speakWithUsFor(jobType: "interior" | "exterior" | "both" | string | null | undefined, hiCents: number | null | undefined, rules: Pick<BookingRules, "speakInteriorCapCents" | "speakExteriorCapCents">): boolean {
  if (hiCents == null || !Number.isFinite(hiCents) || hiCents <= 0) return false;
  const cap = jobType === "interior" ? rules.speakInteriorCapCents : rules.speakExteriorCapCents;
  return hiCents <= cap;
}

export type OfferedSlot = {
  /** YYYY-MM-DD, Melbourne. */
  date: string;
  startMinutes: number;
  /** The instant the visit starts. */
  startsAt: string;
  /** What the customer sees: start + visitMinutes (R32). */
  visitEndsAt: string;
  /** What is blocked: start + slotMinutes. */
  slotEndsAt: string;
  /** "Monday 5 October" / "2:00 pm" — section 9. */
  dayWords: string;
  timeWords: string;
};

export type OfferedDay = { date: string; weekday: number; dayWords: string; slots: OfferedSlot[] };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Day n from the Melbourne calendar date of `from` (n = 0 is that date). */
function dayAfter(from: Date, n: number): { y: number; m: number; d: number; weekday: number } {
  // Noon of the start date, then + n days in UTC — the DATE is what matters, so the offset cannot shift it.
  const p = melbourneParts(from);
  const noon = new Date(Date.UTC(p.y, p.m - 1, p.d, 12) + n * 86_400_000);
  const q = { y: noon.getUTCFullYear(), m: noon.getUTCMonth() + 1, d: noon.getUTCDate() };
  const weekday = melbourneParts(melbourneInstant(q.y, q.m, q.d, 12)).weekday;
  return { ...q, weekday };
}

export function dayWordsOf(y: number, m: number, d: number, weekday: number): string {
  return `${WEEKDAY_LONG[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** Instant-equality on the minute, so a stored `starts_at` matches a computed slot. */
const sameInstant = (a: string | Date, b: Date) => Math.abs(new Date(a).getTime() - b.getTime()) < 60_000;

function isFarEdgeClash(
  rules: BookingRules, customer: AvailabilityInput["customer"], daySlots: WeekSlot[], i: number,
  bookingAt: (startMinutes: number) => ScheduleBooking | undefined,
): boolean {
  if (!customer.farEdge) return false;
  const paired = (z: ZoneKey | null) => !!z && rules.farEdgePairs.some(([a, b]) => (a === customer.zone && b === z) || (b === customer.zone && a === z));
  if (customer.zone === "any") return false;
  for (const j of [i - 1, i + 1]) {
    const n = daySlots[j];
    if (!n) continue;
    // "Directly before or after": the adjacent slot in the day, touching this one's run.
    const adjacent = j < i ? n.startMinutes + n.lengthMinutes === daySlots[i].startMinutes : daySlots[i].startMinutes + daySlots[i].lengthMinutes === n.startMinutes;
    if (!adjacent) continue;
    const b = bookingAt(n.startMinutes);
    if (b && b.farEdge && paired(b.zone)) return true;
  }
  return false;
}

/**
 * The slots this customer may book, by day, over the booking window. Section
 * 4.2's seven rules, in order. "Booked" means a confirmed booking; a hold
 * blocks only its own slot.
 */
export function availability(input: AvailabilityInput): OfferedDay[] {
  const { week, rules, customer, now } = input;
  const any = customer.zone === "any";
  if (!any && !isZoneKey(customer.zone)) return [];
  const nowMs = now.getTime();
  const earliest = nowMs + rules.minNoticeMinutes * 60_000;
  const latest = dayAfter(now, rules.windowDays);
  const latestMs = melbourneInstant(latest.y, latest.m, latest.d, 23, 59).getTime();
  const holidays = new Set(rules.publicHolidays);
  const live = input.holds.filter((h) => new Date(h.expiresAt).getTime() > nowMs);
  const allDayBusy = new Set(input.busy.flatMap((b) => ("allDay" in b ? [b.allDay] : [])));
  const timedBusy = input.busy.flatMap((b) => ("allDay" in b ? [] : [{ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }]));

  const out: OfferedDay[] = [];
  for (let n = 0; n <= rules.windowDays; n++) {
    const day = dayAfter(now, n);
    const date = ymd(day.y, day.m, day.d);
    if (n === 0 && !rules.sameDay) continue;
    if (holidays.has(date) || allDayBusy.has(date)) continue;
    const daySlots = week.filter((s) => s.weekday === day.weekday).sort((a, b) => a.startMinutes - b.startMinutes);
    if (!daySlots.length) continue;

    const startOf = (m: number) => melbourneInstant(day.y, day.m, day.d, Math.floor(m / 60), m % 60);
    const bookingAt = (m: number) => input.bookings.find((b) => sameInstant(b.startsAt, startOf(m)));
    const dayWords = dayWordsOf(day.y, day.m, day.d, day.weekday);
    const slots: OfferedSlot[] = [];

    daySlots.forEach((slot, i) => {
      const start = startOf(slot.startMinutes);
      const startMs = start.getTime();
      // 4 — notice and window.
      if (startMs < earliest || startMs > latestMs) return;
      // 2 — the slot's zone list, or its conditional rule on a CONFIRMED booking before it.
      let allowed = any || slot.zones.includes(customer.zone as ZoneKey);
      if (!allowed && slot.cond && slot.cond.zone === customer.zone && i > 0) {
        const prev = bookingAt(daySlots[i - 1].startMinutes);
        allowed = !!prev && prev.zone === slot.cond.ifPrevZone;
      }
      if (!allowed) return;
      // 3 — booked, or held by someone.
      if (bookingAt(slot.startMinutes)) return;
      if (live.some((h) => sameInstant(h.startsAt, start))) return;
      // 5 — anything in the calendar over the full run.
      const endMs = startMs + rules.slotMinutes * 60_000;
      if (timedBusy.some((b) => b.s < endMs && b.e > startMs)) return;
      // 6 — far edges.
      if (isFarEdgeClash(rules, customer, daySlots, i, bookingAt)) return;
      slots.push({
        date, startMinutes: slot.startMinutes,
        startsAt: start.toISOString(),
        visitEndsAt: new Date(startMs + rules.visitMinutes * 60_000).toISOString(),
        slotEndsAt: new Date(endMs).toISOString(),
        dayWords, timeWords: timeWords(slot.startMinutes),
      });
    });
    if (slots.length) out.push({ date, weekday: day.weekday, dayWords, slots });
  }
  return out;
}
