import { test } from "vitest";
import assert from "node:assert/strict";
import { payablesTiles, type DeriveContractorInvoice } from "./derive";

const ci = (over: Partial<DeriveContractorInvoice>): DeriveContractorInvoice => ({
  status: "submitted", totalIncCents: 100_000, dueOn: "2026-08-30", ...over,
});

test("the two tiles: submitted → To approve; approved due ≤7 days → To pay this week", () => {
  const t = payablesTiles(
    [
      ci({ status: "submitted", totalIncCents: 966_000 }),          // to approve
      ci({ status: "approved", totalIncCents: 100_000, dueOn: "2026-08-27" }), // this week
      ci({ status: "approved", totalIncCents: 63_000, dueOn: "2026-08-31" }),  // this week (day 7)
      ci({ status: "approved", totalIncCents: 50_000, dueOn: "2026-09-15" }),  // later
      ci({ status: "draft", totalIncCents: 999_999 }),               // invisible
      ci({ status: "paid", totalIncCents: 999_999 }),                // done
    ],
    "2026-08-24",
  );
  assert.equal(t.toApproveCents, 966_000);
  assert.equal(t.toApproveCount, 1);
  assert.equal(t.toPayWeekCents, 163_000);
  assert.equal(t.toPayWeekCount, 2);
  assert.equal(t.approvedCents, 213_000);
  assert.equal(t.approvedCount, 3);
});

test("no due date means owed now — it lands in the week tile", () => {
  const t = payablesTiles([ci({ status: "approved", dueOn: null })], "2026-08-24");
  assert.equal(t.toPayWeekCount, 1);
});

test("empty in, zeros out", () => {
  const t = payablesTiles([], "2026-08-24");
  assert.deepEqual(t, {
    toApproveCents: 0, toApproveCount: 0,
    toPayWeekCents: 0, toPayWeekCount: 0,
    approvedCents: 0, approvedCount: 0,
  });
});
