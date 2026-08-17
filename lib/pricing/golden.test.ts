/**
 * Golden test — the safety net for the pricing extraction.
 *
 * Every estimate in the dev database was priced by the ORIGINAL in-component
 * code and had its subtotal/total written to the row. This asserts that
 * `lib/pricing` reproduces each of those numbers to the exact cent.
 *
 * That independence is the point: the expected values were produced by the code
 * being replaced, not by the code under test.
 *
 * Regenerate the fixture with:  npx tsx scripts/capture-pricing-fixtures.ts
 * If a case here starts failing, pricing behaviour has changed. That is either
 * a bug or a deliberate decision — never a reason to re-record the fixture
 * without saying so out loud.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceEstimateTotals, type BlockInput, type PricingContext, type Adjustments } from "./estimate.ts";
import type { Product, RateItem } from "./types.ts";

type Fixture = {
  capturedAt: string;
  activeRateCardVersion: number | null;
  reference: {
    rateItems: RateItem[];
    products: Product[];
    modifiers: { code: string; group_name: string; multiplier: number }[];
    settings: { key: string; value: unknown }[];
  };
  cases: {
    ref: string;
    rateCardVersion: number | null;
    stored: { subtotalCents: number | null; totalCents: number | null };
    input: Adjustments & { blocks: BlockInput[] };
  }[];
};

const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/golden-estimates.json", import.meta.url), "utf8"),
) as Fixture;

/**
 * A stored total is only a valid expectation while the reference data behind it
 * is unchanged. Where prices have since moved, the stored figure records what
 * the job cost THEN, not what the same inputs cost now. Those cases carry an
 * override with the value the original code produces today and evidence for it.
 */
type Overrides = { overrides: Record<string, { subtotalCents: number; totalCents: number; source: string }> };
const { overrides } = JSON.parse(
  readFileSync(new URL("./__fixtures__/golden-overrides.json", import.meta.url), "utf8"),
) as Overrides;

const ctx: PricingContext = {
  rateItems: fixture.reference.rateItems,
  products: fixture.reference.products,
  modifiers: fixture.reference.modifiers,
  settings: fixture.reference.settings,
};

test("golden fixture is present and populated", () => {
  assert.ok(fixture.cases.length > 0, "no golden cases captured");
  assert.ok(fixture.reference.rateItems.length > 0, "no rate items in the fixture");
});

for (const c of fixture.cases) {
  const o = overrides[c.ref];
  const expected = o ?? { subtotalCents: c.stored.subtotalCents, totalCents: c.stored.totalCents };
  const label = o ? `${c.ref} (expectation re-verified against the original code — see overrides)` : c.ref;

  test(`golden: ${label} reprices exactly`, () => {
    const { blocks, ...adj } = c.input;
    const got = priceEstimateTotals(blocks, ctx, adj as Adjustments);

    assert.equal(
      got.subtotalCents,
      expected.subtotalCents,
      `subtotal drifted by ${got.subtotalCents - (expected.subtotalCents ?? 0)} cents`,
    );
    assert.equal(
      got.totalCents,
      expected.totalCents,
      `total drifted by ${got.totalCents - (expected.totalCents ?? 0)} cents`,
    );
  });
}

test("every amount returned is an integer number of cents", () => {
  for (const c of fixture.cases) {
    const { blocks, ...adj } = c.input;
    const t = priceEstimateTotals(blocks, ctx, adj as Adjustments);
    for (const [k, v] of Object.entries(t)) {
      if (k === "contractorHours") continue; // hours are legitimately fractional
      assert.ok(Number.isInteger(v), `${c.ref}: ${k} = ${v} is not an integer`);
    }
  }
});
