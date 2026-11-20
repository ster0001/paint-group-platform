/**
 * A signed change taken back out of the working scope must draft a credit for
 * exactly what the customer signed — so accepted + Σ signed = the working
 * total again, and the final invoice stops charging for removed work.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { PricingContext } from "../pricing/estimate";
import type { RateItem, Product } from "../pricing/types";
import { diffRevision, type RevisionState } from "./diff";
import { signedNetFor, withSignedReversals, type SignedVariationRow } from "./signedReversal";
import { revisionCredit } from "./hoursOnly";

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
const area = (id: number, name: string, surfaces: unknown[]) =>
  ({ kind: "area", id, name, type: "Interior", areaType: "room", L: 5, W: 4, H: 2.4, surfaces });
const state = (blocks: unknown[]): RevisionState => ({ blocks, modSel: { "Level of Finish": "FIN-3" } });

const accepted = state([area(1, "Lounge", [wall(11)]), area(2, "Hall", [wall(21)])]);
const withDoor = state([area(1, "Lounge", [wall(11), door(12)]), area(2, "Hall", [wall(21)])]);

/** The variation the customer signed when the door was added. */
function signedDoor(): SignedVariationRow {
  const c = diffRevision(accepted, withDoor, ctx).changes[0];
  return {
    revision_block_ref: c.blockRef, status: "contractor_accepted",
    price_cents: c.priceIncCents, credit: false, est_hours: c.hours,
    priced_inputs: { surfaces: c.addedSurfaces },
  };
}

/** draftRevision's arithmetic for one change. */
const draftOf = (rows: SignedVariationRow[], ref: string, deltaInc: number, hoursDelta: number) => {
  const net = signedNetFor(rows, ref);
  const draftDelta = deltaInc - net.incCents;
  return { draftDelta, credit: revisionCredit(draftDelta, Math.round((hoursDelta - net.hours) * 100) / 100) };
};

test("the door signed, then undone → the diff alone is empty (the bug)", () => {
  assert.equal(diffRevision(accepted, accepted, ctx).changes.length, 0);
});

test("the door signed, then undone → one credit for exactly the signed amount", () => {
  const signed = signedDoor();
  assert.ok((signed.price_cents ?? 0) > 0);
  const d = withSignedReversals(diffRevision(accepted, accepted, ctx), [signed], accepted, accepted);
  assert.equal(d.changes.length, 1);
  const c = d.changes[0];
  assert.equal(c.kind, "reverted");
  assert.equal(c.blockRef, "block:1");
  assert.equal(c.deltaIncCents, 0, "0 against the accepted scope — Σ deltas still = working − accepted");
  assert.equal(c.title, "Lounge — signed change taken back out");
  assert.deepEqual(c.surfaceKeys, ["1:12"], "the door's tick row is struck");

  const { draftDelta, credit } = draftOf([signed], c.blockRef, c.deltaIncCents, c.hoursDelta);
  assert.equal(credit, true);
  assert.equal(draftDelta, -(signed.price_cents ?? 0));
  // The ledger: accepted + signed + this credit = what the scope now costs.
  assert.equal(d.acceptedIncCents + (signed.price_cents ?? 0) + draftDelta, d.workingIncCents);
});

test("a block that still differs is left to the diff — never doubled", () => {
  const signed = signedDoor();
  const base = diffRevision(accepted, withDoor, ctx);
  const d = withSignedReversals(base, [signed], accepted, withDoor);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].kind, "changed");
  assert.equal(draftOf([signed], "block:1", d.changes[0].deltaIncCents, d.changes[0].hoursDelta).draftDelta, 0);
});

test("unsigned drafts and already-credited blocks add nothing", () => {
  const signed = signedDoor();
  const pending: SignedVariationRow = { ...signed, status: "priced" };
  const creditBack: SignedVariationRow = { ...signed, credit: true, priced_inputs: {} };
  const empty = diffRevision(accepted, accepted, ctx);
  assert.equal(withSignedReversals(empty, [pending], accepted, accepted).changes.length, 0);
  assert.equal(withSignedReversals(empty, [signed, creditBack], accepted, accepted).changes.length, 0);
});

test("a whole new area signed, then deleted → credited, named from the signed row", () => {
  const withGarage = state([...(accepted.blocks as unknown[]), area(3, "Garage", [wall(31)])]);
  const c = diffRevision(accepted, withGarage, ctx).changes[0];
  const signed: SignedVariationRow = {
    revision_block_ref: c.blockRef, status: "customer_approved", price_cents: c.priceIncCents,
    credit: false, est_hours: c.hours, priced_inputs: { surfaces: c.addedSurfaces },
    comment: `${c.title} — ${c.detail}`,
  };
  const d = withSignedReversals(diffRevision(accepted, accepted, ctx), [signed], accepted, accepted);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].title, "Garage — signed change taken back out");
  assert.deepEqual(d.changes[0].surfaceKeys, ["3:31"]);
});
