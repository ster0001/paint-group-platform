import { describe, expect, it } from "vitest";
import { quoteBreakdown, shareDollars } from "./quoteBreakdown";

describe("go-live H1 — the quote adds up (lib/pricing/quoteBreakdown)", () => {
  it("whole dollars by weight, largest remainder, summing exactly", () => {
    expect(shareDollars(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(shareDollars(10, [3, 3, 3, 1])).toEqual([3, 3, 3, 1]);
    expect(shareDollars(7, [0, 0])).toEqual([7, 0]);
    expect(shareDollars(0, [5, 5])).toEqual([0, 0]);
    // a discount is a negative weight and comes out negative
    expect(shareDollars(900, [1000, -100])).toEqual([1000, -100]);
    for (const total of [1, 99, 1234, 98_765]) {
      const out = shareDollars(total, [1234, 567, 89, 4321, 1]);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("sum of the lines = Subtotal, and Subtotal + GST = the range, low and high, to the dollar", () => {
    const parts = [
      { key: "room:1", cents: 123_456 }, { key: "room:2", cents: 234_567 }, { key: "room:3", cents: 45_678 },
      { key: "prep", cents: 38_250 }, { key: "cleaning", cents: 19_500 }, { key: "specialist", cents: 0 }, { key: "size", cents: 0 }, { key: "discount", cents: 0 },
    ];
    const b = quoteBreakdown(parts, 410_033, 505_099);
    const sumLo = b.lines.reduce((a, l) => a + l.loCents, 0), sumHi = b.lines.reduce((a, l) => a + l.hiCents, 0);
    expect(sumLo).toBe(b.subtotalLoCents);
    expect(sumHi).toBe(b.subtotalHiCents);
    expect(b.subtotalLoCents + b.gstLoCents).toBe(b.totalLoCents);
    expect(b.subtotalHiCents + b.gstHiCents).toBe(b.totalHiCents);
    expect(b.totalLoCents).toBe(410_000);
    expect(b.totalHiCents).toBe(505_100);
    // every line is whole dollars; the zero parts stay at zero
    for (const l of b.lines) { expect(l.loCents % 100).toBe(0); expect(l.hiCents % 100).toBe(0); }
    expect(b.lines.find((l) => l.key === "specialist")).toEqual({ key: "specialist", loCents: 0, hiCents: 0 });
    // the prep and cleaning dollars are real lines, in proportion
    const prep = b.lines.find((l) => l.key === "prep")!;
    expect(prep.loCents).toBeGreaterThan(0);
    expect(prep.loCents / b.subtotalLoCents).toBeCloseTo(38_250 / 461_451, 2);
  });

  it("the GST rows are the range's own split (10% in 110%)", () => {
    const b = quoteBreakdown([{ key: "room:1", cents: 100 }], 110_000, 220_000);
    expect(b.gstLoCents).toBe(10_000);
    expect(b.gstHiCents).toBe(20_000);
    expect(b.subtotalLoCents).toBe(100_000);
    expect(b.lines[0]).toEqual({ key: "room:1", loCents: 100_000, hiCents: 200_000 });
  });
});
