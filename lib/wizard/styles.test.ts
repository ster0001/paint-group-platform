import { test } from "vitest";
import assert from "node:assert/strict";
import { applyDoorStyle, applyWindowStyle, openStyleQuestions, type StyleBlock } from "./styles";

const bed = (surfaces: StyleBlock["surfaces"]): StyleBlock => ({ id: 1, kind: "area", type: "Interior", name: "Bed 1", surfaces });
const door = (code: string, assumed: string[] = ["style"]) => ({ id: 11, code, count: 1, origin: "ai_assumed", assumedFields: assumed });
const win = (code: string, assumed: string[] = ["style"]) => ({ id: 12, code, count: 2, origin: "ai_assumed", assumedFields: assumed });

test("an assumed flat door + frame becomes the panel door + frame; the count and the frame scope are kept", () => {
  const r = applyDoorStyle([bed([door("Flat Door and Frame (1 Side)")])], "panel");
  const s = r.blocks[0].surfaces![0];
  assert.equal(r.changed, 1);
  assert.equal(s.code, "4-6 Panel Door and Frame (1 Side)");
  assert.equal(s.count, 1);
  assert.equal(s.origin, "customer_stated");
  assert.deepEqual(s.assumedFields, []);
});

test("a door whose style is already settled never moves; an exterior door never moves", () => {
  const settled = door("Flat Door and Frame (1 Side)", []);
  const r = applyDoorStyle([bed([settled])], "panel");
  assert.equal(r.changed, 0);
  assert.equal(r.blocks[0].surfaces![0].code, "Flat Door and Frame (1 Side)");
  const ext: StyleBlock = { id: 2, kind: "area", type: "Exterior", surfaces: [door("Flat Door and Frame (1 Side)")] };
  assert.equal(applyDoorStyle([ext], "panel").changed, 0);
});

test("assumed casement windows become sash; an unknown style is refused rather than guessed", () => {
  const r = applyWindowStyle([bed([win("Awning / Casement Window")])], "sash");
  assert.ok("blocks" in r);
  assert.equal(r.changed, 1);
  assert.equal(r.blocks[0].surfaces![0].code, "Double Hung Sash");
  assert.equal(r.blocks[0].surfaces![0].count, 2);
});

test("the open-questions read says which styles are still assumed", () => {
  const blocks = [bed([door("Flat Door and Frame (1 Side)"), win("Awning / Casement Window", [])])];
  assert.deepEqual(openStyleQuestions(blocks), { doors: true, windows: false });
  const after = applyDoorStyle(blocks, "flat").blocks;
  assert.deepEqual(openStyleQuestions(after), { doors: false, windows: false });
});
