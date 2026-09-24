import { describe, expect, it } from "vitest";
import { revisionContractorPay } from "./contractorRate";
import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";

const wall = { id: 1, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" };
const room = (id: number, L: number) => ({ kind: "area", id, name: `Room ${id}`, type: "Interior", areaType: "room", L, W: 4, H: 2.4, surfaces: [{ ...wall, id: id * 10 }] });
const ctx: PricingContext = {
  rateItems: [{ id: "r1", rate_card_id: "c", area_type: "Interior", code: "WALL", name: "Walls", unit: "m2", rate_cents: 1200, hours_per_unit: 0.05, coats_default: 2 } as unknown as PricingContext["rateItems"][number]],
  products: [],
  modifiers: [],
  settings: [{ key: "Contractor rate", value: { value: 60 } }],
};

describe("revisionContractorPay — the working scope's rate reaches the painter (Tom, 24 Sep 2026)", () => {
  const accepted = { blocks: [room(1, 5)], modSel: {} };

  it("with no override, the rate is the rate card's and the base is the accepted scope at that rate", () => {
    const r = revisionContractorPay(accepted, { blocks: [room(1, 5), room(2, 6)], modSel: {} }, ctx);
    expect(r.rateCents).toBe(6000);
    expect(r.baseCents).toBe(priceEstimateTotals(accepted.blocks as unknown as BlockInput[], ctx, { modSel: {}, materials: {} }).contractorOfferCents);
  });

  it("the working scope's override reprices the ACCEPTED scope, not the working one — changes ride as variation deltas", () => {
    const working = { blocks: [room(1, 5), room(2, 6)], modSel: {}, contractorRateOverride: 75 };
    const r = revisionContractorPay(accepted, working, ctx);
    expect(r.rateCents).toBe(7500);
    const acceptedAt75 = priceEstimateTotals(accepted.blocks as unknown as BlockInput[], ctx, { modSel: {}, materials: {}, contractorRateOverride: 75 }).contractorOfferCents;
    const workingAt75 = priceEstimateTotals(working.blocks as unknown as BlockInput[], ctx, { modSel: {}, materials: {}, contractorRateOverride: 75 }).contractorOfferCents;
    expect(r.baseCents).toBe(acceptedAt75);
    expect(r.baseCents).toBeLessThan(workingAt75);
    expect(r.baseCents).toBeGreaterThan(0);
  });

  it("an accepted scope with no blocks is a zero base, never a crash", () => {
    expect(revisionContractorPay({}, { contractorRateOverride: 50 }, ctx)).toEqual({ rateCents: 5000, baseCents: 0 });
  });
});
