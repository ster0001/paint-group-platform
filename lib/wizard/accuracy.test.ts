import { describe, expect, it } from "vitest";
import { accuracyScore, roomConfidencePct, type ScoredArea } from "./accuracy";

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

  // ---- R1.4: one confidence function -------------------------------------

  it("REGRESSION (90-vs-41): the room card % is the header's own function", () => {
    // An extracted room with an assumed ceiling height and two open
    // questions. The old card lookup said 90; the ring said far less.
    const a = area({ assumedFields: ["H"] });
    const card = roomConfidencePct(a, 2);
    const header = accuracyScore([a], 2);
    expect(card).toBe(header); // one room: identical by construction
    expect(card).toBeLessThan(80); // and nowhere near the old lookup's 90
  });

  it("no-plan/no-photo honesty cap: never above 65 until something is verified", () => {
    // ai_derived rooms would score 85 by weight — the cap holds it to 65.
    const derived = [area({ origin: "ai_derived" }), area({ origin: "ai_derived" })];
    expect(accuracyScore(derived)).toBe(65);
    // One human confirmation lifts the cap; the weights take over honestly.
    expect(accuracyScore([...derived, area({ origin: "human_confirmed" })])).toBeGreaterThan(65);
    // A customer statement counts as verification too (cross-checked later).
    expect(accuracyScore([area({ origin: "customer_stated" }), ...derived])).toBeGreaterThan(0);
  });

  it("pre-AI builder estimates (absent origin) are not capped", () => {
    expect(accuracyScore([area({ origin: "" })])).toBe(100);
  });

  it("roomConfidencePct docks 2 points per open question, capped at 12", () => {
    const a = area({ origin: "human_confirmed" });
    expect(roomConfidencePct(a, 0)).toBe(100);
    expect(roomConfidencePct(a, 3)).toBe(94);
    expect(roomConfidencePct(a, 40)).toBe(88);
  });
});
