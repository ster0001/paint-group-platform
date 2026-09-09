import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CEILINGS_ONLY_UPLIFT_PCT, reconcileRoomAllowances, roomAllowanceLabels, ROOM_ALLOWANCES,
  type AllowanceBlock,
} from "./allowances";

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

/**
 * Tom, 9 Sep: *"if ceilings are being painted and walls aren't, we need to
 * charge the ceiling and cornice at a 30% higher rate."* That replaced the
 * flat Ceilings Only Allowance LINE — a half-hour under-charges a big living
 * room and over-charges a WC, where a percentage tracks the room.
 */
test("ceilings without walls take a 30% uplift; ticking the walls back clears it", () => {
  const only = reconcileRoomAllowances(
    [room([{ code: "Ceilings" }, { code: "Standard Cornices" }])],
    { tier: "change", rateItems: rows }, counter(),
  );
  const lifted = only.blocks[0].surfaces!.filter((s) => (s as { upliftPct?: number }).upliftPct === CEILINGS_ONLY_UPLIFT_PCT);
  // The ceiling AND its cornice, and no flat line.
  assert.equal(lifted.length, 2);
  assert.ok(!codes(only.blocks[0]).includes(ROOM_ALLOWANCES.ceilingsOnly.code));

  // Reversible: the walls coming back on clears it, so a mistaken untick is
  // not a permanent 30%.
  const back = reconcileRoomAllowances(
    [{ ...only.blocks[0], surfaces: [...only.blocks[0].surfaces!, { id: 50, code: "Walls" }] }],
    { tier: "change", rateItems: rows }, counter(),
  );
  assert.equal(back.blocks[0].surfaces!.every((s) => !(s as { upliftPct?: number }).upliftPct), true);
});

test("the uplift is Tom's number, and only the ceiling and cornice take it", () => {
  const out = reconcileRoomAllowances(
    [room([{ code: "Ceilings" }, { code: "Standard Cornices" }, { code: "Skirting Boards" }])],
    { tier: "change", rateItems: rows, ceilingsOnlyUpliftPct: 45 }, counter(),
  );
  const by = (code: string) => out.blocks[0].surfaces!.find((s) => s.code === code) as { upliftPct?: number };
  assert.equal(by("Ceilings").upliftPct, 45);
  assert.equal(by("Standard Cornices").upliftPct, 45);
  // Skirting is not a ceiling; it is untouched.
  assert.equal(by("Skirting Boards").upliftPct, undefined);
});

test("idempotent, never doubled, exterior untouched, and no line when the rate row is missing", () => {
  const once = reconcileRoomAllowances([room([{ code: "Ceilings" }])], { tier: "fresh", rateItems: rows }, counter());
  const twice = reconcileRoomAllowances(once.blocks, { tier: "fresh", rateItems: rows }, counter());
  assert.equal(twice.changed, 0);
  // Only the colour-match LINE now — ceilings-only is an uplift, not a line.
  assert.equal(twice.blocks[0].surfaces!.filter((s) => s.allowance === true).length, 1);
  const ext: AllowanceBlock = { id: 2, kind: "area", type: "Exterior", areaType: "surface", name: "Exterior - Front", surfaces: [{ id: 1, code: "Weatherboards" }] };
  assert.equal(reconcileRoomAllowances([ext], { tier: "fresh", rateItems: rows }, counter()).changed, 0);
  // No rate row → no colour-match LINE. The ceilings-only uplift still applies:
  // it is a percentage on hours the room already has, so unlike a line it needs
  // no row on the card to price.
  const none = reconcileRoomAllowances([room([{ code: "Ceilings" }])], { tier: "fresh", rateItems: [] }, counter());
  assert.equal(none.blocks[0].surfaces!.filter((s) => s.allowance === true).length, 0);
  assert.equal((none.blocks[0].surfaces!.find((s) => s.code === "Ceilings") as { upliftPct?: number }).upliftPct, CEILINGS_ONLY_UPLIFT_PCT);
  assert.deepEqual(roomAllowanceLabels(twice.blocks[0].surfaces!), [ROOM_ALLOWANCES.colourMatch.label]);
});
