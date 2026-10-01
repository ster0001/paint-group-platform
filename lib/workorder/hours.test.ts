import { describe, expect, it } from "vitest";
import { estimatedHours, formatHours } from "./hours";

const doc = (hours: (number | null)[][]) => ({
  areas: hours.map((hs, i) => ({
    id: `a${i}`, title: `Area ${i}`, photos: [], finishCode: null, finishOverridden: false,
    surfaces: hs.map((h, j) => ({ key: `${i}:${j}`, hours: h })),
  })),
}) as unknown as Parameters<typeof estimatedHours>[0];

describe("estimatedHours", () => {
  it("sums every surface across every area, ignoring surfaces with no allowance", () => {
    expect(estimatedHours(doc([[2.5, null], [3, 1.25]]))).toBe(6.75);
  });
  it("is 0 for no document or no surfaces", () => {
    expect(estimatedHours(null)).toBe(0);
    expect(estimatedHours(doc([]))).toBe(0);
  });
  it("matches the figure the scheduler's tray uses (same rule, two decimals)", () => {
    // 30.58 is a real job's sum (WO-JQQIESIE); the tray card and the job sheet print the same number.
    expect(estimatedHours(doc([[10.1, 10.24], [10.24]]))).toBe(30.58);
  });
});

describe("formatHours", () => {
  it("prints one decimal, drops a trailing .0, and says — for none", () => {
    expect(formatHours(30.58)).toBe("30.6 h");
    expect(formatHours(24)).toBe("24 h");
    expect(formatHours(0)).toBe("—");
  });
});
