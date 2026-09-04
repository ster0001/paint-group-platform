import { test, expect } from "vitest";
import { invoicedExGst, materialsBudget, materialsBudgetCents } from "./materialsBudget";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { Product, RateItem } from "@/lib/pricing/types";

// The PC Materials budget (Tom, 4 Sep): budget = the estimate's engine
// materials cost; actual = matched material invoices, GST backed out.

const wallItem = {
  category: "Interior", code: "WALL", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: "Std Wall", metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

const ctx: PricingContext = {
  rateItems: [wallItem],
  products: [{ name: "Std Wall", coverage: 14, price_per_litre: 2000, wastage_pct: 0 }] as unknown as Product[],
  modifiers: [],
  settings: [{ key: "Materials markup", value: { value: 0.1 } }, { key: "GST", value: { value: 0.1 } }],
};

// One 4 × 3 × 2.4 room, walls only: the same fixture shape the builder saves.
const state = {
  blocks: [{
    kind: "area", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false,
    surfaces: [{ code: "WALL", coats: 2, count: 0, prepHr: 0, productName: null, qtyOverride: 28 }],
  }],
  modSel: {}, materials: {},
};

test("budget is the engine's materials cost on the estimate's scope", () => {
  // 28 m² × 2 coats ÷ 14 m²/L = 4 L × $20/L = $80.00
  expect(materialsBudgetCents(state, ctx)).toBe(8000);
});

test("no scope or no rate card → no budget figure (never a fabricated zero)", () => {
  expect(materialsBudgetCents(null, ctx)).toBeNull();
  expect(materialsBudgetCents({ blocks: [] }, ctx)).toBeNull();
  expect(materialsBudgetCents(state, { ...ctx, rateItems: [] })).toBeNull();
});

test("invoiced total backs GST out; the bar caps at 100 and 'over' is honest", () => {
  expect(invoicedExGst(11000)).toBe(10000);
  const b = materialsBudget(8000, [{ amount_cents: 4400 }, { amount_cents: 2200 }]);
  expect(b).toMatchObject({ invoicedIncCents: 6600, invoicedExCents: 6000, pct: 75, over: false });
  const over = materialsBudget(8000, [{ amount_cents: 11000 }]);
  expect(over).toMatchObject({ invoicedExCents: 10000, pct: 100, over: true });
  const none = materialsBudget(null, [{ amount_cents: 1100 }]);
  expect(none).toMatchObject({ budgetCents: null, pct: null, over: false, invoicedExCents: 1000 });
});
