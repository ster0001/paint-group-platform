/**
 * Tom's 24 Aug ruling as a golden test: the figure the customer approved on
 * the variation link is GST-INCLUSIVE and is what they are charged — the
 * invoice backs GST out of it, never adds on top. To the cent.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gstFromIncCents } from "./gst";
import { variationChargedIncCents, variationLineExCents } from "./variation";

describe("approved figure = invoiced line total, to the cent", () => {
  // The mockup's variations plus awkward cent values around the /11 boundary.
  const APPROVED = [88_300, 36_000, 124_300, 1, 10, 11, 12, 104, 105, 110, 111,
    99_999, 100_001, 883_00 + 1, 1_000_000];

  it("charged inc = approved inc, for every value", () => {
    for (const inc of APPROVED) {
      expect(variationChargedIncCents(inc)).toBe(inc);
    }
  });

  it("the mockup pair: $883.00 → $802.73 ex + $80.27 GST; $360.00 → $327.27 + $32.73", () => {
    expect(variationLineExCents(88_300)).toBe(80_273);
    expect(gstFromIncCents(88_300)).toBe(8_027);
    expect(variationLineExCents(36_000)).toBe(32_727);
    expect(gstFromIncCents(36_000)).toBe(3_273);
  });

  it("nobody approves $883 and gets billed $971.30 — GST is never added on top", () => {
    expect(variationChargedIncCents(88_300)).not.toBe(97_130);
  });

  it("a credit variation backs out the same way (sign flips in the ledger)", () => {
    expect(variationLineExCents(-88_300)).toBe(-80_273);
    expect(variationChargedIncCents(-88_300)).toBe(-88_300);
  });
});

describe("the SQL twin uses the identical expression", () => {
  it("invoice_draft_final backs GST out of price_cents — never multiplies up", () => {
    const CORE = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261112000000_invoicing_core.sql"),
      "utf8",
    );
    expect(CORE).toContain(
      "(v.price_cents - public.gst_from_inc_cents(v.price_cents::bigint, v_rate))",
    );
    // The ledger takes the approved figure as-is (inc GST), signed by credit.
    expect(CORE).toMatch(/case when v\.credit then -v\.price_cents else v\.price_cents end/);
    // No site multiplies a variation price by the GST rate.
    expect(CORE).not.toMatch(/price_cents\s*\*\s*1\.1/);
  });
});
