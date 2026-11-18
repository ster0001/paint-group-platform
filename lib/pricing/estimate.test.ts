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
  priceAreaSplit,
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

// Go-live brief §3 (18 Nov 2026): explicit 0 hours = "none", as migration 20270317 writes on every saved estimate;
// the sundries line is left null here, so it reads the job-size scale (§3.1 defaults — the ctx has no site_allowances row).
const adj: Adjustments = { modSel: { "Level of Finish": "FIN-3" }, materials: {}, preparationHours: 0, cleaningHours: 0 };
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

test("sundries are added once per job, per interior/exterior, not per area — from the job-size scale (brief §3)", () => {
  // a small job: both sides sit in the "under 12 h" band — $105 interior, $140 exterior (§3.1)
  const two = [area({ surfaces: [surface()] }), area({ surfaces: [surface()] })];
  assert.equal(priceEstimateTotals(two, ctx, adj).sundriesCents, 10500, "interior sundries once");
  const mixed = [area({ surfaces: [surface()] }), area({ type: "Exterior", surfaces: [] })];
  assert.equal(priceEstimateTotals(mixed, ctx, adj).sundriesCents, 10500 + 14000, "interior + exterior");
  // the retired flat rows are not read any more
  assert.equal(priceEstimateTotals(two, { ...ctx, settings: ctx.settings.filter((s) => !/Sundries/.test(s.key)) }, adj).sundriesCents, 10500);
});

test("the Preparation line: an estimator override replaces the scale's sundries, blank restores it", () => {
  const base = priceEstimateTotals(oneWall, ctx, adj);
  assert.equal(base.sundriesDefaultCents, 10500);
  assert.equal(base.sundriesCents, 10500);
  const over = priceEstimateTotals(oneWall, ctx, { ...adj, preparationOverrideCents: 12345 });
  assert.equal(over.sundriesCents, 12345, "override is the line");
  assert.equal(over.sundriesDefaultCents, 10500, "default still reported for the hint");
  assert.equal(over.subtotalCents - base.subtotalCents, 1845, "subtotal moves by the difference");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationOverrideCents: null }).sundriesCents, 10500, "null = the scale");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationOverrideCents: -5 }).sundriesCents, 0, "never negative");
});

test("options are excluded from the total until accepted", () => {
  const withOption = [...oneWall, area({ isOption: true, surfaces: [surface()] })];
  assert.equal(
    priceEstimateTotals(withOption, ctx, adj).subtotalCents,
    priceEstimateTotals(oneWall, ctx, adj).subtotalCents,
  );
});

