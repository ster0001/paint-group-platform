/**
 * ⚑14 golden tests — the one GST rounding rule, including the 1-cent
 * rounding cases and the surcharge-GST case (§4.4 of the brief).
 */
import { describe, expect, it } from "vitest";
import { fromExLines, fromIncTotal, gstFromIncCents, gstOnExCents, roundHalfUp } from "./gst";

describe("roundHalfUp matches Postgres round(numeric)", () => {
  it("rounds .5 up for positives", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3); // never banker's rounding
    expect(roundHalfUp(2.4999)).toBe(2);
  });
  it("rounds .5 away from zero for negatives (credit notes, descopes)", () => {
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});

describe("gstOnExCents — the 1-cent cases", () => {
  it("5c ex → 1c GST (0.5 rounds up)", () => expect(gstOnExCents(5)).toBe(1));
  it("4c ex → 0c GST", () => expect(gstOnExCents(4)).toBe(0));
  it("15c ex → 2c GST", () => expect(gstOnExCents(15)).toBe(2));
  it("$1,079.095 boundary: 1079095c ex → 107910c (not 107909)", () =>
    expect(gstOnExCents(1_079_095)).toBe(107_910));
  it("plain 10%", () => expect(gstOnExCents(1_000_000)).toBe(100_000));
});

describe("fromIncTotal — inc-anchored invoices (deposit / progress / final)", () => {
  it("the mockup final: $11,870.00 → $10,790.91 + $1,079.09", () => {
    expect(fromIncTotal(1_187_000)).toEqual({
      subtotalExCents: 1_079_091,
      gstCents: 107_909,
      totalIncCents: 1_187_000,
    });
  });
  it("the mockup deposit: $1,978.30 splits and recombines exactly", () => {
    const s = fromIncTotal(197_830);
    expect(s.gstCents).toBe(17_985);
    expect(s.subtotalExCents + s.gstCents).toBe(197_830);
  });
  it("total always reassembles from the parts", () => {
    for (const inc of [1, 10, 104, 105, 110, 111, 999, 197_830, 1_187_000, 2_120_000]) {
      const s = fromIncTotal(inc);
      expect(s.subtotalExCents + s.gstCents).toBe(inc);
    }
  });
  it("the surcharge-GST case (⚑5): a $34.00 inc surcharge carries $3.09 GST", () => {
    expect(gstFromIncCents(3_400)).toBe(309);
  });
  it("a credit (negative) splits away from zero and still reassembles", () => {
    const s = fromIncTotal(-88_300);
    expect(s.gstCents).toBe(-8_027);
    expect(s.subtotalExCents + s.gstCents).toBe(-88_300);
  });
});

describe("fromExLines — line-built invoices (variation / standalone)", () => {
  it("GST once on the summed subtotal, not per line", () => {
    // Per-line: round(0.5)+round(0.5) = 2. Once on the sum: round(1.0) = 1.
    const s = fromExLines([5, 5]);
    expect(s.subtotalExCents).toBe(10);
    expect(s.gstCents).toBe(1);
    expect(s.totalIncCents).toBe(11);
  });
  it("empty lines produce a zero split", () =>
    expect(fromExLines([])).toEqual({ subtotalExCents: 0, gstCents: 0, totalIncCents: 0 }));
  it("negative lines (adjustments) net into the subtotal first", () => {
    const s = fromExLines([100_000, -20_000]);
    expect(s.subtotalExCents).toBe(80_000);
    expect(s.gstCents).toBe(8_000);
  });
});
