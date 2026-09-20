/**
 * Sales financial year (Tom, 20 Sep 2026): July → June, named by the year it
 * ends. "When I input sales goals for January it should update to Jan 2027."
 */
import { describe, expect, it } from "vitest";
import { FY_START_MONTH, fyEnd, fyLabel, fyMonthLabel, fyMonths, fyOf, fyShortLabel, fyStart, isWholeFy } from "./financialYear";

describe("financial year · July → June", () => {
  it("starts in July", () => {
    expect(FY_START_MONTH).toBe(7);
  });
  it("a day in the July–December half belongs to the FY ending NEXT year", () => {
    expect(fyOf("2026-09-15")).toBe(2027);
    expect(fyOf("2026-07-01")).toBe(2027);
    expect(fyOf("2026-12-31")).toBe(2027);
    expect(fyOf("2026-09")).toBe(2027);           // yyyy-mm is enough
  });
  it("a day in the January–June half belongs to the FY ending THIS year", () => {
    expect(fyOf("2026-03-01")).toBe(2026);
    expect(fyOf("2026-01-01")).toBe(2026);
    expect(fyOf("2026-06-30")).toBe(2026);
  });
  it("labels, start and end", () => {
    expect(fyLabel(2027)).toBe("FY 2026/27");
    expect(fyLabel(2026)).toBe("FY 2025/26");
    expect(fyLabel(2030)).toBe("FY 2029/30");
    expect(fyShortLabel(2027)).toBe("FY 26/27");
    expect(fyStart(2027)).toBe("2026-07-01");
    expect(fyEnd(2027)).toBe("2027-06-30");
    expect(fyOf(fyStart(2027))).toBe(2027);
    expect(fyOf(fyEnd(2027))).toBe(2027);
  });
  it("lists the twelve months July … June, so January in FY 2026/27 is 2027-01", () => {
    const months = fyMonths(2027);
    expect(months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
    expect(months[6]).toBe("2027-01");
    for (const m of months) expect(fyOf(m)).toBe(2027);
  });
  it("labels a month in full", () => {
    expect(fyMonthLabel("2027-01")).toBe("January 2027");
    expect(fyMonthLabel("2026-07")).toBe("July 2026");
  });
  it("knows a whole financial year when it sees one", () => {
    expect(isWholeFy("2026-07-01", "2027-06-30")).toBe(true);
    expect(isWholeFy("2026-07-01", "2027-06-29")).toBe(false);
    expect(isWholeFy("2026-01-01", "2026-12-31")).toBe(false);
  });
});
