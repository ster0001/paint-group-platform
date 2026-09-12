import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_COMMERCIAL_PRICING, OPEN_SIZE_M2, applyOpenSpace, commercialPricingFrom, commercialWidenPct,
  hourLoadingFor, needsEwp, openSpaceDimensions, openSpaceWallHeight,
} from "./commercial";
import { computeQuantity, priceEstimateTotals, priceSurface, resolveRates, itemIndex, productIndex, jobModifier, type Adjustments, type AreaInput, type BlockInput, type PricingContext } from "./estimate";
import type { DraftArea } from "@/lib/extract/draft";

/**
 * C12 golden tests (addendum S6a):
 *   (1) a 150–400 m² open plan with tiles carries no ceiling line and its
 *       wall m² equals the full perimeter × height;
 *   (2) hours=after applies exactly loading_after_hours to labour hours and
 *       nothing to materials or allowances;
 *   (3) a school hall at "over 6 m" adds exactly one EWP pass-through line;
 *   (4) the residential golden tests are unchanged (golden.test.ts runs on
 *       the same fixture with no loading — asserted here too, explicitly).
 */

type Fixture = {
  reference: PricingContext;
  cases: { ref: string; input: Adjustments & { blocks: BlockInput[] } }[];
};
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as Fixture;
const ctx: PricingContext = fixture.reference;

const wallsItem = () => ctx.rateItems.find((r) => r.category === "Interior" && r.code === "Walls")!;

function openArea(name: string, size: "50" | "150" | "400" | "800", H = 2.4): DraftArea {
  const { L, W } = openSpaceDimensions(size);
  return {
    id: 7, kind: "area", name, type: "Interior", areaType: "room", roomType: "living", L, W, H, storey: "ground",
    isOption: false, description: "", open: true, media: [], origin: "ai_assumed", confidence: 0.5, assumedFields: [],
    surfaces: [
      { code: "Walls" }, { code: "Ceilings" }, { code: "Skirting Boards" },
    ].map((s, i) => ({
      id: 100 + i, code: s.code, internalLabel: s.code, clientLabel: s.code, coats: 2, count: 1, hidden: false, media: [],
      measureL: null, measureH: null, qtyOverride: null, rateOverride: null, paintingHrOverride: null, prepHr: 0,
      priceOverride: null, productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null,
      unitPriceOverride: null, crewNote: "", origin: "ai_assumed", confidence: 0.5, assumedFields: [],
    } as unknown as DraftArea["surfaces"][number])),
  } as unknown as DraftArea;
}

describe("(1) open plan, 150–400 m², tiled ceiling", () => {
  it("carries no ceiling line, and its walls are the FULL perimeter × height", () => {
    const a = openArea("Open plan", "400");
    const flagged = applyOpenSpace([a], { openNames: new Set(["Open plan"]), ceiling: "tiles", mode: "size", height: null });
    expect(a.surfaces.map((s) => s.code)).toEqual(["Walls", "Skirting Boards"]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].kind).toBe("commercial_ceiling");
    expect(flagged[0].areaId).toBe(7);
    // Square at the midpoint: 275 m² → 16.58 m a side; nothing deducted for partitions or frontage.
    const side = Math.sqrt(OPEN_SIZE_M2["400"]);
    expect(a.L).toBeCloseTo(side, 1);
    const walls = a.surfaces.find((s) => s.code === "Walls")!;
    const qty = computeQuantity(wallsItem(), a as unknown as AreaInput, { code: "Walls", coats: 2, count: 1, prepHr: 0 });
    expect(qty).toBeCloseTo(2 * (a.L + a.W) * 2.4, 6);
    expect(walls.qtyOverride).toBeNull();
  });

  it("keeps the ceiling when it is plaster, and flags nothing", () => {
    const a = openArea("Open plan", "150");
    const flagged = applyOpenSpace([a], { openNames: new Set(["Open plan"]), ceiling: "plaster", mode: "size", height: null });
    expect(a.surfaces.map((s) => s.code)).toContain("Ceilings");
    expect(flagged).toEqual([]);
  });

  it("an exposed ceiling is flagged as not included", () => {
    const a = openArea("Front of house", "150");
    const flagged = applyOpenSpace([a], { openNames: new Set(["Front of house"]), ceiling: "exposed", mode: "size", height: null });
    expect(flagged[0].what).toMatch(/Exposed ceiling/);
    expect(a.surfaces.some((s) => /ceiling/i.test(s.code))).toBe(false);
  });

  it("leaves the smaller rooms alone", () => {
    const a = openArea("Office 1", "150");
    const flagged = applyOpenSpace([a], { openNames: new Set(["Open plan"]), ceiling: "tiles", mode: "size", height: null });
    expect(a.surfaces).toHaveLength(3);
    expect(flagged).toEqual([]);
  });
});

