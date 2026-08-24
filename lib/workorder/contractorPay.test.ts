import { test } from "vitest";
import assert from "node:assert/strict";
import {
  contractorAdjustedCents,
  contractorVariationCents,
  contractorVariationsCents,
  type PayVariation,
} from "./contractorPay";

const v = (over: Partial<PayVariation>): PayVariation => ({
  status: "contractor_accepted", credit: false,
  contractor_delta_cents: 18_000, deduction_cents: null,
  needs_manual_deduction: false, ...over,
});

test("an accepted addition adds its delta", () => {
  assert.equal(contractorVariationCents(v({})), 18_000);
});

test("an acknowledged clean credit subtracts the engine's delta", () => {
  assert.equal(contractorVariationCents(v({ credit: true })), -18_000);
});

test("a started-work credit subtracts ONLY the PC's manual figure", () => {
  assert.equal(
    contractorVariationCents(v({ credit: true, needs_manual_deduction: true, deduction_cents: 5_000 })),
    -5_000,
  );
  // Unset manual deduction deducts nothing yet — never the engine's figure.
  assert.equal(
    contractorVariationCents(v({ credit: true, needs_manual_deduction: true, deduction_cents: null })),
    0,
  );
});

test("a PC-set deduction wins over the engine delta on any credit", () => {
  assert.equal(
    contractorVariationCents(v({ credit: true, deduction_cents: 2_500 })),
    -2_500,
  );
});

test("nothing counts before contractor_accepted", () => {
  for (const status of ["raised", "priced", "customer_approved", "declined", "cancelled"]) {
    assert.equal(contractorVariationCents(v({ status })), 0);
    assert.equal(contractorVariationCents(v({ status, credit: true })), 0);
  }
});

test("adjusted pay = offer + Σ, floored at zero", () => {
  const vars = [
    v({}),                                            // +18000
    v({ credit: true, contractor_delta_cents: 6_000 }), // −6000
  ];
  assert.equal(contractorVariationsCents(vars), 12_000);
  assert.equal(contractorAdjustedCents(100_000, vars), 112_000);
  assert.equal(
    contractorAdjustedCents(1_000, [v({ credit: true, contractor_delta_cents: 5_000 })]),
    0,
  );
});
