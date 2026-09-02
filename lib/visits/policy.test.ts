import { describe, expect, it } from "vitest";
import { visitPolicy, type VisitPolicyInput } from "./policy";

const base: VisitPolicyInput = { actor: "customer", guardrailReasons: [], damageTier: 1, propertyKind: "house", bodyCorporate: "no", authorised: null, multiProperty: false, customLines: 0, requiresSiteCheck: true };

describe("the one visit-policy function (visit brief §2)", () => {
  it("a clean residential job self-serves", () => {
    expect(visitPolicy(base).tier).toBe("self_serve");
  });
  it("lead paint can never reach self-serve", () => {
    expect(visitPolicy({ ...base, guardrailReasons: ["lead_paint_disturbance"] }).tier).toBe("phone_first");
  });
  it("damage beyond minor, body corporate, commercial, multi-property and amber lines route to a call", () => {
    for (const over of [{ damageTier: 2 }, { bodyCorporate: "yes" as const }, { propertyKind: "commercial" as const }, { multiProperty: true }, { customLines: 1 }, { authorised: false }]) {
      const p = visitPolicy({ ...base, ...over });
      expect(p.tier).toBe("phone_first");
      expect(p.reasons.length).toBeGreaterThan(0);
    }
  });
  it("staff-created visits are manual", () => {
    expect(visitPolicy({ ...base, actor: "staff" }).tier).toBe("manual");
  });
});
