/**
 * Unit tests for the estimate pricing functions.
 *
 * These pin the edge cases the golden fixtures don't happen to contain. They
 * document CURRENT behaviour — where something is arguably wrong, the test says
 * so rather than asserting what we wish it did. Changing one of these is a
 * deliberate pricing decision, not a refactor.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  priceSurface,
  priceLine,
  priceEstimateTotals,
  resolveRates,
  jobModifier,
  chargeOutCents,
  computeQuantity,
  depositCents,
  productNameFor,
  itemIndex,
  type PricingContext,
  type Adjustments,
  type AreaInput,
  type SurfaceInput,
} from "./estimate.ts";
import type { RateItem, Product } from "./types.ts";

// ---- minimal fixtures -----------------------------------------------------

const wallItem = {
  category: "Interior", code: "WALL", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: "Std Wall", metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

const doorItem = {
  category: "Interior", code: "DOOR", unit: "Hours Per Item", sub_category: "Doors",
  rate_1_coat: 0.5, rate_2_coat: 0.8, rate_3_coat: 1.0, rate_4_coat: null,
  charge_out_cents: 8500, default_product: "Std Enamel", metres_per_litre: null,
  litres_per_item_per_coat: 0.2, default_coats: 2,
} as unknown as RateItem;

const products = [
  { name: "Std Wall", coverage: 14, price_per_litre: 2000, wastage_pct: 10 },
  { name: "Std Enamel", coverage: 12, price_per_litre: 4000, wastage_pct: 0 },
] as unknown as Product[];

const ctx: PricingContext = {
  rateItems: [wallItem, doorItem],
  products,
  modifiers: [
    { code: "FIN-3", group_name: "Level of Finish", multiplier: 1 },
    { code: "FIN-4", group_name: "Level of Finish", multiplier: 1.06 },
    { code: "COND-POOR", group_name: "Condition", multiplier: 1.35 },
  ],
  settings: [
    { key: "Materials markup", value: { value: 0.1 } },
    { key: "GST", value: { value: 0.1 } },
    { key: "Sundries per job — interior", value: { value: 50 } },
    { key: "Sundries per job — exterior", value: { value: 80 } },
    { key: "Contractor rate", value: { value: 60 } },
    { key: "Contractor offer — % of estimated hours", value: { value: 1 } },
  ],
};

const adj: Adjustments = { modSel: { "Level of Finish": "FIN-3" }, materials: {} };
const rates = resolveRates(ctx, adj);

const area = (over: Partial<AreaInput> = {}): AreaInput => ({
  kind: "area", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, surfaces: [], ...over,
});
const surface = (over: Partial<SurfaceInput> = {}): SurfaceInput => ({
  code: "WALL", coats: 2, count: 0, prepHr: 0, ...over,
});

// ---- zero quantity --------------------------------------------------------

test("a zero-dimension area prices to zero, not NaN", () => {
  const r = priceSurface(area({ L: 0, W: 0, H: 0 }), surface(), ctx, adj, rates);
  assert.equal(r.qty, 0);
  assert.equal(r.totalCents, 0);
  assert.ok(Number.isInteger(r.totalCents));
});

test("an item surface with no count prices to zero", () => {
  const r = priceSurface(area(), surface({ code: "DOOR", count: 0 }), ctx, adj, rates);
  assert.equal(r.qty, 0);
  assert.equal(r.totalCents, 0);
});

test("an unknown substrate code still charges prep hours and nothing else", () => {
  const r = priceSurface(area(), surface({ code: "NOPE", prepHr: 2 }), ctx, adj, rates);
  assert.equal(r.qty, 0);
  assert.equal(r.matPriceCents, 0);
  assert.equal(r.totalCents, Math.round(2 * 8500), "2 hours at the interior charge-out rate");
});

// ---- per-area product pinning --------------------------------------------

test("a pinned product overrides the global material choice", () => {
  const items = itemIndex(ctx.rateItems);
  const globals = { "Interior::WALL": "Std Wall" };
  assert.equal(productNameFor("Interior", surface(), globals, items), "Std Wall", "follows the global");
  assert.equal(
    productNameFor("Interior", surface({ productName: "Std Enamel" }), globals, items),
    "Std Enamel",
    "pin wins over the global",
  );
});

test("with no pin and no global, the rate card's default product is used", () => {
  const items = itemIndex(ctx.rateItems);
  assert.equal(productNameFor("Interior", surface(), {}, items), "Std Wall");
});

test("pinning a dearer product raises only the materials price, not labour", () => {
  const a = area();
  const cheap = priceSurface(a, surface(), ctx, adj, rates);
  const dear = priceSurface(a, surface({ productName: "Std Enamel" }), ctx, adj, rates);
  assert.equal(dear.labourCents, cheap.labourCents, "labour is untouched by product choice");
  assert.ok(dear.matPriceCents > cheap.matPriceCents);
});

// ---- overrides ------------------------------------------------------------

test("a manual price override sets the total and labour absorbs the difference", () => {
  const r = priceSurface(area(), surface({ priceOverride: 500 }), ctx, adj, rates);
  assert.equal(r.totalCents, 50000);
  assert.equal(
    r.labourCents + r.matPriceCents,
    50000,
    "materials cost stays honest so margin isn't distorted",
  );
});

test("modifiers scale labour but never materials", () => {
  const plain = priceSurface(area(), surface(), ctx, adj, rates);
  const rough: Adjustments = { modSel: { "Level of Finish": "FIN-3", Condition: "COND-POOR" }, materials: {} };
  const harder = priceSurface(area(), surface(), ctx, rough, resolveRates(ctx, rough), undefined, undefined, jobModifier(ctx.modifiers, rough.modSel));
  assert.ok(harder.labourCents > plain.labourCents, "poor condition costs more labour");
  assert.equal(harder.matPriceCents, plain.matPriceCents, "materials are unchanged");
});

// ---- line items -----------------------------------------------------------

test("hourly lines carry no cost — labour is paid via the contractor offer", () => {
  const r = priceLine({ kind: "line", type: "Interior", mode: "hourly", hours: 3, rate: 85, qty: 0, unitPrice: 0, custom: 0, cost: 40, woHours: 0 });
  assert.equal(r.priceCents, 25500);
  assert.equal(r.costCents, 0, "the cost field is deliberately ignored for hourly lines");
  assert.equal(r.hours, 3);
});

test("quantity and custom lines keep their cost — this is the pass-through path", () => {
  const q = priceLine({ kind: "line", type: "Interior", mode: "quantity", hours: 0, rate: 0, qty: 4, unitPrice: 25.5, custom: 0, cost: 60, woHours: 1 });
  assert.equal(q.priceCents, 10200);
  assert.equal(q.costCents, 6000, "pass-through cost is recorded and nets out of margin");
  const c = priceLine({ kind: "line", type: "Interior", mode: "custom", hours: 0, rate: 0, qty: 0, unitPrice: 0, custom: 199.99, cost: 100, woHours: 2 });
  assert.equal(c.priceCents, 19999);
  assert.equal(c.costCents, 10000);
});

// ---- totals ---------------------------------------------------------------

const oneWall = [area({ surfaces: [surface()] })];

test("a 3rd-party line sits outside the gross margin on both sides", () => {
  const line = { kind: "line" as const, type: "Interior" as const, mode: "custom" as const, hours: 0, rate: 0, qty: 0, unitPrice: 0, custom: 2500, cost: 2000, woHours: 0 };
  const base = priceEstimateTotals(oneWall, ctx, adj);
  const asMaterials = priceEstimateTotals([...oneWall, line], ctx, adj);
  const asThirdParty = priceEstimateTotals([...oneWall, { ...line, subcontractorExpense: true }], ctx, adj);

  // The customer is charged the same either way.
  assert.equal(asThirdParty.subtotalCents, asMaterials.subtotalCents);
  // Flagged: the cost leaves the gross-margin costs and is reported separately…
  assert.equal(asThirdParty.materialsCostCents, base.materialsCostCents);
  assert.equal(asThirdParty.thirdPartyCostCents, 200000);
  assert.equal(asThirdParty.thirdPartyPriceCents, 250000);
  // …and the margin is the margin on OUR work alone (charge netted out too).
  assert.equal(asThirdParty.marginCents, base.marginCents);
  // Unflagged lines keep the old behaviour and report no 3rd-party figures.
  assert.equal(asMaterials.thirdPartyCostCents, 0);
  assert.equal(asMaterials.marginCents, base.marginCents + 250000 - 200000);
});

test("GST rounds half away from zero (JavaScript Math.round), not banker's rounding", () => {
  // 0.5 cents must round UP, which banker's rounding would send to the even number.
  assert.equal(Math.round(2.5), 3);
  const t = priceEstimateTotals(oneWall, ctx, adj);
  assert.equal(t.gstCents, Math.round(t.netSubtotalCents * 0.1));
  assert.equal(t.totalCents, t.netSubtotalCents + t.gstCents);
  assert.ok(Number.isInteger(t.gstCents));
});

test("sundries are added once per job, per interior/exterior, not per area", () => {
  const two = [area({ surfaces: [surface()] }), area({ surfaces: [surface()] })];
  assert.equal(priceEstimateTotals(two, ctx, adj).sundriesCents, 5000, "interior sundries once");
  const mixed = [area({ surfaces: [surface()] }), area({ type: "Exterior", surfaces: [] })];
  assert.equal(priceEstimateTotals(mixed, ctx, adj).sundriesCents, 13000, "interior + exterior");
});

test("options are excluded from the total until accepted", () => {
  const withOption = [...oneWall, area({ isOption: true, surfaces: [surface()] })];
  assert.equal(
    priceEstimateTotals(withOption, ctx, adj).subtotalCents,
    priceEstimateTotals(oneWall, ctx, adj).subtotalCents,
  );
});

test("hidden surfaces ARE priced — hidden only affects what the customer sees", () => {
  const hidden = [area({ surfaces: [surface({ hidden: true })] })];
  assert.equal(
    priceEstimateTotals(hidden, ctx, adj).subtotalCents,
    priceEstimateTotals(oneWall, ctx, adj).subtotalCents,
  );
});

test("a fixed discount is capped at the subtotal and can never go negative", () => {
  const huge: Adjustments = { ...adj, discountMode: "fixed", discountFixedCents: 99_999_999 };
  const t = priceEstimateTotals(oneWall, ctx, huge);
  assert.equal(t.netSubtotalCents, 0);
  assert.equal(t.gstCents, 0);
  assert.equal(t.totalCents, 0);
});

test("a percentage discount comes off the ex-GST subtotal", () => {
  const ten: Adjustments = { ...adj, discountMode: "pct", discountPct: 10 };
  const base = priceEstimateTotals(oneWall, ctx, adj);
  const cut = priceEstimateTotals(oneWall, ctx, ten);
  assert.equal(cut.discountCents, Math.round(base.subtotalCents * 0.1));
  assert.equal(cut.netSubtotalCents, base.subtotalCents - cut.discountCents);
});

test("the contractor offer follows ALL hours, prep included", () => {
  const withPrep = [area({ surfaces: [surface({ prepHr: 2 })] })];
  const t = priceEstimateTotals(withPrep, ctx, adj);
  assert.equal(t.contractorOfferCents, Math.round(t.contractorHours * 6000 * 1));
  assert.ok(t.contractorHours >= 2, "prep hours are included in the offer");
});

// ---- the offer percentage itself (A4-01) ----------------------------------
//
// The test above multiplies by a literal 1, which is also the `?? 1` fallback
// resolveRates uses when the setting is absent. So it asserts the default path
// against itself: deleting `* rates.offerPct` from estimate.ts left all 22
// tests in this file green (audit 2026-08-28, mutation 3). These pin the
// factor itself — the number every contractor is paid.

/** The shared ctx with one setting changed, so the offer % is not its default. */
const ctxWithOffer = (pct: number | null): PricingContext => ({
  ...ctx,
  settings: [
    ...ctx.settings.filter((s) => s.key !== "Contractor offer — % of estimated hours"),
    ...(pct === null ? [] : [{ key: "Contractor offer — % of estimated hours", value: { value: pct } }]),
  ],
});

