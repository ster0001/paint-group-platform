import { test } from "vitest";
import assert from "node:assert/strict";
import { PAY_NOTE, revisionSaveWarnings } from "./saveWarnings";

const base = { hours: 40, offer: 240000, rate: 6000 };

test("nothing contractor-side moved → no warning", () => {
  assert.deepEqual(revisionSaveWarnings(base, { ...base }), []);
});

test("a RATE change says it skips the customer and what it does for the contractor (Tom, 13 Oct 2026)", () => {
  const [w] = revisionSaveWarnings(base, { ...base, rate: 6500, offer: 260000 });
  assert.match(w, /\$60\/h → \$65\/h/);
  assert.match(w, /does not go to the customer/);
  assert.match(w, /\$2,600\.00/);
  assert.match(w, /sent to them to accept/);
});

test("an HOURS change says it goes to the customer first, then the contractor", () => {
  const [w] = revisionSaveWarnings(base, { ...base, hours: 44 });
  assert.match(w, /40\.0 h → 44\.0 h/);
  assert.match(w, /customer to sign first/);
  assert.match(w, /then to the contractor/);
});

test("both at once → both warnings", () => {
  assert.equal(revisionSaveWarnings(base, { hours: 44, offer: 280000, rate: 6500 }).length, 2);
});

test("every sync answer that moves or holds the contractor's figure has words", () => {
  for (const k of ["ok:synced", "ok:live", "ok:pay_change_sent", "ok:pay_change_pending", "ok:pay_change_withdrawn"]) assert.ok(PAY_NOTE[k]);
});
