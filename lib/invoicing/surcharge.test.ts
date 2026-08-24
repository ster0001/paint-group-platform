/**
 * ⚑4 surcharge goldens — pass-through of the card cost, one rounding rule,
 * GST-inclusive (⚑5: its GST component reports via gstFromIncCents).
 */
import { describe, expect, it } from "vitest";
import { gstFromIncCents } from "./gst";
import { surchargeCents, surchargeFromSettings } from "./surcharge";

describe("surchargeCents — 1.70% + 30¢ default", () => {
  it("the mockup final: $11,870.00 → $202.09 surcharge", () => {
    // 1187000 × 0.017 = 20179 exactly, + 30
    expect(surchargeCents(1_187_000)).toBe(20_209);
  });
  it("the mockup deposit: $1,978.30 → $33.93 (the '$34.00' ballpark on the mockup)", () => {
    expect(surchargeCents(197_830)).toBe(3_363 + 30);
  });
  it("half-up on the percentage component", () => {
    // 15 × 170 / 10000 = 0.255 → 0 (0.255 rounds to 0? no: roundHalfUp(0.255)=0)…
    // use a true boundary: 5000 × 170 / 10000 = 85.0 exact; 4997 → 84.949 → 85.
    expect(surchargeCents(5_000)).toBe(85 + 30);
    expect(surchargeCents(4_997)).toBe(85 + 30);
  });
  it("zero and negative balances carry no surcharge", () => {
    expect(surchargeCents(0)).toBe(0);
    expect(surchargeCents(-5_000)).toBe(0);
  });
  it("settings override the rate — ⚑4 is a Settings value", () => {
    expect(surchargeCents(100_000, 100, 0)).toBe(1_000); // 1.00%, no fixed part
  });
  it("the surcharge is GST-inclusive: its GST component reports cleanly (⚑5)", () => {
    const s = surchargeCents(1_187_000);
    expect(gstFromIncCents(s)).toBe(1_837); // $18.37 of the $202.09
  });
});

describe("surchargeFromSettings", () => {
  it("reads the seeded keys, defaults when absent or malformed", () => {
    expect(surchargeFromSettings({ surchargePctBps: 150, surchargeFixedCents: 25 }))
      .toEqual({ pctBps: 150, fixedCents: 25 });
    expect(surchargeFromSettings(null)).toEqual({ pctBps: 170, fixedCents: 30 });
    expect(surchargeFromSettings({ surchargePctBps: "abc" })).toEqual({ pctBps: 170, fixedCents: 30 });
  });
});
