/**
 * The lead sequence, L1–L3 (automations brief §4, master plan Appendix A).
 * PURE — what is due for one lead, from its derived stage and how long it has
 * been there. Ruling A‑A: no scheduled runs; the sweep asks this every half
 * hour, so a lead who tightens, asks for help, books a visit or gets an
 * estimate simply stops being "range_no_action" and nothing more is due.
 *
 *   L1  lead_range_reminder  text   2 h after the range
 *   L2  lead_range_nudge     chat   1 day after
 *   L3  lead_range_human     chat   3 days after
 *
 * ⚑5 (only new arrivals): a step is due from its moment until LATE_MS after
 * it, never later, so switching a key on does not message everyone who saw a
 * range last month. A chat step is not sent once a CONVERSATION has started
 * after the range — the customer wrote, or a person replied — because a
 * person owns it now. The sequence's own chat messages do not count
 * (`conversationAt`), or L2 would stop L3.
 */
export type LeadStepKey = "lead_range_reminder" | "lead_range_nudge" | "lead_range_human";
export type LeadStep = { key: LeadStepKey; channel: "sms" | "chat"; unit: "hours" | "days"; defaultAfter: number; lateMs: number };

const HOUR = 3_600_000;
export const LEAD_STEPS: readonly LeadStep[] = [
  { key: "lead_range_reminder", channel: "sms", unit: "hours", defaultAfter: 2, lateMs: 2 * HOUR },
  { key: "lead_range_nudge", channel: "chat", unit: "days", defaultAfter: 1, lateMs: 24 * HOUR },
  { key: "lead_range_human", channel: "chat", unit: "days", defaultAfter: 3, lateMs: 24 * HOUR },
];

/** The stage every lead step needs (lib/crm/estimateStage.ts). */
export const LEAD_STAGE = "range_no_action";

export type LeadFacts = {
  /** The derived stage now, and when the lead entered it (the range). */
  stage: string | null;
  since: string | null;
  /** Steps already claimed for this estimate. */
  claimed: ReadonlySet<string>;
  /** When a conversation started on the chat after the range (`conversationAt`), or null. */
  conversationAt: string | null;
};

export const stepAfterMs = (step: LeadStep, after: number): number => after * (step.unit === "hours" ? HOUR : 24 * HOUR);

/**
 * The steps due now for one lead. `enabled` holds the switched-on keys with
 * their "after" value in the step's unit (Settings → Automations timing).
 */
export function leadStepsDue(facts: LeadFacts, now: Date, enabled: ReadonlyMap<LeadStepKey, number>): LeadStep[] {
  if (facts.stage !== LEAD_STAGE || !facts.since) return [];
  const since = Date.parse(facts.since);
  if (Number.isNaN(since)) return [];
  const talking = facts.conversationAt != null && Date.parse(facts.conversationAt) > since;
  const t = now.getTime();
  return LEAD_STEPS.filter((step) => {
    const after = enabled.get(step.key);
    if (after == null || facts.claimed.has(step.key)) return false;
    if (step.channel === "chat" && talking) return false;
    const at = since + stepAfterMs(step, after);
    return t >= at && t < at + step.lateMs;
  });
}

/** A staff chat row this close after one of the sequence's claims is the sequence's own message. */
export const OWN_MESSAGE_WINDOW_MS = 15 * 60_000;

/**
 * The first chat message after the range that a PERSON wrote: any customer
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
