import { describe, expect, it } from "vitest";
import { officeOpenAt, AFTER_HOURS_NOTE, PHONE_HOURS_LINE } from "./officeHours";
import { DEFAULT_PHONE_HOURS } from "@/lib/wizard/customer-scope";

// Melbourne is AEST (+10) in July and AEDT (+11) in January — both checked.
describe("officeOpenAt (Mon–Fri 08:00–17:00 Melbourne — Tom, 12 Nov 2026)", () => {
  it("is open mid-morning on a weekday in winter (+10)", () => {
    expect(officeOpenAt(new Date("2026-07-15T00:00:00Z"))).toBe(true); // Wed 10:00 AEST
  });
  it("is open at 8:00 exactly and closed at 17:00 exactly", () => {
    expect(officeOpenAt(new Date("2026-07-15T22:00:00Z"))).toBe(true);  // Thu 08:00 AEST
    expect(officeOpenAt(new Date("2026-07-15T21:59:00Z"))).toBe(false); // Wed 07:59 AEST
    expect(officeOpenAt(new Date("2026-07-16T07:00:00Z"))).toBe(false); // Thu 17:00 AEST
    expect(officeOpenAt(new Date("2026-07-16T06:59:00Z"))).toBe(true);  // Thu 16:59 AEST
  });
  it("uses the summer offset (+11) — 21:00Z is 08:00 AEDT, open", () => {
    expect(officeOpenAt(new Date("2026-01-13T21:00:00Z"))).toBe(true);  // Wed 08:00 AEDT
    expect(officeOpenAt(new Date("2026-01-13T20:59:00Z"))).toBe(false);
  });
  it("is closed on the weekend and in the evening", () => {
    expect(officeOpenAt(new Date("2026-07-18T01:00:00Z"))).toBe(false); // Sat 11:00 AEST
    expect(officeOpenAt(new Date("2026-07-19T01:00:00Z"))).toBe(false); // Sun
    expect(officeOpenAt(new Date("2026-07-15T10:00:00Z"))).toBe(false); // Wed 20:00 AEST
  });
  it("the note names the hours", () => {
    expect(AFTER_HOURS_NOTE).toContain("Monday to Friday, 8am to 5pm");
  });
  it("the wizard's phone-lines default is the same hours (one clock)", () => {
    expect(PHONE_HOURS_LINE).toBe("8am \u2013 5pm, Monday to Friday");
    expect(DEFAULT_PHONE_HOURS).toBe(PHONE_HOURS_LINE);
  });
});
