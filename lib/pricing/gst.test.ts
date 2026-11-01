import { describe, expect, it } from "vitest";
import { gstRateFromSettings, splitGst } from "./gst";

describe("GST on an inclusive figure (quote stage v10 §5)", () => {
  it("splits to the cent and adds back exactly", () => {
    expect(splitGst(110_000)).toEqual({ exCents: 100_000, gstCents: 10_000 });
    const s = splitGst(123_457);
    expect(s.exCents + s.gstCents).toBe(123_457);
    expect(splitGst(0)).toEqual({ exCents: 0, gstCents: 0 });
  });
  it("reads the Settings GST row the engine reads, 10% when absent or nonsense", () => {
    expect(gstRateFromSettings([{ key: "GST", value: 0.1 }])).toBe(0.1);
    expect(gstRateFromSettings([{ key: "gst", value: { value: 0.15 } }])).toBe(0.15);
    expect(gstRateFromSettings([])).toBe(0.1);
    expect(gstRateFromSettings([{ key: "GST", value: 12 }])).toBe(0.1);
  });
});
