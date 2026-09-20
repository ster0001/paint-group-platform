import { describe, expect, it } from "vitest";
import { officeOpenAt, AFTER_HOURS_NOTE } from "./officeHours";

// Melbourne is AEST (+10) in July and AEDT (+11) in January — both checked.
describe("officeOpenAt (Mon–Fri 08:30–16:30 Melbourne)", () => {
  it("is open mid-morning on a weekday in winter (+10)", () => {
    expect(officeOpenAt(new Date("2026-07-15T00:00:00Z"))).toBe(true); // Wed 10:00 AEST
  });
  it("is open at 8:30 exactly and closed at 16:30 exactly", () => {
    expect(officeOpenAt(new Date("2026-07-15T22:30:00Z"))).toBe(true);  // Thu 08:30 AEST
    expect(officeOpenAt(new Date("2026-07-16T06:30:00Z"))).toBe(false); // Thu 16:30 AEST
    expect(officeOpenAt(new Date("2026-07-16T06:29:00Z"))).toBe(true);  // Thu 16:29 AEST
  });
  it("uses the summer offset (+11) — 21:30Z is 08:30 AEDT, open", () => {
    expect(officeOpenAt(new Date("2026-01-13T21:30:00Z"))).toBe(true);  // Wed 08:30 AEDT
    expect(officeOpenAt(new Date("2026-01-13T21:29:00Z"))).toBe(false);
  });
  it("is closed on the weekend and in the evening", () => {
    expect(officeOpenAt(new Date("2026-07-18T01:00:00Z"))).toBe(false); // Sat 11:00 AEST
    expect(officeOpenAt(new Date("2026-07-19T01:00:00Z"))).toBe(false); // Sun
    expect(officeOpenAt(new Date("2026-07-15T10:00:00Z"))).toBe(false); // Wed 20:00 AEST
  });
  it("the note names the hours", () => {
    expect(AFTER_HOURS_NOTE).toContain("Monday to Friday, 8:30am to 4:30pm");
  });
});
