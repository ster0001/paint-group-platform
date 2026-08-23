import { describe, expect, it } from "vitest";
import { daysFromHours } from "./board";

describe("daysFromHours — 8h days, shared across the ideal crew (Tom, 23 Aug)", () => {
  it("is one painter by default", () => {
    expect(daysFromHours(40)).toBe(5);
    expect(daysFromHours(8.5)).toBe(2);
  });
  it("divides the hours by the crew", () => {
    expect(daysFromHours(40, 2)).toBe(3);
    expect(daysFromHours(40, 5)).toBe(1);
    expect(daysFromHours(48, 3)).toBe(2);
  });
  it("never goes below a day, and ignores nonsense crews", () => {
    expect(daysFromHours(0, 3)).toBe(1);
    expect(daysFromHours(null, 2)).toBe(1);
    expect(daysFromHours(16, 0)).toBe(2);
    expect(daysFromHours(16, null)).toBe(2);
    expect(daysFromHours(16, 2.9)).toBe(1);
  });
});
