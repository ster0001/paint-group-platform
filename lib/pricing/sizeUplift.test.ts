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

test("an imported, override-only scope opts out of the uplift entirely (sizeUpliftDisabled)", async () => {
  const { priceEstimateTotals } = await import("./estimate");
  const ctx = {
    rateItems: [], products: [], modifiers: [],
    settings: [
      { key: "Margin uplift — tier 1 %", value: { value: 5 } }, { key: "Margin uplift — tier 1 threshold", value: { value: 10000 } },
      { key: "Sundries per job — interior", value: { value: 0 } }, { key: "GST", value: { value: 0.1 } },
    ],
  };
  const blocks = [{ kind: "line" as const, type: "Interior" as const, mode: "custom" as const, hours: 0, rate: 0, qty: 1, unitPrice: 0, custom: 15000, cost: 0, woHours: 0 }];
  const withUplift = priceEstimateTotals(blocks, ctx, { modSel: {}, materials: {} });
  const without = priceEstimateTotals(blocks, ctx, { modSel: {}, materials: {}, sizeUpliftDisabled: true });
  assert.equal(withUplift.sizeUpliftCents, 25_000);
  assert.equal(without.sizeUpliftCents, 0);
  assert.equal(without.subtotalCents, 1_500_000);
  assert.equal(without.totalCents, 1_650_000);
});
