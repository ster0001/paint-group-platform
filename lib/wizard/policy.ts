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
 *                   accuracy score; acceptance only inside the sign-off
 *                   ladder (v2 ruling, wizard-rebuild-plan-v2 §0): interior
 *                   <= $6k at >= 90%, straightforward exterior <= $12k at
 *                   >= 85%, everything else "Confirm my price — book the
 *                   visit". Never for a job carrying requires_site_check.
 */

/** v2 (19 Aug 2026): supersedes v1's $7k/$15k/80–90 ladder. The $15k
 * always-walkthrough rule is DELETED — the per-jobtype caps replace it.
 * All four numbers are Settings values (wizard_policy). */
export type WizardPolicySettings = {
  interiorSelfServeCapCents: number;
  interiorSelfServeMinAccuracyPct: number;
  exteriorSelfServeCapCents: number;
  exteriorSelfServeMinAccuracyPct: number;
  minJobCents: number;
};

export const DEFAULT_POLICY: WizardPolicySettings = {
  interiorSelfServeCapCents: 600_000,
  interiorSelfServeMinAccuracyPct: 90,
  exteriorSelfServeCapCents: 1_200_000,
  exteriorSelfServeMinAccuracyPct: 85,
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
    interiorSelfServeCapCents: num(v.interiorSelfServeCapCents, DEFAULT_POLICY.interiorSelfServeCapCents),
    interiorSelfServeMinAccuracyPct: num(v.interiorSelfServeMinAccuracyPct, DEFAULT_POLICY.interiorSelfServeMinAccuracyPct),
    exteriorSelfServeCapCents: num(v.exteriorSelfServeCapCents, DEFAULT_POLICY.exteriorSelfServeCapCents),
    exteriorSelfServeMinAccuracyPct: num(v.exteriorSelfServeMinAccuracyPct, DEFAULT_POLICY.exteriorSelfServeMinAccuracyPct),
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

/** Pull a settings row's value out of the already-loaded settings list. */
export function settingValue(settings: Array<{ key: string; value: unknown }>, key: string): unknown {
  return settings.find((s) => s.key === key)?.value ?? null;
}

/** Service-area postcodes from the settings row; empty = not configured. */
export function serviceAreaFromSettings(value: unknown): string[] {
  const v = (value ?? {}) as { postcodes?: unknown };
  return Array.isArray(v.postcodes) ? v.postcodes.filter((p): p is string => typeof p === "string") : [];
}

/** GuardrailAnswers from a wizard state. A missing customer block (internal
 * mode previews) evaluates as a clean residential house. */
export function answersFromState(s: {
  jobType: "interior" | "exterior" | "both";
  details: { damageTier: number };
  /** R2: the exterior condition answer maps onto the damage tier, so
   * peeling + pre-1970 trips the SAME lead hard stop interior damage does. */
  exterior?: { condition: "good" | "weathered" | "peeling" | null } | null;
  customer: {
    postcode: string;
    propertyKind: "house" | "townhouse" | "unit_apartment" | "commercial";
    heritageListed: "yes" | "no" | "unsure";
    bodyCorporate: "yes" | "no" | "unsure";
    builtPre1970: "yes" | "no" | "unsure";
    asbestosSuspected: "yes" | "no" | "unsure";
  } | null;
}): GuardrailAnswers {
  const exteriorTier = s.exterior?.condition === "peeling" ? 3
    : s.exterior?.condition === "weathered" ? 2
    : s.exterior?.condition === "good" ? 1 : null;
  return {
    jobType: s.jobType,
    propertyKind: s.customer?.propertyKind ?? "house",
    heritageListed: s.customer?.heritageListed ?? "no",
    bodyCorporate: s.customer?.bodyCorporate ?? "no",
    builtPre1970: s.customer?.builtPre1970 ?? "no",
    asbestosSuspected: s.customer?.asbestosSuspected ?? "no",
    damageTier: s.jobType === "exterior" && exteriorTier != null
      ? exteriorTier
      : Math.max(s.details.damageTier, exteriorTier ?? 0),
    // null = postcode was never collected (internal previews have no customer
    // block) - the service-area check does not apply. "" = a customer left it
    // blank, which the check treats as outside.
    postcode: s.customer ? s.customer.postcode : null,
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
  /** null = not collected (internal mode) - the area check is skipped. */
  postcode: string | null;
};

/** The customer-facing wording for each blocking outcome - shared by submit
 * and the edit route so an outcome reads the same wherever it is decided. */
export const GUARDRAIL_MESSAGES: Record<string, string> = {
  hard_stop: "Homes of this age and condition need a lead-safe or asbestos assessment before any painting is priced. We'll be in touch to arrange it — there's no obligation.",
  handoff: "This one needs a person rather than a calculator — we'll look at what you've sent and come back to you within one business day.",
  outside_area: "It looks like you're outside the area we currently service — we've kept your details and will let you know if that changes.",
  below_floor: "Smaller jobs are quoted from our minimum call-out. We'll confirm the exact price with you directly.",
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
  // internal proving window is never blocked by an unconfigured setting. A
  // null postcode means it was never collected (internal mode) — the check
  // does not apply; only a customer-entered postcode is judged.
  if (a.postcode !== null) {
    const pc = a.postcode.trim();
    if (serviceAreaPostcodes.length > 0 && (!pc || !serviceAreaPostcodes.includes(pc))) {
      return { outcome: "outside_area", reasons: ["outside_service_area"], walkthroughRequired: true, canAccept: false };
    }
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
  // A zero total is NOT a small job - it means nothing could be measured
  // (e.g. an exterior whose photos couldn't be read). That needs a person,
  // never the minimum-call-out message.
  if (totalCents != null && totalCents <= 0) {
    return { outcome: "handoff", reasons: ["nothing_priced"], walkthroughRequired: true, canAccept: false };
  }
  if (totalCents != null && totalCents < policy.minJobCents) {
    return { outcome: "below_floor", reasons: ["below_minimum"], walkthroughRequired: false, canAccept: false };
  }

  // ---- 5. reveal, inside the v2 sign-off ladder -----------------------------
  // Self-serve = interior <= cap at >= 90%, OR straightforward exterior
  // <= cap at >= 85% (straightforwardness itself rides requiresSiteCheck:
  // double storey, peeling, rot, custom surfaces and flags all set it).
  // A mixed interior+exterior job is always the visit tier. Never a blocked
  // state — the visit tier is an offer with the calendar right there.
  const softReasons = reasons; // e.g. heritage_unsure — noted for staff, not blocking
  let walkthrough = requiresSiteCheck;
  if (requiresSiteCheck) softReasons.push("site_check_required");
  const isExteriorish = a.jobType !== "interior";
  if (a.jobType === "both") {
    walkthrough = true; softReasons.push("mixed_scope");
  }
  const cap = isExteriorish ? policy.exteriorSelfServeCapCents : policy.interiorSelfServeCapCents;
  const minAcc = isExteriorish ? policy.exteriorSelfServeMinAccuracyPct : policy.interiorSelfServeMinAccuracyPct;
  if (totalCents != null && totalCents > cap) {
    walkthrough = true; softReasons.push("over_self_serve_cap");
  }
  if (accuracyPct < minAcc) {
    walkthrough = true; softReasons.push("accuracy_below_bar");
  }

  return {
    outcome: "reveal",
    reasons: softReasons,
    walkthroughRequired: walkthrough,
    canAccept: !walkthrough,
  };
}
