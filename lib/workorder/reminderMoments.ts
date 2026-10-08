/**
 * Reminder moments (brief Step 4; §4.2, R7, R8, ⚑3–⚑5). Pure.
 *
 * The SCHEDULE stays in lib/workorder/jobRhythm.ts (the one planner — the
 * brief's table matches it, Step 0 checked). This module turns a plan into
 * moment rows and decides, for one moment at one instant, whether a text is
 * due: the first at the moment itself, then up to two follow-ups at the ⚑5
 * times (7:30 → 10:30, 13:30; 15:30 → 17:30, 19:00), never after the last
 * send time, never more than maxTexts, never once answered or skipped.
 * Rescheduling recalculates moments that have not yet happened and never
 * changes a past one (`reconcilePlan`).
 */
import { melbourneInstant } from "@/lib/time/businessHours";
import { painterMorningHeadsUps, painterUpdateRungs, rungInstant, type JobRung } from "./jobRhythm";

export type MomentKind = "day1" | "day1_pm" | "day2" | "mid" | "mid30" | "mid60" | "last";
export const MOMENT_KINDS: readonly MomentKind[] = ["day1", "day1_pm", "day2", "mid", "mid30", "mid60", "last"];

export type PlannedMoment = { kind: MomentKind; day: string; dueAt: Date };

export type MomentRow = {
  id: string;
  workOrderId: string;
  kind: MomentKind;
  day: string;
  dueAt: string;
  sendsCount: number;
  lastSentAt: string | null;
  answeredAt: string | null;
  skippedReason: "no_work" | "rescheduled" | "not_sent" | null;
};

export type JobUpdateRules = {
  /** HH:MM Melbourne, after a 07:30 moment. */
  morningFollowUps: string[];
  /** HH:MM Melbourne, after a 15:30 moment. */
  afternoonFollowUps: string[];
  /** HH:MM Melbourne: nothing goes after this (R8 "Nothing after 7:00 pm"). */
  lastSend: string;
  maxTexts: number;
  /** HH:MM Melbourne: the morning heads-up on a 15:30 moment's day (Tom, 8 Oct)… */
  headsUp: string;
  /** …sent from `headsUp` until this time, never later — a missed morning is not sent in the afternoon. */
  headsUpUntil: string;
};

export const DEFAULT_JOB_UPDATE_RULES: JobUpdateRules = {
  morningFollowUps: ["10:30", "13:30"], afternoonFollowUps: ["17:30", "19:00"], lastSend: "19:00", maxTexts: 3,
  headsUp: "07:30", headsUpUntil: "12:00",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function mergeJobUpdateRules(raw: unknown): JobUpdateRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const times = (v: unknown, d: string[]) => Array.isArray(v) && v.every((x) => typeof x === "string" && HHMM.test(x)) ? (v as string[]) : d;
  const time = (v: unknown, d: string) => (typeof v === "string" && HHMM.test(v) ? v : d);
  const max = Number.isInteger(r.maxTexts) && (r.maxTexts as number) >= 1 && (r.maxTexts as number) <= 5 ? (r.maxTexts as number) : DEFAULT_JOB_UPDATE_RULES.maxTexts;
  return {
    morningFollowUps: times(r.morningFollowUps, DEFAULT_JOB_UPDATE_RULES.morningFollowUps),
    afternoonFollowUps: times(r.afternoonFollowUps, DEFAULT_JOB_UPDATE_RULES.afternoonFollowUps),
    lastSend: time(r.lastSend, DEFAULT_JOB_UPDATE_RULES.lastSend),
    maxTexts: max,
    headsUp: time(r.headsUp, DEFAULT_JOB_UPDATE_RULES.headsUp),
    headsUpUntil: time(r.headsUpUntil, DEFAULT_JOB_UPDATE_RULES.headsUpUntil),
  };
}

/** The moments for a job of these booked days — the planner's rungs, as rows-to-be. */
export function planMoments(days: readonly string[]): PlannedMoment[] {
  return painterUpdateRungs(days).map((r: JobRung) => ({ kind: r.id as MomentKind, day: r.date, dueAt: rungInstant(r) }));
}

