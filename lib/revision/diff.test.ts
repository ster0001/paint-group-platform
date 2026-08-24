/**
 * The revision diff: each change priced through the real engine, in a chain,
 * so Σ deltas = working total − accepted total to the cent — the invariant
 * the addendum's A4 gate reconciles the ledger against.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { PricingContext } from "../pricing/estimate";
import type { RateItem, Product } from "../pricing/types";
import { priceEstimateTotals } from "../pricing/estimate";
import type { Adjustments } from "../pricing/estimate";
import { diffRevision, sumDeltas, deltaExCents, type RevisionState } from "./diff";

// ---- the same minimal fixture shape lib/pricing/estimate.test.ts uses ------

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
  modifiers: [{ code: "FIN-3", group_name: "Level of Finish", multiplier: 1 }],
  settings: [
    { key: "Materials markup", value: { value: 0.1 } },
    { key: "GST", value: { value: 0.1 } },
    { key: "Sundries per job — interior", value: { value: 50 } },
    { key: "Contractor rate", value: { value: 60 } },
    { key: "Contractor offer — % of estimated hours", value: { value: 1 } },
  ],
};

const wall = (id: number) => ({ id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls" });
const door = (id: number) => ({ id, code: "DOOR", coats: 2, count: 2, prepHr: 0, internalLabel: "Door" });

const lounge = { kind: "area", id: 1, name: "Lounge", type: "Interior", areaType: "room", L: 5, W: 4, H: 2.4, surfaces: [wall(11), door(12)] };
const pergola = { kind: "area", id: 2, name: "Pergola", type: "Interior", areaType: "room", L: 3, W: 3, H: 2.4, surfaces: [wall(21)] };
const garage = { kind: "area", id: 3, name: "Garage", type: "Interior", areaType: "room", L: 6, W: 6, H: 2.7, surfaces: [wall(31)] };

const state = (blocks: unknown[], extra: Record<string, unknown> = {}): RevisionState =>
  ({ blocks, modSel: { "Level of Finish": "FIN-3" }, ...extra });

const totalOf = (s: RevisionState) =>
  priceEstimateTotals(
    (s.blocks as never[]) ?? [],
    ctx,
    { modSel: { "Level of Finish": "FIN-3" }, materials: {} } as Adjustments,
  ).totalCents;

test("no changes → no variations", () => {
  const a = state([lounge, pergola]);
  const d = diffRevision(a, state([lounge, pergola]), ctx);
  assert.equal(d.changes.length, 0);
  assert.equal(d.acceptedIncCents, d.workingIncCents);
});

test("remove the pergola → one CREDIT carrying its surfaces' strike keys", () => {
  const d = diffRevision(state([lounge, pergola]), state([lounge]), ctx);
  assert.equal(d.changes.length, 1);
  const c = d.changes[0];
  assert.equal(c.kind, "removed");
  assert.equal(c.credit, true);
  assert.ok(c.deltaIncCents < 0);
  assert.equal(c.priceIncCents, -c.deltaIncCents);
  assert.deepEqual(c.surfaceKeys, ["2:21"]);
  assert.ok(c.hours > 0);
});

test("add the garage → one addition with engine hours", () => {
  const d = diffRevision(state([lounge]), state([lounge, garage]), ctx);
  assert.equal(d.changes.length, 1);
  const c = d.changes[0];
  assert.equal(c.kind, "added");
  assert.equal(c.credit, false);
  assert.ok(c.deltaIncCents > 0);
  assert.ok(c.hours > 0);
  assert.equal(c.surfaceKeys.length, 0);
});

test("one add + one remove + one change: Σ deltas = working − accepted, to the cent", () => {
  const loungeMoreCoats = {
    ...lounge,
    surfaces: [{ ...wall(11), coats: 3 }, door(12)],
  };
  const a = state([lounge, pergola]);
  const w = state([loungeMoreCoats, garage]);
  const d = diffRevision(a, w, ctx);
  assert.equal(d.changes.length, 3);
  assert.equal(sumDeltas(d), d.workingIncCents - d.acceptedIncCents);
  assert.equal(d.acceptedIncCents, totalOf(a));
  assert.equal(d.workingIncCents, totalOf(w));
  // The changed lounge is not a credit here (an extra coat costs more).
  const changed = d.changes.find((c) => c.kind === "changed");
  assert.ok(changed && !changed.credit && changed.detail.includes("changed Walls"));
  // The removal carries the pergola's key; the change removes nothing.
  const removed = d.changes.find((c) => c.kind === "removed");
  assert.deepEqual(removed?.surfaceKeys, ["2:21"]);
});

test("removing one surface from an area strikes just that surface", () => {
  const loungeNoDoor = { ...lounge, surfaces: [wall(11)] };
  const d = diffRevision(state([lounge]), state([loungeNoDoor]), ctx);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].kind, "changed");
  assert.equal(d.changes[0].credit, true);
  assert.deepEqual(d.changes[0].surfaceKeys, ["1:12"]);
});

test("a discount change is its own 'adjustments' line, and the chain still sums", () => {
  const a = state([lounge]);
  const w = state([lounge, garage], { discountPct: 5 });
  const d = diffRevision(a, w, ctx);
  assert.equal(d.changes.length, 2);
  assert.equal(d.changes[1].blockRef, "adjustments");
  assert.equal(d.changes[1].credit, true);
  assert.equal(sumDeltas(d), d.workingIncCents - d.acceptedIncCents);
});

test("cosmetic edits (labels only) draft nothing", () => {
  const renamed = { ...lounge, name: "Front lounge" };
  const d = diffRevision(state([lounge]), state([renamed]), ctx);
  assert.equal(d.changes.length, 0);
});

test("deltaExCents backs GST out of a signed delta, both signs", () => {
  assert.equal(deltaExCents(88_300), 80_273);
  assert.equal(deltaExCents(-88_300), -80_273);
});