test("the offer percentage scales the contractor's pay", () => {
  const job = [area({ surfaces: [surface({ prepHr: 2 })] })];
  const full = priceEstimateTotals(job, ctxWithOffer(1), adj);
  const part = priceEstimateTotals(job, ctxWithOffer(0.55), adj);

  // Same work, same hours — only the percentage differs.
  assert.equal(part.contractorHours, full.contractorHours);
  assert.equal(part.contractorOfferCents, Math.round(part.contractorHours * 6000 * 0.55));
  // And it is genuinely a different number, so the assertion above can fail.
  assert.ok(part.contractorOfferCents < full.contractorOfferCents,
    "55% must pay less than 100% — if these are equal the factor is not applied");
});

test("a missing offer setting falls back to 100%, and that is not the same as configuring it", () => {
  const job = [area({ surfaces: [surface({ prepHr: 2 })] })];
  const absent = priceEstimateTotals(job, ctxWithOffer(null), adj);
  const explicit = priceEstimateTotals(job, ctxWithOffer(1), adj);
  const reduced = priceEstimateTotals(job, ctxWithOffer(0.8), adj);

  assert.equal(absent.contractorOfferCents, explicit.contractorOfferCents,
    "no setting means 100% — the ?? 1 fallback");
  assert.notEqual(absent.contractorOfferCents, reduced.contractorOfferCents,
    "the fallback must be distinguishable from a configured percentage");
});