describe("(2) hours=after is a loading on production hours only", () => {
  const cases = fixture.cases.slice(0, 6);
  it("multiplies the painting hours by exactly the loading; prep (allowances) and materials are untouched", () => {
    const loading = DEFAULT_COMMERCIAL_PRICING.loadings.after;
    expect(loading).toBe(1.35);
    const items = itemIndex(ctx.rateItems);
    const products = productIndex(ctx.products);
    let checked = 0;
    for (const c of cases) {
      const { blocks, ...adj } = c.input;
      const base = adj as Adjustments;
      const loaded: Adjustments = { ...base, hourLoading: loading };
      const rates0 = resolveRates(ctx, base);
      const rates1 = resolveRates(ctx, loaded);
      const jm = jobModifier(ctx.modifiers, base.modSel);
      for (const b of blocks) {
        if (b.kind !== "area") continue;
        for (const s of b.surfaces) {
          const r0 = priceSurface(b, s, ctx, base, rates0, items, products, jm);
          const r1 = priceSurface(b, s, ctx, loaded, rates1, items, products, jm);
          if (s.paintingHrOverride != null) { expect(r1.paintingHr).toBe(r0.paintingHr); continue; }
          expect(r1.paintingHr).toBeCloseTo(r0.paintingHr * loading, 9);
          expect(r1.prepHr).toBe(r0.prepHr);
          expect(r1.matCostCents).toBe(r0.matCostCents);
          expect(r1.matPriceCents).toBe(r0.matPriceCents);
          expect(r1.volume).toBe(r0.volume);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("(4) with no loading the residential totals are exactly the golden figures", () => {
    for (const c of fixture.cases) {
      const { blocks, ...adj } = c.input;
      const a = priceEstimateTotals(blocks, ctx, adj as Adjustments);
      const b = priceEstimateTotals(blocks, ctx, { ...(adj as Adjustments), hourLoading: 1 });
      const d = priceEstimateTotals(blocks, ctx, { ...(adj as Adjustments), hourLoading: undefined });
      expect(b.totalCents).toBe(a.totalCents);
      expect(d.totalCents).toBe(a.totalCents);
    }
  });

  it("resolves the one number from the hours and occupied answers", () => {
    expect(hourLoadingFor({ hours: "business", occ: "vacant" })).toBe(1);
    expect(hourLoadingFor({ hours: "after", occ: null })).toBe(1.35);
    expect(hourLoadingFor({ hours: "after", occ: "occ" })).toBe(1.431);
    expect(hourLoadingFor({ hours: "weekend", occ: "occ" })).toBe(1.484);
    expect(hourLoadingFor({ hours: "holidays", occ: "next" })).toBe(1);
    // An unknown answer never loads — it is not a wall either.
    expect(hourLoadingFor({ hours: "nonsense", occ: null })).toBe(1);
  });

  it("reads the Settings row and falls back per field", () => {
    const p = commercialPricingFrom({ loadings: { after: 1.5, bogus: 99 }, widenPct: { commercial: 7 }, ewpHeightThresholdM: 5, chargeOutCents: 9500 });
    expect(p.loadings.after).toBe(1.5);
    expect(p.loadings.weekend).toBe(1.4);
    expect(p.loadings.bogus).toBeUndefined();
    expect(p.widenPct).toEqual({ commercial: 7, warehouse: 5, noPhotoOpen: 3 });
    expect(p.ewpHeightThresholdM).toBe(5);
    expect(p.chargeOutCents).toBe(9500);
    expect(commercialPricingFrom(null)).toEqual(DEFAULT_COMMERCIAL_PRICING);
  });
});

describe("(3) a school hall at over 6 m", () => {
  it("adds exactly one EWP line, and none at ladder height or with a lift on site", () => {
    const hall = openArea("Hall", "800");
    const flagged = applyOpenSpace([hall], { openNames: new Set(["Hall"]), ceiling: "tiles", mode: "height", height: "9" });
    expect(flagged.filter((f) => f.kind === "commercial_ewp")).toHaveLength(1);
    expect(hall.H).toBe(7.5);
    expect(hall.assumedFields).toContain("H");

    const low = openArea("Hall", "800");
    expect(applyOpenSpace([low], { openNames: new Set(["Hall"]), ceiling: "tiles", mode: "height", height: "4" }).filter((f) => f.kind === "commercial_ewp")).toHaveLength(0);
    expect(low.H).toBe(3.6);

    const lift = openArea("Hall", "800");
    expect(applyOpenSpace([lift], { openNames: new Set(["Hall"]), ceiling: "tiles", mode: "height", height: "9", liftOnSite: true }).filter((f) => f.kind === "commercial_ewp")).toHaveLength(0);
  });

  it("two halls share ONE EWP line — the hire is per job", () => {
    const a = openArea("Hall 1", "800"), b = openArea("Hall 2", "800");
    const flagged = applyOpenSpace([a, b], { openNames: new Set(["Hall 1", "Hall 2"]), ceiling: "tiles", mode: "height", height: "6" });
    expect(flagged.filter((f) => f.kind === "commercial_ewp")).toHaveLength(1);
    expect(flagged.filter((f) => f.kind === "commercial_ceiling")).toHaveLength(2);
  });

  it("the threshold is the Settings value", () => {
    expect(needsEwp("height", "6")).toBe(true);
    expect(needsEwp("height", "6", { ...DEFAULT_COMMERCIAL_PRICING, ewpHeightThresholdM: 5.5 })).toBe(false);
    expect(needsEwp("size", "9")).toBe(false);
    expect(openSpaceWallHeight("size", "9")).toBeNull();
  });
});

describe("⚑20 the widening", () => {
  it("is the Settings value, plus the no-photo value only while the open space has no photo", () => {
    expect(commercialWidenPct({ pattern: "areas", openCount: 1, photos: 0 })).toBe(8);
    expect(commercialWidenPct({ pattern: "areas", openCount: 1, photos: 1 })).toBe(5);
    expect(commercialWidenPct({ pattern: "areas", openCount: 0, photos: 0 })).toBe(5);
    expect(commercialWidenPct({ pattern: "warehouse", openCount: 1, photos: 0 })).toBe(8);
    const p = commercialPricingFrom({ widenPct: { commercial: 6, noPhotoOpen: 2 } });
    expect(commercialWidenPct({ pattern: "areas", openCount: 2, photos: 0 }, p)).toBe(8);
    expect(commercialWidenPct({ pattern: "areas", openCount: 2, photos: 3 }, p)).toBe(6);
  });
});
