import { test } from "vitest";
import assert from "node:assert/strict";
import { reconcileRoomAllowances, roomAllowanceLabels, ROOM_ALLOWANCES, type AllowanceBlock } from "./allowances";

const rows = [
  { code: ROOM_ALLOWANCES.colourMatch.code, category: "Interior", charge_out_cents: 9500 },
  { code: ROOM_ALLOWANCES.ceilingsOnly.code, category: "Interior", charge_out_cents: 9500 },
];
const room = (surfaces: Array<{ code: string }>, over: Partial<AllowanceBlock> = {}): AllowanceBlock => ({
  id: 1, kind: "area", type: "Interior", name: "Bed 1", surfaces: surfaces.map((s, i) => ({ id: 10 + i, ...s })), ...over,
});
const counter = () => { let n = 100; return () => n++; };
const codes = (b: AllowanceBlock) => (b.surfaces ?? []).map((s) => String(s.code));

test("a colour match adds the allowance to every interior room, with the row's own charge-out; a colour change does not", () => {
  const fresh = reconcileRoomAllowances([room([{ code: "Walls" }, { code: "Ceilings" }])], { tier: "fresh", rateItems: rows }, counter());
  assert.equal(fresh.changed, 1);
  const line = fresh.blocks[0].surfaces!.find((s) => s.allowance === true)!;
  assert.equal(line.code, ROOM_ALLOWANCES.colourMatch.code);
  assert.equal(line.useCustomRate, true);
  assert.equal(line.customRate, 95);
  const change = reconcileRoomAllowances([room([{ code: "Walls" }, { code: "Ceilings" }])], { tier: "change", rateItems: rows }, counter());
  assert.equal(change.changed, 0);
});

test("ceilings without walls carries the ceilings-only allowance; ticking the walls back removes it", () => {
  const only = reconcileRoomAllowances([room([{ code: "Ceilings" }])], { tier: "change", rateItems: rows }, counter());
  assert.ok(codes(only.blocks[0]).includes(ROOM_ALLOWANCES.ceilingsOnly.code));
  const back = reconcileRoomAllowances([{ ...only.blocks[0], surfaces: [...only.blocks[0].surfaces!, { id: 50, code: "Walls" }] }], { tier: "change", rateItems: rows }, counter());
  assert.equal(back.changed, 1);
  assert.ok(!codes(back.blocks[0]).includes(ROOM_ALLOWANCES.ceilingsOnly.code));
});

test("idempotent, never doubled, exterior untouched, and no line when the rate row is missing", () => {
  const once = reconcileRoomAllowances([room([{ code: "Ceilings" }])], { tier: "fresh", rateItems: rows }, counter());
  const twice = reconcileRoomAllowances(once.blocks, { tier: "fresh", rateItems: rows }, counter());
  assert.equal(twice.changed, 0);
  assert.equal(twice.blocks[0].surfaces!.filter((s) => s.allowance === true).length, 2);
  const ext: AllowanceBlock = { id: 2, kind: "area", type: "Exterior", areaType: "surface", name: "Exterior - Front", surfaces: [{ id: 1, code: "Weatherboards" }] };
  assert.equal(reconcileRoomAllowances([ext], { tier: "fresh", rateItems: rows }, counter()).changed, 0);
  const none = reconcileRoomAllowances([room([{ code: "Ceilings" }])], { tier: "fresh", rateItems: [] }, counter());
  assert.equal(none.changed, 0);
  assert.deepEqual(roomAllowanceLabels(twice.blocks[0].surfaces!), [ROOM_ALLOWANCES.colourMatch.label, ROOM_ALLOWANCES.ceilingsOnly.label]);
});
