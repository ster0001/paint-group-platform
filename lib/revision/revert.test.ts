/**
 * Undo one change (Tom, 12 Oct 2026): reverting a diff row puts that section
 * back to the accepted scope, the row leaves the diff, and every OTHER change
 * stays exactly as it was.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { PricingContext } from "../pricing/estimate";
import type { RateItem, Product } from "../pricing/types";
import { diffRevision, type RevisionState } from "./diff";
import { revertChange } from "./revert";

const wallItem = {
  category: "Interior", code: "WALL", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: "Std Wall", metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2,
} as unknown as RateItem;

const ctx: PricingContext = {
  rateItems: [wallItem],
  products: [{ name: "Std Wall", coverage: 14, price_per_litre: 2000, wastage_pct: 10 }] as unknown as Product[],
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
const area = (id: number, name: string, L: number, sid: number) =>
  ({ kind: "area", id, name, type: "Interior", areaType: "room", L, W: 4, H: 2.4, surfaces: [wall(sid)] });
const lounge = area(1, "Lounge", 5, 11);
const pergola = area(2, "Pergola", 3, 21);
const hall = area(4, "Hall", 2, 41);
const garage = area(3, "Garage", 6, 31);

const accepted: RevisionState = {
  blocks: [lounge, pergola, hall], modSel: { "Level of Finish": "FIN-3" }, discountPct: 0, preparationHours: 4,
};
// Four changes at once: Lounge resized, Pergola removed, Garage added, discount.
const working: RevisionState = {
  ...accepted,
  blocks: [{ ...lounge, L: 7 }, hall, garage],
  discountPct: 10,
};

const refs = (s: RevisionState) => diffRevision(accepted, s, ctx).changes.map((c) => c.blockRef).sort();

test("the fixture carries four separate changes", () => {
  assert.deepEqual(refs(working), ["adjustments", "block:1", "block:2", "block:3"]);
});

test("undoing a CHANGED area restores the accepted copy and nothing else", () => {
  const next = revertChange(accepted, working, "block:1");
  assert.deepEqual(refs(next), ["adjustments", "block:2", "block:3"]);
  assert.deepEqual((next.blocks as unknown[])[0], lounge);
  assert.equal(next.discountPct, 10);
});

test("undoing an ADDED area removes it", () => {
  const next = revertChange(accepted, working, "block:3");
  assert.deepEqual(refs(next), ["adjustments", "block:1", "block:2"]);
  assert.ok(!(next.blocks as { id: number }[]).some((b) => b.id === 3));
});

test("undoing a REMOVED area puts it back where it was", () => {
  const next = revertChange(accepted, working, "block:2");
  assert.deepEqual(refs(next), ["adjustments", "block:1", "block:3"]);
  assert.deepEqual((next.blocks as { id: number }[]).map((b) => b.id), [1, 2, 4, 3]);
});

test("a removed FIRST block goes back to the top", () => {
  const w: RevisionState = { ...accepted, blocks: [pergola, hall] };
  const next = revertChange(accepted, w, "block:1");
  assert.deepEqual((next.blocks as { id: number }[]).map((b) => b.id), [1, 2, 4]);
  assert.deepEqual(refs(next), []);
});

test("undoing the job-level adjustments leaves every block change alone", () => {
  const next = revertChange(accepted, working, "adjustments");
  assert.deepEqual(refs(next), ["block:1", "block:2", "block:3"]);
  assert.equal(next.discountPct, 0);
  assert.equal(next.preparationHours, 4);
  assert.deepEqual(next.blocks, working.blocks);
});

test("an adjustment key the accepted scope never had is dropped, not set to undefined", () => {
  const next = revertChange(accepted, { ...accepted, hourlyRateOverride: 120 }, "adjustments");
  assert.ok(!("hourlyRateOverride" in next));
  assert.deepEqual(refs(next), []);
});

test("undoing every change, one at a time, lands back on the accepted scope", () => {
  let s = working;
  for (const ref of refs(working)) s = revertChange(accepted, s, ref);
  assert.deepEqual(refs(s), []);
  const d = diffRevision(accepted, s, ctx);
  assert.equal(d.workingIncCents, d.acceptedIncCents);
});

test("an unknown ref changes nothing", () => {
  assert.equal(revertChange(accepted, working, "block:99"), working);
  assert.equal(revertChange(accepted, working, "nonsense"), working);
});

// 28 Logan St, 12 Oct 2026: the builder's live preview built the working state
// by hand and left out preparationHours, so an untouched job with 4 h of
// Preparation read "Pricing adjustments changed · −$… · 4 hr". The working
// state compared must carry EVERY key the scope has (QuoteBuilder spreads the
// loaded working scope under the live fields).
test("a working state missing preparationHours is a phantom adjustments change", () => {
  const { preparationHours: _drop, ...lossy } = accepted;
  void _drop;
  const phantom = diffRevision(accepted, lossy, ctx).changes;
  assert.deepEqual(phantom.map((c) => c.blockRef), ["adjustments"]);
  assert.equal(phantom[0].hours, 4);
  assert.deepEqual(diffRevision(accepted, { ...accepted }, ctx).changes, []);
});
