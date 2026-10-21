import { describe, expect, it } from "vitest";
import { defaultWeekStart, mondayOf, weekEnd, weekLabel, weekStartFrom } from "./week";

describe("which week the Movements board opens on", () => {
  it("Monday to Wednesday: this week; Thursday to Sunday: next week (brief §3.4)", () => {
    expect(defaultWeekStart("2026-10-19")).toBe("2026-10-19"); // Mon
    expect(defaultWeekStart("2026-10-21")).toBe("2026-10-19"); // Wed
    expect(defaultWeekStart("2026-10-22")).toBe("2026-10-26"); // Thu
    expect(defaultWeekStart("2026-10-24")).toBe("2026-10-26"); // Sat
    expect(defaultWeekStart("2026-10-25")).toBe("2026-10-26"); // Sun
  });
  it("a week param snaps to its Monday; a bad one falls back", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(weekStartFrom("2026-10-28", "2026-10-20")).toBe("2026-10-26");
    expect(weekStartFrom("nope", "2026-10-20")).toBe("2026-10-19");
    expect(weekStartFrom(undefined, "2026-10-23")).toBe("2026-10-26");
  });
  it("six columns, Monday to Saturday, and the headline's label", () => {
    expect(weekEnd("2026-10-19")).toBe("2026-10-24");
    expect(weekLabel("2026-10-19")).toBe("19 Oct");
  });
});
