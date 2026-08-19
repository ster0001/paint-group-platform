import { describe, expect, it } from "vitest";
import {
  bandsFromSettings,
  DEFAULT_POLICY,
  evaluateGuardrails,
  policyFromSettings,
  rangeBandPct,
  rangeFromTotal,
  type GuardrailAnswers,
} from "./policy";

const clean = (over: Partial<GuardrailAnswers> = {}): GuardrailAnswers => ({
  jobType: "interior",
  propertyKind: "house",
  heritageListed: "no",
  bodyCorporate: "no",
  builtPre1970: "no",
  asbestosSuspected: "no",
  damageTier: 1,
  postcode: "3070",
  ...over,
});

describe("range bands", () => {
  it("follows the W4 spec bands", () => {
    expect(rangeBandPct(95)).toBe(4);
    expect(rangeBandPct(90)).toBe(4);
    expect(rangeBandPct(89)).toBe(8);
    expect(rangeBandPct(70)).toBe(8);
    expect(rangeBandPct(69)).toBe(15);
    expect(rangeBandPct(0)).toBe(15);
  });

  it("rounds the range outward to whole tens of dollars", () => {
    const { loCents, hiCents } = rangeFromTotal(1_234_567, 8);
    expect(loCents % 1000).toBe(0);
    expect(hiCents % 1000).toBe(0);
    expect(loCents).toBeLessThanOrEqual(1_234_567 * 0.92);
    expect(hiCents).toBeGreaterThanOrEqual(1_234_567 * 1.08);
  });

  it("settings parsing survives garbage and keeps defaults", () => {
    expect(policyFromSettings(null)).toEqual(DEFAULT_POLICY);
    expect(policyFromSettings({ minJobCents: "drop table" }).minJobCents).toBe(DEFAULT_POLICY.minJobCents);
    expect(policyFromSettings({ minJobCents: -5 }).minJobCents).toBe(DEFAULT_POLICY.minJobCents);
    expect(bandsFromSettings({ tightPct: 3 }).tightPct).toBe(3);
  });
});

describe("guardrails — hard stops", () => {
  it("asbestos suspected never shows a price", () => {
    const d = evaluateGuardrails(clean({ asbestosSuspected: "yes" }), 1_000_000, 95, false);
    expect(d.outcome).toBe("hard_stop");
    expect(d.canAccept).toBe(false);
    expect(d.reasons).toContain("asbestos_suspected");
  });

  it("pre-1970 with real damage is a lead-paint stop", () => {
    const d = evaluateGuardrails(clean({ builtPre1970: "yes", damageTier: 2 }), 1_000_000, 95, false);
    expect(d.outcome).toBe("hard_stop");
    expect(d.reasons).toContain("lead_paint_disturbance");
  });

  it("pre-1970 in good condition still reveals", () => {
    const d = evaluateGuardrails(clean({ builtPre1970: "yes", damageTier: 1 }), 1_000_000, 95, false);
    expect(d.outcome).toBe("reveal");
  });

  it("hard stops outrank every other rule — even outside the area", () => {
    const d = evaluateGuardrails(
      clean({ asbestosSuspected: "yes", propertyKind: "commercial", postcode: "9999" }),
      100, 10, true, DEFAULT_POLICY, ["3070"],
    );
    expect(d.outcome).toBe("hard_stop");
  });
});

describe("guardrails — service area", () => {
  it("outside the configured area is a polite exit", () => {
    const d = evaluateGuardrails(clean({ postcode: "2000" }), 1_000_000, 95, false, DEFAULT_POLICY, ["3070", "3071"]);
    expect(d.outcome).toBe("outside_area");
  });

  it("an empty list means not configured — never blocks", () => {
    const d = evaluateGuardrails(clean({ postcode: "2000" }), 1_000_000, 95, false, DEFAULT_POLICY, []);
    expect(d.outcome).toBe("reveal");
  });

  it("a missing postcode with a configured area fails safe (outside)", () => {
    const d = evaluateGuardrails(clean({ postcode: "  " }), 1_000_000, 95, false, DEFAULT_POLICY, ["3070"]);
    expect(d.outcome).toBe("outside_area");
  });
});