test("an optional SUBSTRATE sits outside the total like an optional area (Tom, 16 Sep)", () => {
  // Walls in the estimate, the door offered as an extra: the total is the walls alone.
  const wallsOnly = [area({ surfaces: [surface()] })];
  const wallsAndDoor = [area({ surfaces: [surface(), surface({ code: "DOOR", count: 2 })] })];
  const wallsDoorOptional = [area({ surfaces: [surface(), surface({ code: "DOOR", count: 2, isOption: true })] })];
  const full = priceEstimateTotals(wallsAndDoor, ctx, adj);
  const opt = priceEstimateTotals(wallsDoorOptional, ctx, adj);
  assert.equal(opt.subtotalCents, priceEstimateTotals(wallsOnly, ctx, adj).subtotalCents, "the door is not in the subtotal");
  assert.ok(full.subtotalCents > opt.subtotalCents, "the door was worth something");
  assert.equal(opt.contractorHours, priceEstimateTotals(wallsOnly, ctx, adj).contractorHours, "nor in the hours");
  assert.equal(opt.materialsCostCents, priceEstimateTotals(wallsOnly, ctx, adj).materialsCostCents, "nor in the materials");

  // The area's two figures add up to the whole room.
  const split = priceAreaSplit(wallsDoorOptional[0], ctx, adj);
  assert.equal(split.includedCents, priceAreaSplit(wallsOnly[0], ctx, adj).includedCents);
  assert.ok(split.optionalCents > 0);
  assert.equal(split.includedCents + split.optionalCents, priceAreaSplit(wallsAndDoor[0], ctx, adj).includedCents);
  assert.equal(priceAreaSplit(wallsAndDoor[0], ctx, adj).optionalCents, 0);
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

// ---- walls share (Tom, 31 Aug) ---------------------------------------------
test("sharePct scales derived quantities only — overrides stay absolute", () => {
  const wallsItem = { unit: "M2", sub_category: "Walls", category: "Interior" } as never;
  const room = { areaType: "room", L: 5, W: 4, H: 2.5 } as never;
  const base = { count: 1 } as never;
  const natural = computeQuantity(wallsItem, room, base);
  assert.equal(natural, 2 * (5 + 4) * 2.5);
  assert.equal(computeQuantity(wallsItem, room, { count: 1, sharePct: 50 } as never), natural / 2);
  assert.equal(computeQuantity(wallsItem, room, { count: 1, sharePct: 25 } as never), natural / 4);
  assert.equal(computeQuantity(wallsItem, room, { count: 1, sharePct: 100 } as never), natural);
  // Absolute figures are never scaled.
  assert.equal(computeQuantity(wallsItem, room, { count: 1, sharePct: 50, qtyOverride: 30 } as never), 30);
  assert.equal(computeQuantity(wallsItem, room, { count: 1, sharePct: 50, measureL: 6, measureH: 2 } as never), 12);
});

// ---- condition → the contractor's hours (Tom, 3 Sep 2026) ----------------
//
// "When an estimate is marked as needing extra prep (poor condition) more
// hours need to be added for the contractor." The Condition modifier scales
// PAINTING HOURS, not price — so the contractor's hours, the offer and the
// work-order allowance all carry it. This pins that the painter side moves
// with the customer side; sides.test.ts only ever checked labourCents.

test("a poor-condition job gives the contractor more hours and more pay", () => {
  const job = [area({ surfaces: [surface({ prepHr: 1 })] })];
  const fair = priceEstimateTotals(job, ctx, { ...adj, modSel: { ...adj.modSel, Condition: "COND-FAIR" } });
  const poor = priceEstimateTotals(job, ctx, { ...adj, modSel: { ...adj.modSel, Condition: "COND-POOR" } });
  assert.ok(poor.contractorHours > fair.contractorHours, "the painter gets the extra hours");
  assert.ok(poor.contractorOfferCents > fair.contractorOfferCents, "and is paid for them");
  // Painting hours scale by the multiplier; the typed prep hour does not.
  assert.equal(
    Math.round((poor.contractorHours - 1) * 100) / 100,
    Math.round((fair.contractorHours - 1) * 1.35 * 100) / 100,
  );
  assert.equal(poor.contractorOfferCents, Math.round(poor.contractorHours * 6000 * 1));
});

test("the Preparation line's contractor time (Tom, 17 Sep): hours at the charge-out rate, into the subtotal and the contractor's hours", () => {
  const base = priceEstimateTotals(oneWall, ctx, adj);
  assert.equal(base.preparationHours, 0);
  assert.equal(base.preparationHoursCents, 0);
  const timed = priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: 2.5 });
  const chargeOut = chargeOutCents("Interior", ctx.rateItems, null);
  assert.equal(timed.preparationHours, 2.5);
  assert.equal(timed.preparationHoursCents, Math.round(2.5 * chargeOut), "hours × the interior charge-out rate");
  assert.equal(timed.subtotalCents - base.subtotalCents, timed.preparationHoursCents, "the subtotal moves by exactly the time");
  assert.equal(timed.contractorHours - base.contractorHours, 2.5, "the contractor's hours carry it");
  assert.equal(timed.sundriesCents, base.sundriesCents, "the allowance itself is untouched");
  // The customer's Preparation line is the residual over areas + lines, so
  // the allowance and the time land on the same line.
  const shown = timed.subtotalCents - (timed.subtotalCents - timed.sundriesCents - timed.preparationHoursCents - timed.sizeUpliftCents);
  assert.equal(shown, timed.sundriesCents + timed.preparationHoursCents + timed.sizeUpliftCents);
  // Go-live brief §3: null is the SCALE now — a job under 12 h gets 2 set-up hours; an explicit 0 is none.
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: null }).preparationHours, 2, "null = the scale");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: null }).preparationHoursCents, Math.round(2 * chargeOut), "scale hours at the charge-out rate");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: 0 }).preparationHoursCents, 0, "0 = none");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: -3 }).preparationHoursCents, 0, "never negative");
  assert.equal(priceEstimateTotals(oneWall, ctx, { ...adj, preparationHours: 1, hourlyRateOverride: 120 }).preparationHoursCents, 12000, "follows the $/hr override");
});

// ---- go-live brief §3 — site allowances by job size (18 Nov 2026) ---------------------------

