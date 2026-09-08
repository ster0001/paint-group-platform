import type { GuardrailDecision, BandSettings } from "./policy";
import { visitReason, type SidesLoopMeta, type VisitReason } from "./sides";

/**
 * The ONE ladder (customer-flow-plan.md · reward-tiers-plan.md, PR 1).
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
 *   tier        Bronze below `midMin` · Silver from `midMin` · Gold from
 *               `tightMin` AND accept-eligible. Gold is not a fourth number;
 *               it is "Silver, plus the evidence that lets us skip the visit".
 *   selfServe   exactly `decision.canAccept` — Gold and selfServe are the
 *               same fact seen from two sides.
 *   reason      why a person is involved (the sticky line's wording).
 *   nextUnlock  what would lift the tier — and NEVER a target the current
 *               road cannot reach: an exterior job is never told about Gold,
 *               nor is a job over the online cap or carrying a visit-only
 *               reason. A score that can't be hit reads as "you failed".
 */

export type Tier = "bronze" | "silver" | "gold";

export const TIER_LABEL: Record<Tier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

export type NextUnlock = { tier: Tier; needs: string[] };

export type Ladder = {
  tier: Tier;
  /** The customer may accept online (= Gold). */
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
  /** A floorplan run or a listing is on file — the Gold road. */
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
 * hid Gold from exactly the job that can reach it by uploading a plan.
 * (Exterior, where "signoff" is real, returns before this set is consulted.)
 */
const VISIT_ONLY: ReadonlySet<VisitReason> = new Set(["peeling", "rot", "flagged", "photos"]);

export function ladderFor(i: LadderInput): Ladder {
  const acc = i.accuracyPct;
  const selfServe = i.decision.outcome === "reveal" && i.decision.canAccept && !i.decision.walkthroughRequired;
  const reason: VisitReason | null = selfServe ? null : visitReason(i.sidesMeta, i.deferred);

  let tier: Tier = "bronze";
  if (acc >= i.bands.tightMin && selfServe) tier = "gold";
  else if (acc >= i.bands.midMin) tier = "silver";

  return { tier, selfServe, reason, visitSlots: i.visitSlots, nextUnlock: nextUnlockFor(tier, i, reason) };
}

function nextUnlockFor(tier: Tier, i: LadderInput, reason: VisitReason | null): NextUnlock | null {
  if (tier === "gold") return null;
  const rooms = i.hasExterior ? "side" : "room";
  const confirmLine = i.pendingAreas > 0
    ? `Confirm ${i.pendingAreas} more ${rooms}${i.pendingAreas === 1 ? "" : "s"}`
    : null;

  if (tier === "bronze") {
    const needs: string[] = [];
    if (confirmLine) needs.push(confirmLine);
    if (!i.hasPlan) needs.push("Upload your floorplan or paste the listing");
    if (i.deferred.length > 0) needs.push(`Answer the ${i.deferred.length} open question${i.deferred.length === 1 ? "" : "s"}`);
    return needs.length ? { tier: "silver", needs } : null;
  }

  // Silver → Gold, only when Gold is actually on this road.
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
  return needs.length ? { tier: "gold", needs } : null;
}

// ---- rewards: data, never constants ------------------------------------------

export const WIZARD_REWARDS_KEY = "wizard_rewards";

export type RewardLine = { label: string; note: string };

export type WizardRewards = {
  silver: RewardLine[];
  gold: RewardLine[];
  /**
   * Tom, 8 Sep 2026: "book straight in" ships OFF. Until it is flipped a
   * Gold acceptance reads "your estimator confirms it within a business
   * day, at a desk or with a quick look"; after ~20 Gold desk checks held
   * in range, it becomes "no site visit". The build is the same either way.
   */
  goldSkipVisit: boolean;
};

export const DEFAULT_REWARDS: WizardRewards = {
  silver: [
    { label: "30-day price hold", note: "Your range is held for 30 days." },
    { label: "First pick of start dates", note: "You choose a start week and we book you first." },
  ],
  gold: [
    { label: "Everything in Silver", note: "" },
    { label: "Paint upgrade", note: "Trade paint upgraded to premium, at no cost." },
    { label: "Free Dulux colour consult", note: "A one-hour consultation with a Dulux colour specialist." },
  ],
  goldSkipVisit: false,
};

const MAX_LINES = 6;
const cleanLine = (v: unknown): RewardLine | null => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : "";
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 200) : "";
  return label ? { label, note } : null;
};

/** The settings value → a complete object; anything unusable falls back. */
export function rewardsFromSettings(value: unknown): WizardRewards {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = (k: "silver" | "gold"): RewardLine[] => {
    const arr = Array.isArray(v[k]) ? (v[k] as unknown[]).map(cleanLine).filter((x): x is RewardLine => x != null).slice(0, MAX_LINES) : [];
    return arr.length ? arr : DEFAULT_REWARDS[k];
  };
  return { silver: list("silver"), gold: list("gold"), goldSkipVisit: v.goldSkipVisit === true };
}

/** The Gold list as the customer reads it — the last line follows the switch. */
export function goldLines(r: WizardRewards): RewardLine[] {
  return [
    ...r.gold,
    r.goldSkipVisit
      ? { label: "No site visit — book straight in", note: "Sign now and your start is booked." }
      : { label: "Sign now", note: "Your estimator confirms it within a business day — at a desk, or with a quick look." },
  ];
}
