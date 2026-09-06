import { test } from "vitest";
import assert from "node:assert/strict";
import { correctionBreakdown, correctionFrom } from "./correction";

test("a stored correction reads back; unknown reasons and junk are dropped; nothing usable is null", () => {
  const c = correctionFrom({ reasons: ["rooms_missed", "bogus", "rooms_missed", "sizes"], note: "  no ensuite  ", taggedAt: "2026-09-07T01:00:00Z", taggedBy: "u1" });
  assert.ok(c);
  assert.deepEqual(c.reasons, ["rooms_missed", "sizes"]);
  assert.equal(c.note, "no ensuite");
  assert.equal(correctionFrom(null), null);
  assert.equal(correctionFrom({ reasons: [] }), null);
  assert.equal(correctionFrom({ reasons: ["bogus"], note: "" }), null);
  assert.ok(correctionFrom({ reasons: [], note: "just a note" }), "a note alone is still a tag");
});

test("the breakdown counts reasons by frequency with the median correction they sat in, and keeps the untagged backlog", () => {
  const rows = [
    { correction: correctionFrom({ reasons: ["rooms_missed", "sizes"] }), correctionCents: 500_000 },
    { correction: correctionFrom({ reasons: ["rooms_missed"] }), correctionCents: -100_000 },
    { correction: correctionFrom({ reasons: ["prep"] }), correctionCents: 200_000 },
    { correction: null, correctionCents: 900_000 },
  ];
  const b = correctionBreakdown(rows);
  assert.equal(b.tagged, 3);
  assert.equal(b.untagged, 1);
  assert.deepEqual(b.reasons.map((r) => [r.reason, r.count, r.medianAbsCents]), [
    ["rooms_missed", 2, 300_000],
    ["sizes", 1, 500_000],
    ["prep", 1, 200_000],
  ]);
});
