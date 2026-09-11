import type { GuardrailDecision, BandSettings } from "./policy";
import type { WizardState } from "./state";
import { conditionPhotoCount } from "./merge";
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

/**
 * MAY THIS JOB HAVE ITS PRICE FIXED WITHOUT A PERSON? (C7)
 *
 * The one place the question is answered. `ladderFor` calls it for the tier,
 * and the `fix_online` route calls it again at the moment of the tap — the
 * customer's screen may be minutes old, and in those minutes a flagged spot or
 * an added room can take self-serve away.
 *
 * It exists as a named export rather than three lines repeated in a route
 * because that is exactly what phase 0 spent C1 and C2 undoing: the ladder in
 * four places, `requires_site_check` in two. A second copy of this expression
 * would be a second policy, and the one that decides money would be the one
 * nobody was looking at.
 */
export function mayFixOnline(decision: GuardrailDecision): boolean {
  return decision.outcome === "reveal" && decision.canAccept && !decision.walkthroughRequired;
}

export function ladderFor(i: LadderInput): Ladder {
  const acc = i.accuracyPct;
  const selfServe = mayFixOnline(i.decision);
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

// ---- requires_site_check: derived once, read everywhere -----------------------

/**
 * Does this job need a person to look before a price can be fixed?
 *
 * AUDIT 9.1, and it was executed proof rather than a theory. The submit route
 * derived this correctly for the COLUMN it wrote (condition photos, double
 * storey, peeling, access gear, unpriceable targets) but passed `wantsExterior`
 * — a different question entirely — into `evaluateGuardrails` a hundred lines
 * earlier. So an interior job with condition photos was told at submit that it
 * could accept online, while `estimates.requires_site_check` said it could not,
 * and the scope page then refused. Worse, the proving snapshot recorded
 * `walkthroughRequired: false` for exactly those jobs, quietly poisoning the
 * calibration baseline the gate depends on.
 *
 * One function now. The submit route calls it once and uses the answer for BOTH
 * the decision and the column; every later surface calls it with the stored
 * column so it can never be softer than submit was.
 *
 * `stored` is ORed in rather than replacing the derivation, because escalations
 * that happen after submit only live in the column — the editor sets it when a
 * custom surface, rot or a geometry flag appears
 * (`app/api/estimates/[id]/wizard-edit/route.ts:493` and `:887`). A surface that
 * derived from state alone would silently forget those.
 */
export function requiresSiteCheck(input: {
  /** The wizard state to derive from. At submit this is `effectiveState`, so a
   *  failed defect read does not count as a condition photo — it is flagged for
   *  review instead. */
  state?: Pick<WizardState, "jobType" | "details" | "conditionSourceIds" | "exterior"> | null;
  /** `estimates.requires_site_check`, where post-submit escalations live. */
  stored?: boolean | null;
}): boolean {
  if (input.stored === true) return true;
  const state = input.state;
  if (!state) return false;

  // Tom, 7 Sep: condition photos = estimator sign-off before any price is
  // fixed, interior OR exterior. This is the clause 9.1 lost.
  if (conditionPhotoCount(state) > 0) return true;

  const wantsExterior = state.jobType !== "interior";
  if (!wantsExterior) return false;

  const ext = state.exterior;
  // An exterior job with no exterior answers has not told us enough to price it.
  if (!ext) return true;
  return (
    state.jobType === "both"
    || ext.storeys === "double"
    || ext.condition === "peeling"
    // Gear the wizard cannot price (scissor/boom lift, scaffold) — the
    // estimator confirms access before any price is fixed.
    || ext.accessEquipment.length > 0
    // Tom, 7 Sep: things the card cannot price yet (metal fence, floor
    // coatings, a freestanding wall, "other" cladding).
    || ext.extras.fenceType === "metal"
    || ext.targets.some((t) => t === "floor" || t === "wall" || t === "shed")
    || ext.substrates.includes("other")
  );
}
