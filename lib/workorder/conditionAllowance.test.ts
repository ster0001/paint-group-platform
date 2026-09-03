import { test } from "vitest";
import assert from "node:assert/strict";
import { conditionAllowanceLine, conditionExtraHours } from "./conditionAllowance.ts";

test("a poor-condition surface reports the hours the multiplier added", () => {
  // 10 base hours × 1.35 = 13.5 painting hours; 3.5 of them are the condition.
  assert.equal(conditionExtraHours(13.5, 1.35), 3.5);
});

test("fair or sound condition adds nothing — a discount is not 'extra prep'", () => {
  assert.equal(conditionExtraHours(10, 1), 0);
  assert.equal(conditionExtraHours(9, 0.9), 0);
});

test("garbage in, zero out — never NaN on a job sheet", () => {
  assert.equal(conditionExtraHours(Number.NaN, 1.35), 0);
  assert.equal(conditionExtraHours(0, 1.35), 0);
  assert.equal(conditionExtraHours(5, Number.POSITIVE_INFINITY), 0);
});

test("the sheet line names the condition, the hours and the multiplier", () => {
  const line = conditionAllowanceLine({ label: "Poor — flaking / peeling (×1.35)", multiplier: 1.35, extraHours: 3.5 });
  assert.equal(line, "Poor — flaking / peeling — extra prep allowed for: +3.5 h across the job (×1.35 on painting hours)");
  assert.equal(conditionAllowanceLine({ label: "Fair", multiplier: 1, extraHours: 0 }), null);
  assert.equal(conditionAllowanceLine(null), null);
});
