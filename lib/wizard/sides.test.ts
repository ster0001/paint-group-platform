/**
 * Parity STOP-item 1 — the priced catalogue/sweep/allowance wiring.
 *
 * The live card rows for these items (migrations 20260921–22) carry a
 * "Lineal Metres" unit and PER-ITEM charge-outs (price ÷ hours). Both are
 * traps for the engine: a counted line with no measures reads the side's
 * length (or $0 on the measureless extras block), and the category
 * charge-out lookup could adopt a per-item rate. These tests mirror the
 * live rows exactly and pin Tom's ruled prices — Shutters $280, Side gate
 * $300, Security door $345, Meter box $65, Shed $640, rot $180, access
 * $260 — through the REAL pricing engine.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  chargeOutCents, priceSurface, resolveRates,
  type Adjustments, type AreaInput, type PricingContext, type SurfaceInput,
} from "../pricing/estimate.ts";
import type { RateItem } from "../pricing/types.ts";
import {
  ALLOWANCE_CODES, addCatalogItem, extrasPrices, findSide,
  hasExtrasItem, rateFor, toggleExtrasItem, type LooseBlock,
} from "./sides.ts";

// ---- live-card mirrors ------------------------------------------------------

// Per-item rows: unit 'Hours Per Item' since migration 20260923 (20260921
// wrongly copied 'Lineal Metres' from Fascias — the engine reads a lineal
// rate as metres PER HOUR, pricing "5 hours" as 1/5 h).
const extRow = (code: string, hours: number, chargeOut: number): RateItem => ({
  category: "Exterior", code, unit: "Hours Per Item", sub_category: "Extras",
  rate_1_coat: hours, rate_2_coat: hours, rate_3_coat: hours, rate_4_coat: null,
  charge_out_cents: chargeOut, default_product: "Dulux Weathershield",
  metres_per_litre: 76, litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem);

const wallsRow = {
  category: "Exterior", code: "Weatherboards", unit: "M2", sub_category: "Walls",
  rate_1_coat: 8, rate_2_coat: 5, rate_3_coat: 4, rate_4_coat: null,
  charge_out_cents: 10000, default_product: "Dulux Weathershield",
  metres_per_litre: null, litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

// The exact rows 20260922 left on the live card (verified 20 Aug 2026).
const CARD: RateItem[] = [
  wallsRow,
  extRow("Window Shutters", 3.0, 9333),
  extRow("Side Gate", 3.0, 10000),
  extRow("Security Door", 3.5, 9857),
  extRow("Meter Box", 0.5, 13000),
  extRow("Shed", 5.0, 12800),
  { ...extRow("Minor Fascia Rot Allowance", 1.8, 10000), sub_category: "Allowances" } as RateItem,
  { ...extRow("Access Allowance", 2.6, 10000), sub_category: "Allowances" } as RateItem,
];

const ctx: PricingContext = {
  rateItems: CARD,
  products: [],
  modifiers: [{ code: "EXT-WEATHERED", group_name: "condition", multiplier: 1.8 }],
  settings: [],
};
const adj: Adjustments = { modSel: {}, materials: {} };
const rates = resolveRates(ctx, adj);

const sideBlock = (): LooseBlock => ({
  id: 1, kind: "area", name: "Exterior - Front", type: "Exterior", areaType: "surface",
  L: 12, H: 2.6, surfaces: [{ id: 2, code: "Weatherboards", sharePct: 100 }],
  customer: { include: true, size: "yes", confirmed: false },
});

// ---- rateFor / extrasPrices -------------------------------------------------

test("rateFor lands Tom's ruled prices exactly from the live-mirror rows", () => {
  const expected: Record<string, number> = {
    "Window Shutters": 27999, "Side Gate": 30000, "Security Door": 34500,
    "Meter Box": 6500, "Shed": 64000,
    [ALLOWANCE_CODES.rot.code]: 18000, [ALLOWANCE_CODES.access.code]: 26000,
  };
  for (const [code, cents] of Object.entries(expected)) {
    assert.equal(rateFor(CARD, code)?.priceCents, cents, code);
  }
  assert.equal(rateFor(CARD, "Carport"), null, "Carport left the card — never priced");
});

test("extrasPrices offers only codes the live card can price", () => {
  const prices = extrasPrices(CARD.filter((r) => r.code !== "Meter Box"));
  assert.equal(prices["Meter Box"], undefined, "an unpriceable code is offered nowhere");
  assert.equal(prices["Shed"], 64000);
  assert.equal(prices[ALLOWANCE_CODES.rot.code], undefined, "allowances aren't chips");
});

// ---- the lineal-unit trap ---------------------------------------------------

test("a catalogue line prices per ITEM through the real engine, not per side-metre", () => {
  let blocks: LooseBlock[] = [sideBlock()];
  const r = rateFor(CARD, "Security Door")!;
  let next = 10;
  const added = addCatalogItem(blocks, "front", "Security Door", () => next++, r.chargeOutDollars);
  assert.ok(added.ok);
  blocks = added.blocks;
  const line = (findSide(blocks, "front")!.surfaces ?? []).find((s) => s.code === "Security Door")!;
  const priced = priceSurface(
    findSide(blocks, "front") as unknown as AreaInput,
    line as unknown as SurfaceInput, ctx, adj, rates,
  );
  // Without qtyOverride the lineal unit would read the side's 12 m; without
  // customRate it would price at the walls' $100/h. Both must not happen.
  assert.equal(priced.qty, 1);
  assert.equal(priced.labourCents, 34500, "3.5 h × the item's own $98.57 charge-out = $345");
});

test("adding the same catalogue item twice refuses — the stepper owns the count", () => {
  let blocks: LooseBlock[] = [sideBlock()];
  let next = 10;
  const r = rateFor(CARD, "Meter Box")!;
  blocks = (addCatalogItem(blocks, "front", "Meter Box", () => next++, r.chargeOutDollars) as { ok: true; blocks: LooseBlock[] }).blocks;
  const again = addCatalogItem(blocks, "front", "Meter Box", () => next++, r.chargeOutDollars);
  assert.equal(again.ok, false);
});

// ---- the extras block (sweep items + allowances) -----------------------------

test("allowances price flat on the measureless extras block, and toggle both ways", () => {
  let blocks: LooseBlock[] = [sideBlock()];
  let next = 20;
  const r = rateFor(CARD, ALLOWANCE_CODES.rot.code)!;
  const on = toggleExtrasItem(blocks, ALLOWANCE_CODES.rot.code, ALLOWANCE_CODES.rot.label, true, () => next++, r.chargeOutDollars);
  assert.ok(on.ok);
  blocks = on.blocks;
  assert.ok(hasExtrasItem(blocks, ALLOWANCE_CODES.rot.code));
  const extras = blocks.find((b) => /Exterior - Extras/.test(String(b.name)))!;
  const line = (extras.surfaces ?? [])[0];
  const priced = priceSurface(extras as unknown as AreaInput, line as unknown as SurfaceInput, ctx, adj, rates);
  assert.equal(priced.labourCents, 18000, "$180 flat despite the block's 0 × 0 dims");

  // Idempotent on; clean off.
  const onAgain = toggleExtrasItem(blocks, ALLOWANCE_CODES.rot.code, ALLOWANCE_CODES.rot.label, true, () => next++, r.chargeOutDollars);
  assert.ok(onAgain.ok && onAgain.blocks === blocks, "already on — untouched");
  const off = toggleExtrasItem(blocks, ALLOWANCE_CODES.rot.code, ALLOWANCE_CODES.rot.label, false, () => next++, r.chargeOutDollars);
  assert.ok(off.ok);
  assert.equal(hasExtrasItem(off.blocks, ALLOWANCE_CODES.rot.code), false);
});

test("the weathered modifier scales wall labour ×1.8 through modSel.Condition", () => {
  const weathered: Adjustments = { modSel: { Condition: "EXT-WEATHERED" }, materials: {} };
  const b = sideBlock();
  const wall = { code: "Weatherboards", coats: 2, count: 0, prepHr: 0 } as SurfaceInput;
  const plain = priceSurface(b as unknown as AreaInput, wall, ctx, adj, rates);
  const rough = priceSurface(b as unknown as AreaInput, wall, ctx, weathered, resolveRates(ctx, weathered));
  assert.ok(plain.labourCents > 0);
  assert.equal(rough.labourCents, Math.round(plain.paintingHr * 1.8 * 10000));
});

// ---- the charge-out lookup hardening -----------------------------------------

test("Extras/Allowances rows never define the category charge-out, in any row order", () => {
  const reversed = [...CARD].reverse(); // Shed's $128/h row first
  assert.equal(chargeOutCents("Exterior", reversed, null), 10000, "the walls row wins");
  assert.equal(chargeOutCents("Exterior", CARD, null), 10000);
});