describe("guardrails — handoffs", () => {
  it("commercial, heritage-listed and body-corporate all hand off", () => {
    for (const over of [
      { propertyKind: "commercial" as const },
      { heritageListed: "yes" as const },
      { bodyCorporate: "yes" as const },
      { asbestosSuspected: "unsure" as const },
    ]) {
      const d = evaluateGuardrails(clean(over), 1_000_000, 95, false);
      expect(d.outcome).toBe("handoff");
      expect(d.canAccept).toBe(false);
    }
  });

  it("heritage 'not sure' alone does not lose the lead", () => {
    const d = evaluateGuardrails(clean({ heritageListed: "unsure" }), 1_000_000, 95, false);
    expect(d.outcome).toBe("reveal");
    expect(d.reasons).toContain("heritage_unsure"); // staff still see it
  });
});

describe("guardrails — floor and walkthrough policy", () => {
  it("under the $2k floor is a polite minimum message", () => {
    const d = evaluateGuardrails(clean(), 150_000, 95, false);
    expect(d.outcome).toBe("below_floor");
  });

  it(">= $15k always requires a walkthrough, whatever the accuracy", () => {
    const d = evaluateGuardrails(clean(), 1_500_000, 99, false);
    expect(d.outcome).toBe("reveal");
    expect(d.walkthroughRequired).toBe(true);
    expect(d.canAccept).toBe(false);
  });

  it("v2 ladder: interior self-serves <= $6k at >= 90%, else the visit tier", () => {
    expect(evaluateGuardrails(clean(), 500_000, 85, false).canAccept).toBe(false); // accuracy below bar
    expect(evaluateGuardrails(clean(), 500_000, 92, false).canAccept).toBe(true);
    expect(evaluateGuardrails(clean(), 700_000, 95, false).canAccept).toBe(false); // over the $6k cap
    const over = evaluateGuardrails(clean(), 700_000, 95, false);
    expect(over.outcome).toBe("reveal"); // never a blocked state — the visit tier is an offer
    expect(over.reasons).toContain("over_self_serve_cap");
  });

  it("v2 ladder: a STRAIGHTFORWARD exterior self-serves <= $12k at >= 85%", () => {
    expect(evaluateGuardrails(clean({ jobType: "exterior" }), 900_000, 87, false).canAccept).toBe(true);
    expect(evaluateGuardrails(clean({ jobType: "exterior" }), 900_000, 82, false).canAccept).toBe(false);
    expect(evaluateGuardrails(clean({ jobType: "exterior" }), 1_300_000, 95, false).canAccept).toBe(false);
    // A mixed interior+exterior job is always the visit tier.
    expect(evaluateGuardrails(clean({ jobType: "both" }), 500_000, 95, false).canAccept).toBe(false);
  });

  it("requires_site_check (a non-straightforward exterior) can never self-accept", () => {
    const d = evaluateGuardrails(clean({ jobType: "exterior" }), 900_000, 95, true);
    expect(d.outcome).toBe("reveal");
    expect(d.walkthroughRequired).toBe(true);
    expect(d.canAccept).toBe(false);
    expect(d.reasons).toContain("site_check_required");
  });
});

// ---- audit-fix pins (19 Aug) ------------------------------------------------
import { GUARDRAIL_MESSAGES as MSGS } from "./policy";

it("a zero total is 'nothing priced' -> handoff, never below_floor", () => {
  const d = evaluateGuardrails(clean(), 0, 90, false);
  expect(d.outcome).toBe("handoff");
  expect(d.reasons).toContain("nothing_priced");
  expect(MSGS[d.outcome]).toBeTruthy();
});

it("a null postcode (internal mode) skips the service-area check; an empty customer one does not", () => {
  const configured = ["3000"];
  const internal = evaluateGuardrails({ ...clean(), postcode: null }, 500_000, 90, false, undefined, configured);
  expect(internal.outcome).toBe("reveal");
  const customerBlank = evaluateGuardrails({ ...clean(), postcode: "" }, 500_000, 90, false, undefined, configured);
  expect(customerBlank.outcome).toBe("outside_area");
});
