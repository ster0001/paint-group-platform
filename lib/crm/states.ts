/**
 * CRM v2 P4 — the relationship state vocabulary, shared by the record, the
 * cards, the filters and (P5) the audience rules. One place, so the wording
 * on screen cannot drift from the database's check constraint.
 */
export const RELATIONSHIP_STATES = ["active", "delayed", "do_not_contact", "lost", "archived"] as const;
export type RelationshipState = (typeof RELATIONSHIP_STATES)[number];

export const STATE_LABEL: Record<RelationshipState, string> = {
  active: "Active",
  delayed: "Delayed",
  do_not_contact: "Do not contact",
  lost: "Lost",
  archived: "Archived",
};

export const STATE_HELP: Record<RelationshipState, string> = {
  active: "Chased by the rules like everyone else.",
  delayed: "Customer said not now. Hidden from Today and the chase rules until the date; comes back as a reminder with your note.",
  do_not_contact: "No marketing, no follow-up sequences, no call prompts. Invoices and bookings still go out.",
  lost: "We lost this one. Kept for reporting; a new estimate brings them straight back.",
  archived: "Duplicate, test, deceased or wrong business. Hidden everywhere except search.",
};

/** Tom, 30 Aug 2026 (C15): the wording is final — never paraphrase it on screen. */
export const LOST_REASONS = [
  { key: "went_with_someone_else", label: "Went with someone else" },
  { key: "too_expensive", label: "Too expensive" },
  { key: "just_planning", label: "Was just planning" },
  { key: "change_of_circumstances", label: "Change of circumstances" },
  { key: "something_else", label: "Something else" },
] as const;
export type LostReason = (typeof LOST_REASONS)[number]["key"];

export const PERMIT_CHANNELS = ["email", "sms", "phone"] as const;
export type PermitChannel = (typeof PERMIT_CHANNELS)[number];
export const PERMIT_VALUES = ["allowed", "declined", "unknown"] as const;
export type PermitValue = (typeof PERMIT_VALUES)[number];
export const PERMIT_LABEL: Record<PermitChannel, string> = { email: "Marketing email", sms: "Marketing texts", phone: "Phone calls" };

/** Is a delayed state still holding, given the clock? */
export function delayHolds(state: string | null | undefined, until: string | null | undefined, now: Date): boolean {
  return state === "delayed" && until != null && new Date(until) > now;
}

/** A delayed customer whose date has passed: awake, and somebody should look. */
export function delayEnded(state: string | null | undefined, until: string | null | undefined, now: Date): boolean {
  return state === "delayed" && until != null && new Date(until) <= now;
}

/** Nothing about this customer belongs in Today or on a chase rule. */
export function isQuiet(state: string | null | undefined, until: string | null | undefined, now: Date): boolean {
  return state === "do_not_contact" || state === "archived" || delayHolds(state, until, now);
}

const fmt = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(new Date(iso));

/** The chip a card wears for its state, or null when active. */
export function stateChip(state: string | null | undefined, until: string | null | undefined, lostReason: string | null | undefined, now: Date): string | null {
  switch (state) {
    case "delayed":
      return until ? (new Date(until) > now ? `Delayed to ${fmt(until)}` : "Delay ended") : "Delayed";
    case "do_not_contact": return "Do not contact";
    case "lost": return `Lost${lostReason ? ` — ${LOST_REASONS.find((r) => r.key === lostReason)?.label ?? lostReason}` : ""}`;
    case "archived": return "Archived";
    default: return null;
  }
}
