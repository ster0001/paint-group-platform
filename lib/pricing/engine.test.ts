import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coatMultiplier,
  hoursPerUnit,
  productionHours,
  materialLitres,
  priceEstimate,
} from "./engine.ts";
import type { Product, RateItem } from "./types.ts";

const approx = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);

// --- Real rate-card rows (from v7) ---------------------------------------
const WALLS: RateItem = {
  code: "Walls",
  category: "Interior",
  unit: "M2",
  rate_1_coat: 18.01,
  rate_2_coat: 10.29,
  rate_3_coat: 7.2,
  charge_out_cents: 8500,
  default_product: "Haymes Expressions Wall",
  metres_per_litre: null,
  litres_per_item_per_coat: null,
};
const DOOR: RateItem = {
  code: "Flat Door and Frame (1 Side)",
  category: "Interior",
  unit: "Hours Per Item",
  rate_1_coat: 0.61,
  rate_2_coat: 1.07,
  rate_3_coat: 1.53,
  charge_out_cents: 8500,
  litres_per_item_per_coat: 0.16,
  metres_per_litre: null,
};

// --- Clean synthetic rows for exact arithmetic ---------------------------
const TEST_WALL: RateItem = {
  code: "TestWall",
  category: "Interior",
  unit: "M2",
  rate_1_coat: 20,
  rate_2_coat: 10, // 100 m² @ 2 coats -> exactly 10 hours
  rate_3_coat: 6.5,
  charge_out_cents: 8500,
  metres_per_litre: null,
  litres_per_item_per_coat: null,
};
const TEST_PAINT: Product = {
  name: "TestPaint",
  coverage: 10, // m²/L
  price_per_litre: 2000, // $20/L
  wastage_pct: 10,
};

test("coatMultiplier follows the marginal-coat rule", () => {
  approx(coatMultiplier(1), 1);
  approx(coatMultiplier(2), 1.75);
  approx(coatMultiplier(3), 2.5);
  approx(coatMultiplier(4), 3.25);
});

test("productionHours uses the rate-card column for coats 1–3", () => {
  approx(productionHours(WALLS, 40, 1), 40 / 18.01, 1e-6);
  approx(productionHours(WALLS, 40, 2), 40 / 10.29, 1e-6);
  approx(productionHours(WALLS, 40, 3), 40 / 7.2, 1e-6);
});

test("productionHours derives coats 4+ with the same rule", () => {
  // 4 coats: one-coat time × 3.25
  approx(productionHours(WALLS, 40, 4), (40 / 18.01) * 3.25, 1e-6);
});

test("productionHours handles item-based units (multiply, not divide)", () => {
  approx(productionHours(DOOR, 3, 2), 3 * 1.07, 1e-9); // 3 doors, 2 coats
});

test("materialLitres: area via coverage, with wastage", () => {
  // 100 m² × 2 coats / 10 m²·L⁻¹ × 1.10 wastage = 22 L
  approx(materialLitres(TEST_WALL, TEST_PAINT, 100, 2), 22, 1e-9);
});

test("materialLitres: item units via litres_per_item_per_coat", () => {
  const p: Product = { name: "x", coverage: null, price_per_litre: 1700, wastage_pct: 10 };
  // 3 items × 2 coats × 0.16 L × 1.10 = 1.056 L
  approx(materialLitres(DOOR, p, 3, 2), 3 * 2 * 0.16 * 1.1, 1e-9);
});

test("labour modifiers compound on hours, then convert to money", () => {
  const r = priceEstimate({
    production: [{ item: TEST_WALL, quantity: 100, coats: 2 }],
    conditionMultiplier: 1.35,
    accessMultiplier: 1.15,
    finishMultiplier: 1.06,
    sizeMultiplier: 1.05,
  });
  approx(r.labourModifier, 1.35 * 1.15 * 1.06 * 1.05, 1e-9); // 1.7279325
  approx(r.productionHours, 10 * 1.7279325, 1e-6); // 17.279325 hrs
  assert.equal(r.productionLabourCents, Math.round(10 * 1.7279325 * 8500)); // 146874
});

test("full quote assembles in the plan's order (exact figures)", () => {
  const r = priceEstimate({
    production: [{ item: TEST_WALL, quantity: 100, coats: 2, product: TEST_PAINT }],
    finishMultiplier: 1.0, // Level 3 baseline
    materialsMarkup: 0.1,
    sundriesCents: 27500, // $275 interior
  });
  assert.equal(r.productionLabourCents, 85000); // 10 hrs × $85
  assert.equal(r.materialCostCents, 44000); // 22 L × $20
  assert.equal(r.materialPriceCents, 48400); // × 1.10 markup
  assert.equal(r.totalCents, 85000 + 48400 + 27500); // 160900
  assert.equal(r.contractorOfferCents, 60000); // 10 hrs × $60 × 100%
  assert.equal(r.marginCents, 160900 - 60000 - 44000); // 56900
});

test("pass-through cost is billed AND recorded, and nets out of margin", () => {
  const r = priceEstimate({
    production: [{ item: TEST_WALL, quantity: 100, coats: 2, product: TEST_PAINT }],
    finishMultiplier: 1.0,
    materialsMarkup: 0.1,
    sundriesCents: 27500,
    passthroughs: [{ label: "Scaffold", priceCents: 500000, costCents: 400000 }],
  });
  assert.equal(r.passthroughPriceCents, 500000);
  assert.equal(r.passthroughCostCents, 400000); // the Hampton Street fix: cost recorded
  assert.equal(r.totalCents, 160900 + 500000); // 660900
  // margin gains only the $1,000 pass-through markup, not the whole $5,000
  assert.equal(r.marginCents, 56900 + (500000 - 400000)); // 156900
});

test("modifiers touch labour only — materials & sundries are untouched", () => {
  const base = {
    production: [{ item: TEST_WALL, quantity: 100, coats: 2, product: TEST_PAINT }],
    materialsMarkup: 0.1,
    sundriesCents: 27500,
  };
  const a = priceEstimate({ ...base, finishMultiplier: 1.0 });
  const b = priceEstimate({ ...base, finishMultiplier: 2.0 });
  assert.equal(a.materialCostCents, b.materialCostCents); // materials unchanged
  assert.equal(a.sundriesCents, b.sundriesCents); // sundries unchanged
  assert.equal(b.productionLabourCents, a.productionLabourCents * 2); // only labour scales
});

test("level of finish is mandatory — no default", () => {
  assert.throws(
    () =>
      priceEstimate({
        production: [{ item: TEST_WALL, quantity: 100, coats: 2 }],
      } as unknown as Parameters<typeof priceEstimate>[0]),
    /Level of finish is mandatory/,
  );
});
