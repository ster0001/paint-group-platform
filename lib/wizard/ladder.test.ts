import { describe, expect, test } from "vitest";
import { DEFAULT_BANDS, DEFAULT_POLICY, evaluateGuardrails, type GuardrailAnswers, type GuardrailDecision } from "./policy";
import { defaultSidesLoop } from "./sides";
import { ladderFor, type LadderInput } from "./ladder";

/**
 * C1 — one ladder. These pin the facts the customer flow leans on: what a tier
 * is, that Confirmed and self-serve are one fact, and that the "next unlock"
 * never names a target the current road cannot reach.
 *
 * The tiers are accuracy labels, not rewards (ruling G) — nothing here asserts
 * a benefit, because no benefit varies by tier.
 */

const answers = (over: Partial<GuardrailAnswers> = {}): GuardrailAnswers => ({
  jobType: "interior", propertyKind: "house", heritageListed: "no", bodyCorporate: "no",
  builtPre1970: "unsure", asbestosSuspected: "no", damageTier: 0, postcode: null, ...over,
} as GuardrailAnswers);

const decide = (totalCents: number, acc: number, over: Partial<GuardrailAnswers> = {}, siteCheck = false): GuardrailDecision =>
  evaluateGuardrails(answers(over), totalCents, acc, siteCheck, DEFAULT_POLICY, []);

const input = (over: Partial<LadderInput> = {}): LadderInput => ({
  accuracyPct: 50, decision: decide(400_000, 50), bands: DEFAULT_BANDS, sidesMeta: defaultSidesLoop(),
  deferred: [], hasExterior: false, hasPlan: false, pendingAreas: 6, visitSlots: ["Tue 9am"], ...over,
});

describe("what a tier is", () => {
  test("guide below midMin, detailed from midMin, confirmed from tightMin AND accept-eligible", () => {
    expect(ladderFor(input({ accuracyPct: 41 })).tier).toBe("guide");
    expect(ladderFor(input({ accuracyPct: 70, decision: decide(400_000, 70) })).tier).toBe("detailed");
    expect(ladderFor(input({ accuracyPct: 89, decision: decide(400_000, 89) })).tier).toBe("detailed");
    const confirmed = ladderFor(input({ accuracyPct: 92, decision: decide(400_000, 92), hasPlan: true, pendingAreas: 0 }));
    expect(confirmed.tier).toBe("confirmed");
    expect(confirmed.selfServe).toBe(true);
    expect(confirmed.reason).toBeNull();
    expect(confirmed.nextUnlock).toBeNull();
  });

  test("confirmed and self-serve are the same fact: 92% over the cap is detailed, not confirmed", () => {
    const l = ladderFor(input({ accuracyPct: 92, decision: decide(900_000, 92), hasPlan: true, pendingAreas: 0 }));
    expect(l.tier).toBe("detailed");
    expect(l.selfServe).toBe(false);
    // …and Confirmed is not dangled: the cap is not something the customer can answer.
    expect(l.nextUnlock).toBeNull();
  });

  test("the thresholds are the bands — no second set of numbers", () => {
    const bands = { ...DEFAULT_BANDS, midMin: 60, tightMin: 95 };
    expect(ladderFor(input({ accuracyPct: 62, bands })).tier).toBe("detailed");
    expect(ladderFor(input({ accuracyPct: 92, decision: decide(400_000, 92), bands, hasPlan: true })).tier).toBe("detailed");
  });
});

describe("the next unlock never names a target the road can't reach", () => {
  test("guide → detailed: confirm rooms, upload a plan, answer the open questions", () => {
    const l = ladderFor(input({ accuracyPct: 41, pendingAreas: 6, deferred: [{ what: "x", needs: "y" }] }));
    expect(l.nextUnlock?.tier).toBe("detailed");
    expect(l.nextUnlock?.needs).toEqual([
      "Confirm 6 more rooms",
      "Upload your floorplan or paste the listing",
      "Answer the 1 open question",
    ]);
  });

  test("detailed, no plan → confirmed is unlocked BY the plan (the reachable road)", () => {
    const l = ladderFor(input({ accuracyPct: 74, decision: decide(400_000, 74), pendingAreas: 0 }));
    expect(l.tier).toBe("detailed");
    expect(l.nextUnlock).toEqual({ tier: "confirmed", needs: ["Upload your floorplan or paste the listing"] });
  });

  test("an exterior job is never told about confirmed — an estimator signs every one off", () => {
    const l = ladderFor(input({
      accuracyPct: 88, hasExterior: true,
      decision: decide(600_000, 88, { jobType: "exterior" }),
    }));
    expect(l.tier).toBe("detailed");
    expect(l.selfServe).toBe(false);
    expect(l.reason).toBe("signoff");
    expect(l.nextUnlock).toBeNull();
  });

  test("a visit-only reason (peeling, photos, rot) is not an unlock either", () => {
    const meta = { ...defaultSidesLoop(), cond: { cond: "peeling" as const, rot: null, acc: null } };
    const l = ladderFor(input({ accuracyPct: 80, decision: decide(400_000, 80, {}, true), sidesMeta: meta, hasPlan: true, pendingAreas: 0 }));
    expect(l.tier).toBe("detailed");
    expect(l.reason).toBe("peeling");
    expect(l.nextUnlock).toBeNull();
    const photos = ladderFor(input({ accuracyPct: 80, decision: decide(400_000, 80, {}, true), deferred: [{ what: "photos", needs: "sign off", kind: "photo_review" }], hasPlan: true, pendingAreas: 0 }));
    expect(photos.reason).toBe("photos");
    expect(photos.nextUnlock).toBeNull();
  });

  test("a custom item is an unlock the customer CAN act on — remove it or a person prices it", () => {
    const l = ladderFor(input({ accuracyPct: 80, decision: decide(400_000, 80, {}, true), deferred: [{ what: 'custom surface: "security bars"', needs: "price with the customer", kind: "custom_surface" }], hasPlan: true, pendingAreas: 0 }));
    expect(l.reason).toBe("custom");
    expect(l.nextUnlock?.tier).toBe("confirmed");
    expect(l.nextUnlock?.needs[0]).toMatch(/remove it, or a person confirms/);
  });

  test("a mixed interior + exterior job stops at detailed", () => {
    const l = ladderFor(input({ accuracyPct: 92, decision: decide(400_000, 92, { jobType: "both" }), hasPlan: true, pendingAreas: 0, hasExterior: true }));
    expect(l.tier).toBe("detailed");
    expect(l.nextUnlock).toBeNull();
  });

  test("a hand-off or a hard stop carries no ladder beyond guide/detailed and no unlock", () => {
    const l = ladderFor(input({ accuracyPct: 92, decision: decide(400_000, 92, { asbestosSuspected: "yes" }), hasPlan: true, pendingAreas: 0 }));
    expect(l.selfServe).toBe(false);
    expect(l.nextUnlock).toBeNull();
  });
});