test("the offer percentage moves margin but never the customer's price", () => {
  const job = [area({ surfaces: [surface({ prepHr: 2 })] })];
  const full = priceEstimateTotals(job, ctxWithOffer(1), adj);
  const part = priceEstimateTotals(job, ctxWithOffer(0.55), adj);

  // What we charge is untouched — the offer is what we PAY.
  assert.equal(part.totalCents, full.totalCents);
  assert.equal(part.subtotalCents, full.subtotalCents);
  // Paying the contractor less leaves more margin, to the cent.
  assert.equal(part.marginCents - full.marginCents,
    full.contractorOfferCents - part.contractorOfferCents);
});

test("margin is net subtotal less contractor pay and materials COST, not materials price", () => {
  const t = priceEstimateTotals(oneWall, ctx, adj);
  assert.equal(t.marginCents, t.netSubtotalCents - t.contractorOfferCents - t.materialsCostCents);
});

// ---- small helpers --------------------------------------------------------

test("charge-out falls back per category, and an override wins", () => {
  assert.equal(chargeOutCents("Interior", ctx.rateItems, null), 8500);
  assert.equal(chargeOutCents("Exterior", [], null), 10000, "exterior default with no rate items");
  assert.equal(chargeOutCents("Interior", ctx.rateItems, 120), 12000, "override, in cents");
});

test("room quantities: walls use the perimeter, flat surfaces use L×W", () => {
  const a = area({ L: 4, W: 3, H: 2.4 });
  assert.equal(computeQuantity(wallItem, a, surface()), 2 * (4 + 3) * 2.4);
  const ceiling = { ...wallItem, sub_category: "Ceilings" } as RateItem;
  assert.equal(computeQuantity(ceiling, a, surface()), 12);
});

test("a per-surface measurement overrides the area's dimensions", () => {
  const a = area({ L: 4, W: 3, H: 2.4 });
  assert.equal(computeQuantity(wallItem, a, surface({ measureL: 10, measureH: 2 })), 20);
});

test("deposit is a rounded percentage of the GST-inclusive total", () => {
  assert.equal(depositCents(323485, 50), 161743, "half of $3,234.85 rounds to $1,617.43");
  assert.equal(depositCents(1, 50), 1, "rounds half away from zero");
});
