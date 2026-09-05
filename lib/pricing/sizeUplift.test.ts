import { test } from "vitest";
import assert from "node:assert/strict";
import { sizeUpliftCents } from "./estimate";

const TIERS = [{ overCents: 1_000_000, pct: 5 }, { overCents: 2_000_000, pct: 3 }];

test("nothing under the first threshold; marginal above it; tiers stack", () => {
  assert.equal(sizeUpliftCents(900_000, TIERS), 0);
  assert.equal(sizeUpliftCents(1_000_000, TIERS), 0);
  assert.equal(sizeUpliftCents(1_500_000, TIERS), 25_000);          // 5% of the $5,000 above $10k
  assert.equal(sizeUpliftCents(2_500_000, TIERS), 75_000 + 15_000); // 5% of $15k above 10k + 3% of $5k above 20k
});

test("a job never gets cheaper by getting bigger (continuous at the thresholds)", () => {
  let prev = -1;
  for (let sub = 0; sub <= 3_000_000; sub += 50_000) {
    const total = sub + sizeUpliftCents(sub, TIERS);
    assert.ok(total >= prev, `not monotonic at ${sub}`);
    prev = total;
  }
  assert.equal(sizeUpliftCents(1_000_001, TIERS), 0); // one cent over → rounds to 0, no cliff
});

test("0% tiers (the default until Tom sets them) add nothing", () => {
  assert.equal(sizeUpliftCents(5_000_000, [{ overCents: 1_000_000, pct: 0 }, { overCents: 2_000_000, pct: 0 }]), 0);
});
