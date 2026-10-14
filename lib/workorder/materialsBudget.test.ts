import { test, expect } from "vitest";
import { invoicedExGst, materialRowEstimates, materialsBudget, materialsBudgetCents } from "./materialsBudget";
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

// Tom, 13 Oct 2026: the estimate's litres and cost beside each job-sheet row.
test("row estimates sum each sheet surface's engine litres and cost into its product × colour row", () => {
  const withIds = {
    ...state,
    blocks: [
      { ...state.blocks[0], id: "a1", surfaces: [{ ...state.blocks[0].surfaces[0], id: "s1" }, { ...state.blocks[0].surfaces[0], id: "s2", qtyOverride: 14 }] },
      { kind: "line", type: "Interior", mode: "custom", hours: 0, rate: 0, qty: 0, unitPrice: 0, custom: 0, cost: 0, woHours: 0,
        materials: [{ productName: "Std Wall", litres: 1.5, colourName: "Domino" }] },
    ],
  };
  const doc = {
    materials: [
      { product: "Std Wall", colourKey: "Std Wall||Lexicon", photoUrl: "", litres: 6, coverageMissing: false, colourName: "Lexicon", colourHex: "", colourStatus: "tbc" as const },
      { product: "Std Wall", colourKey: "Std Wall||Domino", photoUrl: "", litres: 1, coverageMissing: false, colourName: "Domino", colourHex: "", colourStatus: "tbc" as const },
    ],
    areas: [{
      id: "a1", title: "Lounge", photos: [], finishCode: null, finishOverridden: false,
      surfaces: [
        { key: "a1:s1", label: "Walls", coats: 2, product: "Std Wall", colourKey: "Std Wall||Lexicon", prep: "", hours: 1, status: "not_started" as const },
        { key: "a1:s2", label: "Feature", coats: 2, product: "Std Wall", colourKey: "Std Wall||Lexicon", prep: "", hours: 1, status: "not_started" as const },
      ],
    }],
  };
  const est = materialRowEstimates(doc, withIds, ctx)!;
  // 28 m² + 14 m² × 2 coats ÷ 14 = 6 L × $20 = $120
  expect(est.get("Std Wall||Lexicon")).toEqual({ litres: 6, costCents: 12000 });
  // the line's 1.5 L of Domino × $20 = $30
  expect(est.get("Std Wall||Domino")).toEqual({ litres: 1.5, costCents: 3000 });
  expect(materialRowEstimates(doc, withIds, { ...ctx, rateItems: [] })).toBeNull();
});
