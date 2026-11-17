/**
 * The lead sequence, L1–L3, L5–L7 and L10's customer chat (automations brief §4, master plan
 * Appendix A). PURE — what is due for one lead, from its derived stage and
 * how long it has been there. Ruling A‑A: no scheduled runs; the sweep asks
 * this every half hour, so a lead who moves on simply stops being in the
 * step's stage and nothing more of that stage is due.
 *
 *   L1  lead_range_reminder    text   2 h after the range        range_no_action
 *   L2  lead_range_nudge       chat   1 day after                range_no_action
 *   L3  lead_range_human       chat   3 days after               range_no_action
 *   L5  lead_tighten_resume    text   1 h after starting to      tightening
 *                                     tighten, still not done
 *   L6  lead_tighten_help      chat   1 day after starting       tightening
 *   L7  lead_tightened_close   text   4 h after the closer       tightened_no_action
 *                                     range, nothing booked
 *   L10 lead_visit_request_ack chat   1 working day after a      visit_requested
 *                                     visit request, unanswered
 *
 * ⚑5 (only new arrivals): a step is due from its moment until LATE_MS after
 * it, never later, so switching a key on does not message everyone who saw a
 * range last month. A chat step is not sent once a CONVERSATION has started
 * after the stage began — the customer wrote, or a person replied — because
 * a person owns it now. The sequence's own chat messages do not count
 * (`conversationAt`), or L2 would stop L3.
 */
import { CLOSE_HOUR, OPEN_HOUR, addBusinessHours } from "@/lib/time/businessHours";

export type LeadStepKey =
  | "lead_range_reminder" | "lead_range_nudge" | "lead_range_human"
  | "lead_tighten_resume" | "lead_tighten_help" | "lead_tightened_close"
  | "lead_visit_request_ack";
export type LeadStage = "range_no_action" | "tightening" | "tightened_no_action" | "visit_requested";
/** `working_days`: office days (lib/time/businessHours — Mon–Fri 8–5, the Settings holidays out), one day = a full office day of hours. */
export type LeadStep = { key: LeadStepKey; stage: LeadStage; channel: "sms" | "chat"; unit: "hours" | "days" | "working_days"; defaultAfter: number; lateMs: number };

const HOUR = 3_600_000;
export const LEAD_STEPS: readonly LeadStep[] = [
  { key: "lead_range_reminder", stage: "range_no_action", channel: "sms", unit: "hours", defaultAfter: 2, lateMs: 2 * HOUR },
  { key: "lead_range_nudge", stage: "range_no_action", channel: "chat", unit: "days", defaultAfter: 1, lateMs: 24 * HOUR },
  { key: "lead_range_human", stage: "range_no_action", channel: "chat", unit: "days", defaultAfter: 3, lateMs: 24 * HOUR },
  { key: "lead_tighten_resume", stage: "tightening", channel: "sms", unit: "hours", defaultAfter: 1, lateMs: 2 * HOUR },
  { key: "lead_tighten_help", stage: "tightening", channel: "chat", unit: "days", defaultAfter: 1, lateMs: 24 * HOUR },
  { key: "lead_tightened_close", stage: "tightened_no_action", channel: "sms", unit: "hours", defaultAfter: 4, lateMs: 4 * HOUR },
  { key: "lead_visit_request_ack", stage: "visit_requested", channel: "chat", unit: "working_days", defaultAfter: 1, lateMs: 24 * HOUR },
];

/** The stages a lead step can be due in (lib/crm/estimateStage.ts). */
export const LEAD_STAGES: ReadonlySet<string> = new Set(LEAD_STEPS.map((s) => s.stage));

export type LeadFacts = {
  /** The derived stage now, and when the lead entered it. */
  stage: string | null;
  since: string | null;
  /** Steps already claimed for this estimate. */
  claimed: ReadonlySet<string>;
  /** When a conversation started on the chat after the stage began (`conversationAt`), or null. */
  conversationAt: string | null;
};

export const stepAfterMs = (step: LeadStep, after: number): number => after * (step.unit === "hours" ? HOUR : 24 * HOUR);

/** One office day, in office hours (OPEN_HOUR–CLOSE_HOUR). */
const OFFICE_DAY_HOURS = CLOSE_HOUR - OPEN_HOUR;

/** The moment a step falls due, `after` (in the step's unit) from `since`. */
export function stepDueAt(step: LeadStep, since: Date, after: number, holidays: ReadonlySet<string> = new Set()): Date {
  return step.unit === "working_days"
    ? addBusinessHours(since, after * OFFICE_DAY_HOURS, holidays)
    : new Date(since.getTime() + stepAfterMs(step, after));
}

/**
 * The steps due now for one lead. `enabled` holds the switched-on keys with
 * their "after" value in the step's unit (Settings → Automations timing).
 */
export function leadStepsDue(facts: LeadFacts, now: Date, enabled: ReadonlyMap<LeadStepKey, number>, holidays: ReadonlySet<string> = new Set()): LeadStep[] {
  if (!facts.stage || !LEAD_STAGES.has(facts.stage) || !facts.since) return [];
  const since = Date.parse(facts.since);
  if (Number.isNaN(since)) return [];
  const talking = facts.conversationAt != null && Date.parse(facts.conversationAt) > since;
  const t = now.getTime();
  return LEAD_STEPS.filter((step) => {
    const after = enabled.get(step.key);
    if (step.stage !== facts.stage || after == null || facts.claimed.has(step.key)) return false;
    if (step.channel === "chat" && talking) return false;
    const at = stepDueAt(step, new Date(since), after, holidays).getTime();
    return t >= at && t < at + step.lateMs;
  });
}

/** A staff chat row this close after one of the sequence's claims is the sequence's own message. */
export const OWN_MESSAGE_WINDOW_MS = 15 * 60_000;

/**
 * The first chat message after the stage began that a PERSON wrote: any customer
 * message, or a staff message that is not the sequence's own (one posted
 * within OWN_MESSAGE_WINDOW_MS after a lead-step claim on this estimate).
 */
export function conversationAt(
  messages: readonly { direction: string; created_at: string }[],
  rangeAt: string | null,
  claimTimes: readonly string[],
): string | null {
  if (!rangeAt) return null;
  const from = Date.parse(rangeAt);
  const claims = claimTimes.map((c) => Date.parse(c)).filter((t) => !Number.isNaN(t));
  const ours = (t: number) => claims.some((c) => t >= c && t - c <= OWN_MESSAGE_WINDOW_MS);
  const hit = messages
    .map((m) => ({ ...m, t: Date.parse(m.created_at) }))
    .filter((m) => m.t > from && (m.direction === "customer" || !ours(m.t)))
    .sort((a, b) => a.t - b.t)[0];
  return hit ? hit.created_at : null;
}

/** "$6,400–$7,900 inc. GST", as Appendix A writes {range}. */
export function leadRangeWords(loCents: number, hiCents: number): string {
  const d = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;
  return `${d(loCents)}–${d(hiCents)} inc. GST`;
}

/** The street line of an address ("12 Acacia Street"), or the whole thing when it has no comma. */
export function streetOf(address: string): string {
  return (address.split(",")[0] ?? "").trim() || address.trim();
}
