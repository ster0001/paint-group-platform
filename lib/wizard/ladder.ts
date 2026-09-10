import type { GuardrailDecision, BandSettings } from "./policy";
import { visitReason, type SidesLoopMeta, type VisitReason } from "./sides";

/**
 * The ONE ladder (estimator-v2-delta-and-plan.md C1; audit 9.2 and 9.6).
 *
 * Before this file, "can the customer accept online?" was decided in three
 * places with the same formula copied out — `customer-scope.ts`, the
 * wizard-edit route and `scope-tools.ts` — each reading a `scope_editor.
 * selfServe*` setting with hard-coded fallbacks, while `policy.ts` had its
 * own `wizard_policy` caps that `evaluateGuardrails` already applied. Two
 * sources of truth for one decision, and no Settings screen for either.
 *
 * Now: `evaluateGuardrails` is the only place the caps and the accuracy bar
 * live (its `canAccept` already means "under the cap, over the bar, no
 * site check, nothing that needs a person"), and this function turns that
 * decision plus the band thresholds into what the customer is shown:
 *
 *   tier        Guide below `midMin` · Detailed from `midMin` · Confirmed
 *               from `tightMin` AND accept-eligible. Confirmed is not a
 *               fourth number; it is "Detailed, plus the evidence that lets
 *               us fix the price without a visit".
 *   selfServe   exactly `decision.canAccept` — Confirmed and selfServe are
 *               the same fact seen from two sides.
 *   reason      why a person is involved (the sticky line's wording).
 *   nextUnlock  what would lift the tier — and NEVER a target the current
 *               road cannot reach: an exterior job is never told about Confirmed,
 *               nor is a job over the online cap or carrying a visit-only
 *               reason. A score that can't be hit reads as "you failed".
 */

/**
 * Ruling G (11 Sep 2026): no reward tiers. These three are ACCURACY LABELS over
 * the existing band evaluator — what we know about the job — never a status the
 * customer earns and never attached to a benefit. Nothing in the build refers to
 * bronze, silver or gold. The rewards half of the branch this came from
 * (wizard_rewards, the paint upgrade, first-pick-of-start-dates, goldSkipVisit)
 * was stripped in C1 for that reason: a benefit that varies by tier rewards
 * completing our form, prices the thinnest-margin jobs worst, and makes a
 * booking promise the calendar may not keep.
 */
export type Tier = "guide" | "detailed" | "confirmed";

export const TIER_LABEL: Record<Tier, string> = { guide: "Guide", detailed: "Detailed", confirmed: "Confirmed" };

export type NextUnlock = { tier: Tier; needs: string[] };

export type Ladder = {
  tier: Tier;
  /** The customer may accept online (= Confirmed). */
  selfServe: boolean;
  /** Why a person is in the loop, when they are. */
  reason: VisitReason | null;
  visitSlots: string[];
  nextUnlock: NextUnlock | null;
};

export type LadderInput = {
  accuracyPct: number;
  decision: GuardrailDecision;
  bands: BandSettings;
  /** The sides loop's answers (any job — the interior-only default is fine). */
  sidesMeta: SidesLoopMeta;
  deferred: ReadonlyArray<{ what: string; needs: string; kind?: string }>;
  hasExterior: boolean;
  /** A floorplan run or a listing is on file — the road to Confirmed. */
  hasPlan: boolean;
  /** Loop areas the customer has not yet confirmed. */
  pendingAreas: number;
  visitSlots: string[];
};

/**
 * Reasons a person is involved that no answer from the customer removes.
 * "signoff" and "big" are deliberately NOT here: `visitReason` returns
 * "signoff" as its residual for ANY job that is not self-serve — an interior
 * merely below the accuracy bar included — and treating that as visit-only
 * hid Confirmed from exactly the job that can reach it by uploading a plan.
 * (Exterior, where "signoff" is real, returns before this set is consulted.)
 */
const VISIT_ONLY: ReadonlySet<VisitReason> = new Set(["peeling", "rot", "flagged", "photos"]);

export function ladderFor(i: LadderInput): Ladder {
  const acc = i.accuracyPct;
  const selfServe = i.decision.outcome === "reveal" && i.decision.canAccept && !i.decision.walkthroughRequired;
  const reason: VisitReason | null = selfServe ? null : visitReason(i.sidesMeta, i.deferred);

  let tier: Tier = "guide";
  if (acc >= i.bands.tightMin && selfServe) tier = "confirmed";
  else if (acc >= i.bands.midMin) tier = "detailed";

  return { tier, selfServe, reason, visitSlots: i.visitSlots, nextUnlock: nextUnlockFor(tier, i, reason) };
}

function nextUnlockFor(tier: Tier, i: LadderInput, reason: VisitReason | null): NextUnlock | null {
  if (tier === "confirmed") return null;
  const rooms = i.hasExterior ? "side" : "room";
  const confirmLine = i.pendingAreas > 0
    ? `Confirm ${i.pendingAreas} more ${rooms}${i.pendingAreas === 1 ? "" : "s"}`
    : null;

  if (tier === "guide") {
    const needs: string[] = [];
    if (confirmLine) needs.push(confirmLine);
    if (!i.hasPlan) needs.push("Upload your floorplan or paste the listing");
    if (i.deferred.length > 0) needs.push(`Answer the ${i.deferred.length} open question${i.deferred.length === 1 ? "" : "s"}`);
    return needs.length ? { tier: "detailed", needs } : null;
  }

  // Detailed → Confirmed, only when Confirmed is actually on this road.
  if (i.hasExterior) return null;                                   // an estimator signs off every exterior job
  if (i.decision.outcome !== "reveal") return null;                  // a hand-off / stop is not an unlock
  if (i.decision.reasons.includes("over_self_serve_cap")) return null;
  if (i.decision.reasons.includes("mixed_scope")) return null;
  if (reason && VISIT_ONLY.has(reason)) return null;
  const needs: string[] = [];
  if (!i.hasPlan) needs.push("Upload your floorplan or paste the listing");
  if (confirmLine) needs.push(confirmLine);
  if (reason === "custom") needs.push("Something you named needs a person to price it — remove it, or a person confirms it with you");
  if (i.decision.reasons.includes("asbestos_unsure")) return null;   // settled on site, never online
  return needs.length ? { tier: "confirmed", needs } : null;
}
