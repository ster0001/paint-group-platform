import type { DeskCheckPack, DeskCheckOutcome } from "./desk-check";
import { recommendedOutcome } from "./desk-check";

/**
 * A qualified lead, as a row — C5 (plan §2.6).
 *
 * ⚑7's desk check already assembles the pack and already decides fix / ask /
 * visit. What it had no way to say was WHO should look, WHAT we suggested, and
 * what the pack looked like at the moment we promised a person would check —
 * because it was triggered by a jsonb marker on `builder_state`, and a marker
 * has no timestamps and no history. It is either there or it is not.
 *
 * This turns that decision into the fields a `confirmation_requests` row
 * carries. Pure: no database, no clock, no rate card. The total is passed in
 * because pricing is the engine's job, and this must never become a second
 * opinion about money.
 */

export type ConfirmationKind = "remote" | "visit" | "fix_online";

export type ConfirmationDraft = {
  kind: ConfirmationKind;
  suggestedAction: DeskCheckOutcome;
  assignedTo: string | null;
  /** Why this kind, in words a person reads on the card. */
  why: string;
};

export type EstimatorPatch = {
  id: string;
  /** `profiles.patch_postcodes`. Empty = never auto-assigned. */
  postcodes: readonly string[];
};

/**
 * Which estimator's patch a postcode falls in.
 *
 * Exact match only, and the FIRST match wins with ties broken by id so the
 * answer is stable — two people covering one postcode is a roster question,
 * not something to resolve differently on each render.
 *
 * Returns null when nobody covers it, and that is a normal answer: assignment
 * is a convenience, not a gate. An unassigned request still sits in the queue
 * for whoever picks it up, which is better than assigning it to the wrong
 * person because somebody had to be chosen.
 */
export function estimatorForPostcode(
  postcode: string | null | undefined,
  staff: readonly EstimatorPatch[],
): string | null {
  const pc = (postcode ?? "").trim();
  if (!pc) return null;
  const covering = staff
    .filter((s) => s.postcodes.some((p) => p.trim() === pc))
    .sort((a, b) => a.id.localeCompare(b.id));
  return covering[0]?.id ?? null;
}

/**
 * What a "send for confirmation" creates.
 *
 * `kind` answers "what are we asking for", and it is the LADDER's answer, not
 * a new one: `pack.verdict` is `remoteConfirmVerdict` run over the Settings
 * from C1. A job it will not confirm remotely becomes a visit here rather than
 * a remote request nobody can fulfil — telling a customer we will confirm from
 * their photos and then sending someone is worse than saying so at the time.
 *
 * `suggestedAction` is the rules' opinion for the estimator's card. It is
 * RECORDED, never enforced: an estimator who visits a job the rules said could
 * be fixed is not wrong, and the gap between the two is the only evidence we
 * will ever get about whether the rules are any good.
 */
export function confirmationDraft(input: {
  pack: DeskCheckPack;
  postcode: string | null | undefined;
  staff: readonly EstimatorPatch[];
  /** A customer tapping "send", or staff sending it on their behalf. */
  requestedBy?: "customer" | "staff";
}): ConfirmationDraft {
  const { pack } = input;
  const suggestedAction = recommendedOutcome(pack);
  const kind: ConfirmationKind = pack.verdict.eligible ? "remote" : "visit";
  const why = pack.verdict.eligible
    ? pack.clean
      ? "Everything is answered and it is within what we fix without a visit."
      : "Within what we fix without a visit, with a few things to settle first."
    : pack.verdict.reason;

  return {
    kind,
    suggestedAction,
    assignedTo: estimatorForPostcode(input.postcode, input.staff),
    why,
  };
}

/**
 * The queue's order: value × readiness (plan §2.6).
 *
 * Value is the tree total. Readiness is how close it is to being fixable —
 * a clean pack the rules say to FIX outranks one with open questions at the
 * same money, because it can be turned into a signed job in minutes rather
 * than a phone call and a wait.
 *
 * Deliberately NOT a time decay. A request that has been waiting is chased by
 * the turnaround warning card, not by quietly climbing the list — an old job
 * is not a valuable one, and letting age outrank money buries the work that
 * actually pays.
 */
const READINESS: Record<DeskCheckOutcome, number> = { fix: 1, ask: 0.6, visit: 0.4 };

export function queueScore(row: { totalCents: number; suggestedAction: DeskCheckOutcome | null }): number {
  return row.totalCents * (READINESS[row.suggestedAction ?? "visit"] ?? 0.4);
}

export function sortQueue<T extends { totalCents: number; suggestedAction: DeskCheckOutcome | null; requestedAt: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const d = queueScore(b) - queueScore(a);
    if (d !== 0) return d;
    // Same score: oldest first, so a tie never leaves somebody waiting behind
    // a job that arrived later and is worth exactly the same.
    return a.requestedAt.localeCompare(b.requestedAt);
  });
}
