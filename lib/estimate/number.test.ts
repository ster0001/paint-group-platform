import { describe, expect, test } from "vitest";
import { formatEstimateNumber, parseEstimateNumber } from "./number";

describe("estimate numbers (Tom, 29 Sep)", () => {
  test("four digits, zero-padded, never truncated", () => {
    expect(formatEstimateNumber(1)).toBe("0001");
    expect(formatEstimateNumber(42)).toBe("0042");
    expect(formatEstimateNumber(9999)).toBe("9999");
    expect(formatEstimateNumber(12345)).toBe("12345");
  });
  test("nothing to show reads as empty, not 0000", () => {
    expect(formatEstimateNumber(null)).toBe("");
    expect(formatEstimateNumber(undefined)).toBe("");
    expect(formatEstimateNumber(0)).toBe("");
  });
  test("a typed number round-trips, with or without the padding or a #", () => {
    expect(parseEstimateNumber("0042")).toBe(42);
    expect(parseEstimateNumber("#42")).toBe(42);
    expect(parseEstimateNumber(" 42 ")).toBe(42);
    expect(parseEstimateNumber("smith")).toBeNull();
    expect(parseEstimateNumber("42a")).toBeNull();
  });
});
