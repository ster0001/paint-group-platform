import { describe, expect, it } from "vitest";
import { accuracyScore, type ScoredArea } from "./accuracy";

const area = (over: Partial<ScoredArea> = {}): ScoredArea => ({
  priceCents: 100_000,
  origin: "ai_extracted",
  confidence: 0.9,
  assumedFields: [],
  ...over,
});

describe("accuracyScore", () => {
  it("everything confirmed scores 100; nothing scores 0", () => {
    expect(accuracyScore([area({ origin: "human_confirmed" })])).toBe(100);
    expect(accuracyScore([])).toBe(0);
  });

  it("assumed rooms score low, extracted rooms high", () => {
    const assumed = accuracyScore([area({ origin: "ai_assumed", assumedFields: ["L", "W"] })]);
    const extracted = accuracyScore([area()]);
    expect(assumed).toBeLessThanOrEqual(50);
    expect(extracted).toBeGreaterThanOrEqual(90);
  });

  it("weights by dollars — a wrong living room hurts more than a wrong laundry", () => {
    const bigRoomAssumed = accuracyScore([
      area({ priceCents: 500_000, origin: "ai_assumed", assumedFields: ["L", "W"] }),
      area({ priceCents: 50_000, origin: "human_confirmed" }),
    ]);
    const smallRoomAssumed = accuracyScore([
      area({ priceCents: 500_000, origin: "human_confirmed" }),
      area({ priceCents: 50_000, origin: "ai_assumed", assumedFields: ["L", "W"] }),
    ]);
    expect(smallRoomAssumed).toBeGreaterThan(bigRoomAssumed);
  });

  it("an assumed ceiling height costs points", () => {
    expect(accuracyScore([area({ assumedFields: ["H"] })])).toBeLessThan(accuracyScore([area({})]));
  });

  it("an unpriced room is risk, not safety — it carries the mean weight", () => {
    const withZero = accuracyScore([
      area({ priceCents: 200_000, origin: "human_confirmed" }),
      area({ priceCents: 0, origin: "ai_assumed", assumedFields: ["L", "W"] }),
    ]);
    expect(withZero).toBeLessThan(100);
    expect(withZero).toBeGreaterThan(50);
  });

  it("deferred items cost 2 points each, capped at 12", () => {
    const base = accuracyScore([area({ origin: "human_confirmed" })]);
    expect(accuracyScore([area({ origin: "human_confirmed" })], 2)).toBe(base - 4);
    expect(accuracyScore([area({ origin: "human_confirmed" })], 40)).toBe(base - 12);
  });

  it("low reader confidence drops the credit", () => {
    expect(accuracyScore([area({ confidence: 0.4 })])).toBeLessThan(accuracyScore([area({ confidence: 0.9 })]));
  });
});
