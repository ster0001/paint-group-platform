import { test } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_ONLINE_ESTIMATES, onlineEstimatesFrom } from "./publicFlag";

test("the old { enabled } row still reads exactly as it did", () => {
  const off = onlineEstimatesFrom({ enabled: false });
  assert.equal(off.enabled, false);
  assert.equal(off.holdingTitle, DEFAULT_ONLINE_ESTIMATES.holdingTitle);
  assert.equal(off.holdingBody, DEFAULT_ONLINE_ESTIMATES.holdingBody);
  assert.equal(onlineEstimatesFrom({ enabled: true }).enabled, true);
});

test("a missing or malformed row is OFF with the default wording — never a blank page", () => {
  for (const v of [null, undefined, "on", 1, { enabled: "true" }, { holdingTitle: 3 }]) {
    const r = onlineEstimatesFrom(v);
    assert.equal(r.enabled, false, `enabled for ${JSON.stringify(v)}`);
    assert.equal(r.holdingTitle, DEFAULT_ONLINE_ESTIMATES.holdingTitle);
  }
});

test("office wording wins, trimmed and capped; blank wording falls back", () => {
  const r = onlineEstimatesFrom({ enabled: false, holdingTitle: "  Opening 28 September  ", holdingBody: "   " });
  assert.equal(r.holdingTitle, "Opening 28 September");
  assert.equal(r.holdingBody, DEFAULT_ONLINE_ESTIMATES.holdingBody);
  assert.equal(onlineEstimatesFrom({ holdingTitle: "x".repeat(500) }).holdingTitle.length, 120);
});
