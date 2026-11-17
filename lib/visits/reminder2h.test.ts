import { describe, expect, it } from "vitest";
import { dueForTwoHourReminder, visitWindow } from "./reminder2h";
import { automationByKey } from "@/lib/automations/registry";

/**
 * Lead L11 (17 Nov 2026): the text two hours before a visit. Due from two
 * hours before until one hour before — never closer — and never inside quiet
 * hours (the default 8–7 weekdays, 9–5 Saturday, none Sunday).
 */
const v = (startsAt: string, over: Partial<{ status: string; customer_phone: string | null }> = {}) =>
  ({ starts_at: startsAt, status: "booked", customer_phone: "0412 345 678", ...over }) as { starts_at: string; status: "booked"; customer_phone: string | null };
// Wed 18 Nov 2026, Melbourne +11: a 1:00 pm visit = 02:00Z.
const visit = v("2026-11-18T02:00:00Z");
const at = (iso: string) => dueForTwoHourReminder([visit], new Date(iso)).length;

describe("L11 — two hours before", () => {
  it("due from 2 h before until 1 h before, never closer", () => {
    expect(at("2026-11-17T23:59:00Z")).toBe(0); // 2 h 1 min before
    expect(at("2026-11-18T00:00:00Z")).toBe(1); // 11:00 am
    expect(at("2026-11-18T00:59:00Z")).toBe(1);
    expect(at("2026-11-18T01:00:00Z")).toBe(0); // an hour before: too close
  });
  it("only a booked visit with a mobile", () => {
    const now = new Date("2026-11-18T00:30:00Z");
    expect(dueForTwoHourReminder([v(visit.starts_at, { status: "cancelled" })], now)).toHaveLength(0);
    expect(dueForTwoHourReminder([v(visit.starts_at, { customer_phone: null })], now)).toHaveLength(0);
  });
  it("inside quiet hours nothing goes: an 8:30 am visit's window is before 8 am", () => {
    const early = v("2026-11-17T21:30:00Z"); // Wed 8:30 am
    expect(dueForTwoHourReminder([early], new Date("2026-11-17T20:00:00Z"))).toHaveLength(0); // 7:00 am
    expect(dueForTwoHourReminder([early], new Date("2026-11-17T20:00:00Z"), { weekday: [7, 19], saturday: [9, 17], sunday: null })).toHaveLength(1);
  });
  it("words the window as Appendix A does", () => {
    expect(visitWindow("2026-11-18T02:00:00Z", "2026-11-18T03:00:00Z")).toBe("1:00 pm and 2:00 pm");
  });
  it("ships off, a text, quiet hours decided by the window itself", () => {
    expect(automationByKey("visit_reminder_2h")).toMatchObject({ defaultOff: true, channels: ["sms"], audience: "customer", quietExempt: true });
  });
});
