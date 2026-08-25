import { describe, expect, it } from "vitest";
import { reviewGate, REVIEW_GATE_CENTS } from "./reviewGate";
import type { PricingContext, Adjustments } from "@/lib/pricing/estimate";
import type { RateItem, Product } from "@/lib/pricing/types";

const item = (over: Partial<Record<string, unknown>>) => ({
  category: "Interior", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: null, metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2, ...over,
}) as unknown as RateItem;

const ctx: PricingContext = {
  rateItems: [
    item({ code: "Walls" }),
    item({ code: "Weatherboard", category: "Exterior", charge_out_cents: 10000 }),
    item({ code: "Ceilings", sub_category: "Ceilings", rate_2_coat: 10 }),
    item({ code: "Flat Door and Frame (1 Side)", unit: "Hours Per Item", sub_category: "Doors", rate_2_coat: 0.75 }),
    item({ code: "Standard Cornices", unit: "Lineal Metres", sub_category: "Cornices", rate_2_coat: 20 }),
  ],
  products: [] as unknown as Product[],
  modifiers: [],
  settings: [],
};
const adj: Adjustments = { modSel: {}, materials: {} };
const TYP = { bedroom: { L: 3.5, W: 3.25 } };

const surface = (code: string, over: Partial<Record<string, unknown>> = {}) => ({
  code, coats: 2, count: 1, prepHr: 0, hidden: false, measureL: null, measureH: null,
  qtyOverride: null, rateOverride: null, paintingHrOverride: null, useCustomRate: false,
  customRate: null, coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
  priceOverride: null, productName: null, ...over,
});

describe("reviewGate", () => {
  it("prices an unmeasured room at its typical size and flags it", () => {
    const { items, totalImpactCents } = reviewGate(
      [{ id: 1, kind: "area", name: "Bed 2", type: "Interior", areaType: "room", L: 0, W: 0, H: 2.4, roomType: "bedroom", surfaces: [surface("Walls"), surface("Ceilings")] } as never],
      ctx, adj, TYP,
    );
    expect(items).toHaveLength(1);
    expect(items[0].needs).toMatch(/priced at \$0/);
    expect(items[0].impactCents).toBeGreaterThan(0);
    expect(totalImpactCents).toBe(items[0].impactCents);
  });

  it("a measured room with confirmed surfaces raises nothing", () => {
    const { items } = reviewGate(
      [{ id: 1, kind: "area", name: "Bed", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, surfaces: [surface("Walls")] } as never],
      ctx, adj, TYP,
    );
    expect(items).toHaveLength(0);
  });

  it("photo-detected prep and deferred openings are priced and ordered by impact", () => {
    const { items } = reviewGate(
      [{ id: 1, kind: "area", name: "Lounge", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, surfaces: [surface("Walls", { prepHr: 2, assumedFields: ["prep"], internalLabel: "Walls" })] } as never],
      ctx, adj, TYP,
      [{ room: "Hallway", what: "4 doors", count: 4, needs: "flat or panel?" }],
    );
    expect(items).toHaveLength(2);
    // 4 doors at 0.75h x $85 = $255 beats 2h prep at $85 = $170
    expect(items[0].needs).toContain("4 doors");
    expect(items[0].impactCents).toBe(Math.round(0.75 * 4 * 8500));
    expect(items[1].impactCents).toBe(2 * 8500);
    expect(items[0].impactCents + items[1].impactCents).toBeGreaterThan(REVIEW_GATE_CENTS);
  });

  it("a MEASURED exterior side (L x H, no W — it never has one) raises nothing", () => {
    // The 25 Aug bug: the L-and-W check flagged every priced exterior side
    // as "no measurements - priced at $0" forever.
    const { items } = reviewGate(
      [{ id: 1, kind: "area", name: "Exterior - Front", type: "Exterior", areaType: "surface", L: 12, W: 0, H: 2.6, surfaces: [surface("Weatherboard")] } as never],
      ctx, adj, TYP,
    );
    expect(items).toHaveLength(0);
  });

  it("an unmeasured exterior side flags at a typical elevation, not a bedroom", () => {
    const { items } = reviewGate(
      [{ id: 1, kind: "area", name: "Exterior - Rear", type: "Exterior", areaType: "surface", L: 0, W: 0, H: 0, surfaces: [surface("Weatherboard")] } as never],
      ctx, adj, TYP,
    );
    expect(items).toHaveLength(1);
    expect(items[0].basis).toContain("elevation");
    // 10 x 2.6 m x 8 m²/h-rate... impact = qty x hours x charge — just pin > 0
    expect(items[0].impactCents).toBeGreaterThan(0);
  });

  it("a width-measurement deferral self-heals once the width is entered", () => {
    const deferral = {
      room: "Exterior - Front", areaId: 1, kind: "exterior_width", what: "wall + trim measurements",
      count: 1, needs: "width measurement required - measure this elevation on site and enter it in the builder",
    };
    // Width entered → the note is stale → gone.
    const healed = reviewGate(
      [{ id: 1, kind: "area", name: "Exterior - Front", type: "Exterior", areaType: "surface", L: 12, W: 0, H: 2.6, surfaces: [surface("Weatherboard")] } as never],
      ctx, adj, TYP, [deferral],
    );
    expect(healed.items).toHaveLength(0);
    // Width still missing → the note stands (and the $0 flag joins it).
    const standing = reviewGate(
      [{ id: 1, kind: "area", name: "Exterior - Front", type: "Exterior", areaType: "surface", L: 0, W: 0, H: 2.6, surfaces: [surface("Weatherboard")] } as never],
      ctx, adj, TYP, [deferral],
    );
    expect(standing.items.some((i) => /width measurement/.test(i.needs))).toBe(true);
  });

  it("option areas are excluded - they are outside the total", () => {
    const { items } = reviewGate(
      [{ id: 1, kind: "area", name: "Optional deck", type: "Interior", areaType: "room", L: 0, W: 0, H: 2.4, isOption: true, surfaces: [surface("Walls")] } as never],
      ctx, adj, TYP,
    );
    expect(items).toHaveLength(0);
  });
});