const MELB_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function melbourneDayAndTime(at: Date): { day: string; hhmm: string } {
  const p = Object.fromEntries(MELB_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

/** The instant of HH:MM Melbourne on a YYYY-MM-DD day. */
function at(day: string, hhmm: string): Date {
  const [y, m, d] = day.split("-").map(Number); const [h, min] = hhmm.split(":").map(Number);
  return melbourneInstant(y, m, d, h, min);
}

const isMorning = (m: { dueAt: Date | string }) => melbourneDayAndTime(new Date(m.dueAt)).hhmm < "12:00";

/** When each text of a moment is due: the moment, then its follow-ups (⚑5). */
export function sendTimes(m: { day: string; dueAt: Date | string }, rules: JobUpdateRules): Date[] {
  const follow = (isMorning(m) ? rules.morningFollowUps : rules.afternoonFollowUps).map((t) => at(m.day, t));
  return [new Date(m.dueAt), ...follow].slice(0, rules.maxTexts);
}

/** R8: nothing after the last send time, Melbourne — a sweep on the half hour gets a five-minute grace at the boundary. */
export function withinSendingWindow(now: Date, rules: JobUpdateRules): boolean {
  const { hhmm } = melbourneDayAndTime(now);
  const [lh, lm] = rules.lastSend.split(":").map(Number);
  const limit = `${String(lh).padStart(2, "0")}:${String(Math.min(59, lm + 5)).padStart(2, "0")}`;
  return hhmm <= limit;
}

export type SendDecision = { send: true; which: number } | { send: false; why: "answered" | "skipped" | "not_due" | "max" | "after_hours" | "other_day" | "too_soon" };

/**
 * Should the sweep text this moment now, and which text is it (1-based)?
 * Only on the moment's own day (a missed day is never caught up — the
 * not_sent skip records it), only while unanswered and unskipped, only up
 * to maxTexts, each at or after its slot, never after the last send time.
 */
export function decideSend(m: MomentRow, now: Date, rules: JobUpdateRules): SendDecision {
  if (m.answeredAt) return { send: false, why: "answered" };
  if (m.skippedReason) return { send: false, why: "skipped" };
  const { day } = melbourneDayAndTime(now);
  if (day !== m.day) return { send: false, why: "other_day" };
  if (now.getTime() < new Date(m.dueAt).getTime()) return { send: false, why: "not_due" };
  if (m.sendsCount >= rules.maxTexts) return { send: false, why: "max" };
  if (!withinSendingWindow(now, rules)) return { send: false, why: "after_hours" };
  const slot = sendTimes(m, rules)[m.sendsCount];
  if (!slot) return { send: false, why: "max" };
  if (now.getTime() < slot.getTime()) return { send: false, why: "too_soon" };
  return { send: true, which: m.sendsCount + 1 };
}

/**
 * The morning heads-up due now (Tom, 8 Oct): today is a 15:30 moment's day
 * with no 07:30 text of its own, and the Melbourne clock is inside
 * [headsUp, headsUpUntil). Null otherwise. Whether that day's moment was
 * answered or skipped is the sweep's question — it holds the rows.
 */
export function headsUpDue(days: readonly string[], now: Date, rules: JobUpdateRules): { forKind: MomentKind; day: string } | null {
  const { day, hhmm } = melbourneDayAndTime(now);
  if (hhmm < rules.headsUp || hhmm >= rules.headsUpUntil) return null;
  const h = painterMorningHeadsUps(days).find((x) => x.date === day);
  return h ? { forKind: h.forRung as MomentKind, day } : null;
}

export type Reconcile = {
  insert: PlannedMoment[];
  /** Rows whose day moved and which have not happened yet: re-dated. */
  move: { id: string; day: string; dueAt: Date }[];
  /** Rows no longer in the plan, not yet happened: skipped as rescheduled. */
  skip: string[];
  /** Rows whose day has passed with no text ever sent: skipped as not_sent. */
  notSent: string[];
};

/**
 * Bring a job's rows in line with its plan (§4.2 "If the booking dates move,
 * unanswered future moments are recalculated from the new dates. Rescheduling
 * never changes a past moment."): a moment that has been texted, answered or
 * whose instant has passed is history; everything else follows the plan.
 */
export function reconcilePlan(existing: readonly MomentRow[], plan: readonly PlannedMoment[], now: Date): Reconcile {
  const out: Reconcile = { insert: [], move: [], skip: [], notSent: [] };
  const byKind = new Map(existing.map((m) => [m.kind, m]));
  const today = melbourneDayAndTime(now).day;
  const happened = (m: MomentRow) => m.sendsCount > 0 || !!m.answeredAt || !!m.skippedReason || new Date(m.dueAt).getTime() <= now.getTime();
  for (const p of plan) {
    const m = byKind.get(p.kind);
    if (!m) { out.insert.push(p); continue; }
    if (m.day !== p.day && !happened(m)) out.move.push({ id: m.id, day: p.day, dueAt: p.dueAt });
  }
  const planned = new Set(plan.map((p) => p.kind));
  for (const m of existing) {
    if (!planned.has(m.kind) && !happened(m)) out.skip.push(m.id);
    // The day went by and nobody was ever texted: not a miss the painter could answer.
    if (m.day < today && m.sendsCount === 0 && !m.answeredAt && !m.skippedReason) out.notSent.push(m.id);
  }
  return out;
}

export type MomentState = "answered" | "skipped" | "due" | "upcoming" | "missed";

/** What the painter's screen says about a moment. */
export function momentState(m: Pick<MomentRow, "day" | "dueAt" | "answeredAt" | "skippedReason">, now: Date): MomentState {
  // R10: a skipped day leaves the count whatever happened on it — skipped first.
  if (m.skippedReason) return "skipped";
  if (m.answeredAt) return "answered";
  const { day } = melbourneDayAndTime(now);
  if (m.day > day) return "upcoming";
  if (m.day === day) return "due";
  return "missed";
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  day1: "Day 1, 7:30 am", day1_pm: "Day 1, 3:30 pm", day2: "Day 2, 3:30 pm", mid: "Half way, 3:30 pm",
  mid30: "30% through, 3:30 pm", mid60: "60% through, 3:30 pm", last: "Last day, 3:30 pm",
};
