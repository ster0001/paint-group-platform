/**
 * One icon per job on the Movements map, chosen by a ladder of importance (Tom, 25 Oct 2026:
 * "update all of the icons depending on the stage of the job, so it is clear what the most
 * important things to do on the job are … colour coded depending on action type").
 *
 * The facts are the PC Command work items homed on the job (`lib/crm/work-queue.ts`, read by
 * the movements loader) and the job's movement needs (`jobNeeds`). Nothing is computed here
 * that the console does not already show — the map is a second SCREEN over the one queue.
 *
 * The ladder, top wins:
 *   problem  red     warning   a movement problem or overdue, a payment hold, a flagged walkthrough, a call back not booked
 *   call     violet  phone     the client needs a call: check-in or follow-up due, a call-back visit soon, a delivery not confirmed
 *   visit    cyan    clipboard someone from the office on site: a quality check due or to book, a site check-in due
 *   move     amber   the need  paint / materials / gear / rubbish still to plan, order or move (the first need's icon)
 *   closed   grey    gear      a closed job with gear still on it
 *   none     teal    house     nothing outstanding
 * An item of a kind outside the ladder is listed on the hover card (and counted) but never
 * changes the icon.
 */
import type { WorkItemKind } from "@/lib/crm/work-queue";

export type PinTier = "problem" | "call" | "visit" | "move" | "closed" | "none";
export type AttentionIcon = "warning" | "phone" | "clipboard" | "need" | "gear" | "house";
export type JobItem = { kind: string; title: string };
export type AttentionLine = { tier: PinTier | "other"; label: string };
export type JobAttention = {
  tier: PinTier;
  icon: AttentionIcon;
  /** Every open thing on the job, most important first; the hover card lists them. */
  lines: AttentionLine[];
  /** lines.length — the corner badge when more than one. */
  count: number;
};

const LADDER: Partial<Record<WorkItemKind, PinTier>> = {
  movement_problem: "problem", movement_overdue: "problem", payment_hold: "problem", walkthrough_flagged: "problem", callback_unbooked: "problem",
  job_checkin: "call", job_followup: "call", callback_visit_soon: "call", delivery_unconfirmed: "call",
  qa_check_due: "visit", qa_check_to_book: "visit", qa_check_final_cancelled: "visit", site_visit_due: "visit",
  material_request: "move", order_unplaced: "move", movements_unplanned: "move", equipment_stranded: "move", hire_off_due: "move", job_moved: "move", materials_changed_after_order: "move",
};
const RANK: Record<PinTier | "other", number> = { problem: 0, call: 1, visit: 2, move: 3, other: 4, closed: 5, none: 6 };
export const TIER_ICON: Record<PinTier, AttentionIcon> = { problem: "warning", call: "phone", visit: "clipboard", move: "need", closed: "gear", none: "house" };
export const TIER_LABEL: Record<PinTier, string> = {
  problem: "Something is wrong", call: "Call the client", visit: "Office on site", move: "Something to move", closed: "Closed — gear still there", none: "Nothing outstanding",
};

export function tierOfKind(kind: string): PinTier | "other" {
  return LADDER[kind as WorkItemKind] ?? "other";
}

/**
 * The job's icon and its list. `needWords` are the movement needs already in words
 * ("paint to plan", "rubbish · not ordered"); they sit on the move rung.
 */
export function jobAttention(items: readonly JobItem[], needWords: readonly string[], closed: boolean): JobAttention {
  const lines: AttentionLine[] = [
    ...items.map((i) => ({ tier: tierOfKind(i.kind), label: i.title })),
    ...needWords.map((w) => ({ tier: "move" as const, label: w })),
  ].sort((a, b) => RANK[a.tier] - RANK[b.tier]);
  const top = lines.find((l) => l.tier !== "other")?.tier as PinTier | undefined;
  const tier: PinTier = top ?? (closed ? "closed" : "none");
  return { tier, icon: TIER_ICON[tier], lines, count: lines.length };
}
