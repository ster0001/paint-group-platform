/**
 * Step 8 (W4): the customer-layer policy — range bands, guardrails and the
 * walkthrough rule. Pure functions over Settings values; every number here
 * is Tom's to change in Settings, not a constant (business inputs §2).
 *
 * The ORDER of evaluation is the safety design, most severe first:
 *
 *   1. HARD STOPS   lead paint (pre-1970 + deteriorated) and asbestos —
 *                   no price is ever shown; an assessment comes first.
 *   2. OUTSIDE AREA politely out of the service area (postcode list).
 *   3. HANDOFF      commercial / heritage / body-corporate — a human calls;
 *                   the wizard prices none of these.
 *   4. BELOW FLOOR  under the minimum job — polite minimum message.
 *   5. REVEAL       a range (never a point price), whose width follows the
 *                   accuracy score; acceptance only inside the walkthrough
 *                   policy, and NEVER for a job carrying requires_site_check
 *                   (Tom's rule: exteriors are signed off by a human).
 */

export type WizardPolicySettings = {
  minAccuracyPctToAccept: number;
  smallJobMinAccuracyPct: number;
  smallJobThresholdCents: number;
  walkthroughAlwaysAboveCents: number;
  minJobCents: number;
};

export const DEFAULT_POLICY: WizardPolicySettings = {
  minAccuracyPctToAccept: 80,
  smallJobMinAccuracyPct: 90,
  smallJobThresholdCents: 700_000,
  walkthroughAlwaysAboveCents: 1_500_000,
  minJobCents: 200_000,
};

export type BandSettings = {
  tightMin: number; tightPct: number;
  midMin: number; midPct: number;
  widePct: number;
};

/** Phase plan W4: >=90 → ±4% · 70–89 → ±8% · <70 → ±15%. */
export const DEFAULT_BANDS: BandSettings = { tightMin: 90, tightPct: 4, midMin: 70, midPct: 8, widePct: 15 };

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;

export function policyFromSettings(value: unknown): WizardPolicySettings {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    minAccuracyPctToAccept: num(v.minAccuracyPctToAccept, DEFAULT_POLICY.minAccuracyPctToAccept),
    smallJobMinAccuracyPct: num(v.smallJobMinAccuracyPct, DEFAULT_POLICY.smallJobMinAccuracyPct),
    smallJobThresholdCents: num(v.smallJobThresholdCents, DEFAULT_POLICY.smallJobThresholdCents),
    walkthroughAlwaysAboveCents: num(v.walkthroughAlwaysAboveCents, DEFAULT_POLICY.walkthroughAlwaysAboveCents),
    minJobCents: num(v.minJobCents, DEFAULT_POLICY.minJobCents),
  };
}

export function bandsFromSettings(value: unknown): BandSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    tightMin: num(v.tightMin, DEFAULT_BANDS.tightMin),
    tightPct: num(v.tightPct, DEFAULT_BANDS.tightPct),
    midMin: num(v.midMin, DEFAULT_BANDS.midMin),
    widePct: num(v.widePct, DEFAULT_BANDS.widePct),
    midPct: num(v.midPct, DEFAULT_BANDS.midPct),
  };
}

/** The ± percentage the customer's range uses for a given accuracy score. */
export function rangeBandPct(accuracyPct: number, bands: BandSettings = DEFAULT_BANDS): number {
  if (accuracyPct >= bands.tightMin) return bands.tightPct;
  if (accuracyPct >= bands.midMin) return bands.midPct;
  return bands.widePct;
}

/** The customer-facing range, rounded outward to whole tens of dollars —
 * a range that looks machine-precise invites false confidence. */
export function rangeFromTotal(totalCents: number, pct: number): { loCents: number; hiCents: number } {
  const lo = totalCents * (1 - pct / 100);
  const hi = totalCents * (1 + pct / 100);
  return {
    loCents: Math.floor(lo / 1000) * 1000,
    hiCents: Math.ceil(hi / 1000) * 1000,
  };
}

