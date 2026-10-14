import { describe, expect, it } from "vitest";
import {
  autoConfirmExactRef,
  duplicateWindowDays,
  jobCode,
} from "./intake";

describe("jobCode — the PG order reference (⚑A3/⚑21)", () => {
  it("pads to four digits and grows past them", () => {
    expect(jobCode(87)).toBe("PG-0087");
    expect(jobCode(3)).toBe("PG-0003");
    expect(jobCode(12345)).toBe("PG-12345");
  });
  it("nothing for nothing", () => {
    expect(jobCode(null)).toBe("");
    expect(jobCode(0)).toBe("");
    expect(jobCode(undefined)).toBe("");
  });
});

describe("settings readers — defaults only when the row is absent or wrong", () => {
  it("reads the seeded shape", () => {
    const rows = [{ key: "cost_intake", value: { duplicateWindowDays: 14, autoConfirmExactRef: true } }];
    expect(duplicateWindowDays(rows)).toBe(14);
    expect(autoConfirmExactRef(rows)).toBe(true);
  });
  it("falls back to the brief's defaults", () => {
    expect(duplicateWindowDays(null)).toBe(7);
    expect(autoConfirmExactRef([])).toBe(false); // ⚑A1 OFF
    expect(duplicateWindowDays([{ key: "cost_intake", value: { duplicateWindowDays: 900 } }])).toBe(7);
  });
});
