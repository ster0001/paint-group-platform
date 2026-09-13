import { test } from "vitest";
import assert from "node:assert/strict";
import { coatMultiplier, hoursPerUnit } from "./engine.ts";
import type { RateItem } from "./types.ts";

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

test("coatMultiplier follows the marginal-coat rule", () => {
  approx(coatMultiplier(1), 1);
  approx(coatMultiplier(2), 1.75);
  approx(coatMultiplier(3), 2.5);
  approx(coatMultiplier(4), 3.25);
});

test("hoursPerUnit uses the rate-card column for coats 1–3 (area units are quantity per hour)", () => {
  approx(hoursPerUnit(WALLS, 1) * 40, 40 / 18.01, 1e-6);
  approx(hoursPerUnit(WALLS, 2) * 40, 40 / 10.29, 1e-6);
  approx(hoursPerUnit(WALLS, 3) * 40, 40 / 7.2, 1e-6);
});

test("hoursPerUnit derives coats 4+ with the same rule", () => {
  // 4 coats: one-coat time × 3.25
  approx(hoursPerUnit(WALLS, 4) * 40, (40 / 18.01) * 3.25, 1e-6);
});

test("hoursPerUnit handles item-based units (the rate IS hours per item)", () => {
  approx(hoursPerUnit(DOOR, 2) * 3, 3 * 1.07, 1e-9); // 3 doors, 2 coats
});