export type GuardrailAnswers = {
  jobType: "interior" | "exterior" | "both";
  propertyKind: "house" | "townhouse" | "unit_apartment" | "commercial";
  heritageListed: "yes" | "no" | "unsure";
  bodyCorporate: "yes" | "no" | "unsure";
  builtPre1970: "yes" | "no" | "unsure";
  asbestosSuspected: "yes" | "no" | "unsure";
  damageTier: number;
  postcode: string;
};

export type GuardrailOutcome =
  | "reveal"
  | "hard_stop"
  | "outside_area"
  | "handoff"
  | "below_floor";

export type GuardrailDecision = {
  outcome: GuardrailOutcome;
  /** Machine-readable reasons, most severe first — the lead row records them
   * and the adversarial script asserts on them. */
  reasons: string[];
  walkthroughRequired: boolean;
  canAccept: boolean;
};

export function evaluateGuardrails(
  a: GuardrailAnswers,
  totalCents: number | null,
  accuracyPct: number,
  requiresSiteCheck: boolean,
  policy: WizardPolicySettings = DEFAULT_POLICY,
  serviceAreaPostcodes: string[] = [],
): GuardrailDecision {
  const reasons: string[] = [];

  // ---- 1. hard stops: never price, never negotiate --------------------------
  if (a.asbestosSuspected === "yes") reasons.push("asbestos_suspected");
  if (a.builtPre1970 === "yes" && a.damageTier >= 2) reasons.push("lead_paint_disturbance");
  if (reasons.length) {
    return { outcome: "hard_stop", reasons, walkthroughRequired: true, canAccept: false };
  }

  // ---- 2. service area ------------------------------------------------------
  // An empty list means the area check is not configured yet — allow, so the
  // internal proving window is never blocked by an unconfigured setting.
  const pc = a.postcode.trim();
  if (serviceAreaPostcodes.length > 0 && (!pc || !serviceAreaPostcodes.includes(pc))) {
    return { outcome: "outside_area", reasons: ["outside_service_area"], walkthroughRequired: true, canAccept: false };
  }

  // ---- 3. human handoffs ----------------------------------------------------
  if (a.propertyKind === "commercial") reasons.push("commercial_property");
  if (a.heritageListed !== "no") reasons.push(a.heritageListed === "yes" ? "heritage_listed" : "heritage_unsure");
  if (a.bodyCorporate === "yes") reasons.push("body_corporate");
  if (a.asbestosSuspected === "unsure") reasons.push("asbestos_unsure");
  if (a.builtPre1970 === "unsure" && a.damageTier >= 3) reasons.push("lead_paint_possible");
  // "heritage_unsure" alone is not worth losing the lead over when everything
  // else is clean — only definite answers hand off on their own.
  const hardReasons = reasons.filter((r) => r !== "heritage_unsure");
  if (hardReasons.length) {
    return { outcome: "handoff", reasons, walkthroughRequired: true, canAccept: false };
  }

  // ---- 4. minimum job -------------------------------------------------------
  if (totalCents != null && totalCents < policy.minJobCents) {
    return { outcome: "below_floor", reasons: ["below_minimum"], walkthroughRequired: false, canAccept: false };
  }

  // ---- 5. reveal, inside the walkthrough policy -----------------------------
  const softReasons = reasons; // e.g. heritage_unsure — noted for staff, not blocking
  let walkthrough = requiresSiteCheck;
  if (requiresSiteCheck) softReasons.push("site_check_required");
  if (totalCents != null && totalCents >= policy.walkthroughAlwaysAboveCents) {
    walkthrough = true; softReasons.push("large_job");
  }
  if (accuracyPct < policy.minAccuracyPctToAccept) {
    walkthrough = true; softReasons.push("accuracy_below_floor");
  }
  if (totalCents != null && totalCents < policy.smallJobThresholdCents && accuracyPct < policy.smallJobMinAccuracyPct) {
    walkthrough = true; softReasons.push("small_job_needs_tight_accuracy");
  }

  return {
    outcome: "reveal",
    reasons: softReasons,
    walkthroughRequired: walkthrough,
    canAccept: !walkthrough,
  };
}