test("golden (brief §5 S1): the audit's 3-bed — 65.55 painting hours, areas $7,257.45 → $8,522.45 ex GST, $9,374.70 inc, 77.55 h, offer $4,653.00", () => {
  // The job as one priced line: $7,257.45 of areas carrying 65.55 crew hours, at a $95 charge-out.
  const job = [{ kind: "line" as const, type: "Interior" as const, mode: "custom" as const, hours: 0, rate: 0, qty: 1, unitPrice: 0, custom: 7257.45, cost: 0, woHours: 65.55 }];
  const noUplift = { ...ctx, settings: [...ctx.settings, { key: "Margin uplift — tier 1 %", value: { value: 0 } }, { key: "Margin uplift — tier 2 %", value: { value: 0 } }] };
  const t = priceEstimateTotals(job, noUplift, { modSel: {}, materials: {}, hourlyRateOverride: 95 });
  assert.deepEqual(t.allowanceDefaults, { ...t.allowanceDefaults, prepHours: 8, cleaningHours: 4, sundriesCents: 24500 });
  assert.equal(t.sundriesCents, 24500, "sundries $245");
  assert.equal(t.preparationHoursCents, 8 * 9500, "8 h × $95");
  assert.equal(t.cleaningHoursCents, 4 * 6500, "4 h × $65 (D9)");
  assert.equal(t.subtotalCents, 852245, "$8,522.45 ex GST");
  assert.equal(t.totalCents, 937470, "$9,374.70 inc GST");
  assert.equal(Math.round(t.contractorHours * 100) / 100, 77.55, "65.55 + 8 + 4 hours");
  assert.equal(t.contractorOfferCents, 465300, "77.55 h × $60");
});

test("allowance hours are identical for a 2-coat and a 3-coat version of the same job, and under any job modifier (brief §5 S1)", () => {
  const two = [area({ L: 6, W: 5, H: 2.7, surfaces: [surface({ coats: 2 }), surface({ code: "DOOR", coats: 2, count: 3 })] })];
  const three = [area({ L: 6, W: 5, H: 2.7, surfaces: [surface({ coats: 3 }), surface({ code: "DOOR", coats: 3, count: 3 })] })];
  const open: Adjustments = { modSel: { "Level of Finish": "FIN-3" }, materials: {} };
  const a = priceEstimateTotals(two, ctx, open), b = priceEstimateTotals(three, ctx, open);
  const c = priceEstimateTotals(two, ctx, { ...open, modSel: { ...open.modSel, Condition: "COND-POOR" } });
  const d = priceEstimateTotals(two, ctx, { ...open, hourLoading: 1.5 });
  assert.ok(b.contractorHours > a.contractorHours && c.contractorHours > a.contractorHours && d.contractorHours > a.contractorHours, "the coats, the modifier and the loading all add painting hours");
  for (const t of [b, c, d]) {
    assert.deepEqual(t.allowanceDefaults, a.allowanceDefaults, "the allowances read the job's size, not its coats or modifier");
    assert.equal(t.preparationHours, a.preparationHours);
    assert.equal(t.cleaningHours, a.cleaningHours);
    assert.equal(t.sundriesCents, a.sundriesCents);
  }
  // and the allowances are added after the chain, never multiplied by it
  assert.equal(c.preparationHoursCents, a.preparationHoursCents);
  assert.equal(c.cleaningHoursCents, a.cleaningHoursCents);
});

test("the estimator's own figures beat the scale; an explicit 0 is none, not the scale (brief §3.3)", () => {
  const scale = priceEstimateTotals(oneWall, ctx, { modSel: {}, materials: {} });
  assert.deepEqual([scale.preparationHours, scale.cleaningHours, scale.sundriesCents], [2, 1.5, 10500]);
  const none = priceEstimateTotals(oneWall, ctx, { modSel: {}, materials: {}, preparationHours: 0, cleaningHours: 0, preparationOverrideCents: 0 });
  assert.deepEqual([none.preparationHours, none.cleaningHours, none.sundriesCents, none.preparationHoursCents, none.cleaningHoursCents], [0, 0, 0, 0, 0]);
  const own = priceEstimateTotals(oneWall, ctx, { modSel: {}, materials: {}, cleaningHours: 3 });
  assert.equal(own.cleaningHoursCents, 3 * 6500);
  assert.equal(Math.round((own.contractorHours - none.contractorHours) * 100) / 100, 2 + 3, "the scale's 2 h set-up and the typed 3 h cleaning ride the painter's hours");
  // the cleaning rate is the scale's, Settings-editable
  const dearer = { ...ctx, settings: [...ctx.settings, { key: "site_allowances", value: { cleaningRateCents: 8000 } }] };
  assert.equal(priceEstimateTotals(oneWall, dearer, { modSel: {}, materials: {}, cleaningHours: 1 }).cleaningHoursCents, 8000);
});
