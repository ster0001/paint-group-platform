/**
 * A6: window S/M/L — a multiplier on the window rate, Settings-tunable,
 * default 0.8 / 1.0 / 1.2, medium/absent = no change (golden safety).
 */
import { describe, expect, it } from "vitest";
import {
  priceSurface,
  resolveRates,
  isWindowItem,
  windowSizeMultiplier,
  type Adjustments,
  type AreaInput,
  type PricingContext,
  type SurfaceInput,
} from "./estimate";
import type { Product, RateItem } from "./types";

const windowItem = {
  category: "Interior", code: "Double Hung Sash", unit: "Hours Per Item",
  sub_category: "Interior Windows",
  rate_1_coat: 0.8, rate_2_coat: 1.2, rate_3_coat: 1.6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: null, metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

const wallsItem = {
  category: "Interior", code: "Walls", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: null, metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

const ctx = (settings: Array<{ key: string; value: unknown }> = []): PricingContext => ({
  rateItems: [windowItem, wallsItem],
  products: [] as unknown as Product[],
  modifiers: [],
  settings: [{ key: "GST", value: { value: 0.1 } }, ...settings],
});

const adj: Adjustments = { modSel: {}, materials: {} };
const area: AreaInput = {
  kind: "area", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
  surfaces: [],
};
const surface = (over: Partial<SurfaceInput> = {}): SurfaceInput => ({
  code: "Double Hung Sash", coats: 2, count: 2, prepHr: 0, ...over,
});

function hoursFor(s: SurfaceInput, c = ctx()) {
  const rates = resolveRates(c, adj);
  return priceSurface(area, s, c, adj, rates).paintingHr;
}

describe("window size multiplier (A6)", () => {
  it("medium and absent both price exactly as before", () => {
    const base = hoursFor(surface());
    expect(base).toBeCloseTo(2 * 1.2);
    expect(hoursFor(surface({ size: "medium" }))).toBe(base);
    expect(hoursFor(surface({ size: null }))).toBe(base);
  });

  it("small ×0.8 and large ×1.2 by default", () => {
    const base = hoursFor(surface());
    expect(hoursFor(surface({ size: "small" }))).toBeCloseTo(base * 0.8);
    expect(hoursFor(surface({ size: "large" }))).toBeCloseTo(base * 1.2);
  });

  it("multipliers are Settings-tunable", () => {
    const tuned = ctx([
      { key: "Window size — small", value: { value: 0.7 } },
      { key: "Window size — large", value: { value: 1.5 } },
    ]);
    const base = hoursFor(surface(), tuned);
    expect(hoursFor(surface({ size: "small" }), tuned)).toBeCloseTo(base * 0.7);
    expect(hoursFor(surface({ size: "large" }), tuned)).toBeCloseTo(base * 1.5);
  });

  it("never touches a non-window rate", () => {
    const walls = surface({ code: "Walls", size: "large" });
    expect(hoursFor(walls)).toBe(hoursFor(surface({ code: "Walls" })));
    expect(isWindowItem(wallsItem)).toBe(false);
    expect(isWindowItem(windowItem)).toBe(true);
  });

  it("a typed hours override always wins outright", () => {
    expect(hoursFor(surface({ size: "large", paintingHrOverride: 5 }))).toBe(5);
  });

  it("windowSizeMultiplier is 1 for unknown items", () => {
    expect(windowSizeMultiplier(undefined, "large", { windowSmall: 0.8, windowLarge: 1.2 })).toBe(1);
  });
});
