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
    commercialKind?: CommercialKind | null;
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
    commercialKind: s.customer?.commercialKind ?? null,
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

/** Tom, 8 Sep 2026: the three sorts of commercial job the wizard asks about. */
export type CommercialKind = "small_interior" | "large_interior" | "strata";

export type GuardrailAnswers = {
  jobType: "interior" | "exterior" | "both";
  propertyKind: "house" | "townhouse" | "unit_apartment" | "commercial";
  /** Only meaningful when propertyKind is commercial; null = never asked
   * (an older session, the assistant) — treated as "a person looks". */
  commercialKind?: CommercialKind | null;
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
  /** True when the submitter is a signed-in TRADE account (office-granted).
   * The commercial / body-corp / heritage handoff exists to stop ANONYMOUS
   * visitors self-serving jobs a human must scope — a vetted trade customer
   * building commercial estimates is the customer that tier was never meant
   * for (Tom, 28 Aug: the commercial portal handed its own user off). Those
   * three become soft flags on the visit tier instead. The asbestos and
   * lead-paint rules are SAFETY rules and never relax for anyone. */
  tradeActor = false,
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
  // Tom, 8 Sep 2026: commercial is not one thing. A few rooms or offices is
  // priced by the wizard like any interior (a person still signs it off —
  // the visit tier); a large space or a strata / body-corporate building
  // is seen first. No answer (older session, the assistant) = a person.
  if (a.propertyKind === "commercial") {
    if (a.commercialKind === "small_interior") reasons.push("commercial_small");
    else if (a.commercialKind === "large_interior") reasons.push("commercial_large");
    else if (a.commercialKind === "strata") reasons.push("commercial_strata");
    else reasons.push("commercial_property");
  }
  if (a.heritageListed !== "no") reasons.push(a.heritageListed === "yes" ? "heritage_listed" : "heritage_unsure");
  if (a.bodyCorporate === "yes") reasons.push("body_corporate");
  if (a.asbestosSuspected === "unsure") reasons.push("asbestos_unsure");
  // Tom, 7 Sep (late): the wizard no longer asks the build year (the office
  // looks it up), so "unsure" is the normal answer and never hands off. A
  // definite "yes" (staff, the assistant) keeps the lead-paint hard stop above.
  // "heritage_unsure" alone is not worth losing the lead over when everything
  // else is clean — only definite answers hand off on their own. For a trade
  // actor, commercial/body-corp/heritage are soft too (see the parameter
  // note). Tom, 7 Sep 2026: "Not sure" about asbestos is a flag for the visit
  // (never an online accept), not a dead end — now that nothing is
  // pre-selected, honest people pick it, and a person on site settles it.
  // asbestos YES and lead_paint_possible stay hard for everyone.
  const softForActor = new Set(
    tradeActor
      ? ["heritage_unsure", "asbestos_unsure", "heritage_listed", "commercial_property", "commercial_small", "commercial_large", "commercial_strata", "body_corporate"]
      : ["heritage_unsure", "asbestos_unsure", "commercial_small"],
  );
  const hardReasons = reasons.filter((r) => !softForActor.has(r));
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
  // An unsure asbestos answer is settled by a person on site, never online.
  if (reasons.includes("asbestos_unsure")) walkthrough = true;
  if (requiresSiteCheck) softReasons.push("site_check_required");
  // A trade job that would have handed off still takes the VISIT tier — the
  // price shows as a range, but a person signs it off before acceptance.
  if (tradeActor && reasons.some((r) => r.startsWith("commercial_") || r === "body_corporate" || r === "heritage_listed")) {
    walkthrough = true;
  }
  // A small commercial job is priced online but a person confirms it on
  // site before anything is booked (Tom, 8 Sep) — the visit tier.
  if (reasons.includes("commercial_small")) walkthrough = true;
  const isExteriorish = a.jobType !== "interior";
  if (a.jobType === "both") {
    walkthrough = true; softReasons.push("mixed_scope");
  }
  // Tom, 21 Aug: "remove accept estimate from the bottom of the exterior
  // wizard for now — all exterior jobs will require a job sign-off by the
  // estimator." So ANY exterior work takes the visit tier, whatever the
  // size or the accuracy score. The caps below still run: they only ever
  // add reasons, never remove them.
  if (isExteriorish) {
    walkthrough = true; softReasons.push("exterior_signoff");
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

/**
 * Tom, 7 Sep 2026: a blocking outcome says WHY in plain words. "This one
 * deserves a person" with no reason read as a broken wizard the first time
 * a floorplan run landed on it; the reason is always one of these.
 */
const WHY: Record<string, string> = {
  commercial_property: "Commercial properties are priced by a person — the scope and access are different from a home.",
  commercial_large: "A larger commercial space is priced on site — the scope, access and working hours are different from a home, so a person comes and sees it.",
  commercial_strata: "Strata and body-corporate work is priced on site — common areas, access and the owners corporation's requirements are confirmed by a person first.",
  heritage_listed: "A heritage listing changes what paints and methods are allowed, so a person confirms the details.",
  body_corporate: "Body-corporate work needs the owners corporation's requirements confirmed first.",
  lead_paint_possible: "A home that may be pre-1970 and in real need of repair is checked for lead paint before anything is priced.",
  asbestos_suspected: "Where asbestos sheeting is possible, an assessment comes before any painting is priced.",
  lead_paint_disturbance: "Paint of this age and condition is checked for lead before anything is priced.",
  nothing_priced: "We couldn't read any rooms from what was uploaded, so there was nothing to price yet — the quick questions (three taps) work every time.",
  outside_service_area: "The address is outside the area we currently cover.",
  below_minimum: "The job is smaller than our minimum call-out, so we confirm the price directly.",
};

export function guardrailWhy(reasons: string[]): string | null {
  for (const r of reasons) if (WHY[r]) return WHY[r];
  return null;
}
