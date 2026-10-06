import { describe, expect, it } from "vitest";
import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";
import { DEFAULT_BOOKING_RULES, STANDARD_WEEK, availability, mergeBookingRules, overlaps, slotsPerZone, speakWithUsFor, timeWords, type AvailabilityInput, type WeekSlot } from "./schedule";

/**
 * S2 golden tests — addendum A §7, S2 "done when". Fixed inputs, no database.
 * Dates: Monday 5 October 2026 is a Monday (the mockup's "now").
 */

const rules = DEFAULT_BOOKING_RULES;
const MON = (h: number, m = 0) => melbourneInstant(2026, 10, 5, h, m); // Mon 5 Oct 2026
const at = (y: number, mo: number, d: number, h: number, m = 0) => melbourneInstant(y, mo, d, h, m).toISOString();

function run(partial: Partial<AvailabilityInput> & { zone: AvailabilityInput["customer"]["zone"]; farEdge?: boolean }) {
  return availability({
    week: partial.week ?? STANDARD_WEEK,
    bookings: partial.bookings ?? [],
    holds: partial.holds ?? [],
    busy: partial.busy ?? [],
    rules: partial.rules ?? rules,
    customer: { zone: partial.zone, farEdge: partial.farEdge ?? false },
    now: partial.now ?? melbourneInstant(2026, 10, 4, 20), // Sunday evening: a clean week ahead
  });
}
const day = (days: ReturnType<typeof availability>, date: string) => days.find((d) => d.date === date)?.slots.map((s) => s.timeWords) ?? [];

describe("the seeded week", () => {
  it("has 21 slots and the section-5 per-zone totals", () => {
    expect(STANDARD_WEEK.length).toBe(21);
    expect(slotsPerZone(STANDARD_WEEK)).toEqual({ zone_1: 16, zone_2: 13, zone_3: 6, zone_4: 5, zone_5: 9 });
    expect(STANDARD_WEEK.some((s) => s.weekday === 0 || s.weekday === 6)).toBe(false);
  });
  it("Zone 1 on a Monday with nothing booked; Zone 4 on a Friday; Zone 3 on a Tuesday", () => {
    const z1 = run({ zone: "zone_1" });
    expect(day(z1, "2026-10-05")).toEqual(["8:00 am", "9:30 am", "11:00 am", "12:30 pm", "2:00 pm", "3:30 pm"]);
    expect(day(run({ zone: "zone_4" }), "2026-10-09")).toEqual(["8:00 am"]);
    expect(day(run({ zone: "zone_3" }), "2026-10-06")).toEqual(["8:00 am", "3:00 pm"]);
  });
  it("the customer sees a one-hour visit; the slot blocks 90 minutes (R32)", () => {
    const s = run({ zone: "zone_1" })[0].slots[0];
    expect(new Date(s.visitEndsAt).getTime() - new Date(s.startsAt).getTime()).toBe(60 * 60_000);
    expect(new Date(s.slotEndsAt).getTime() - new Date(s.startsAt).getTime()).toBe(90 * 60_000);
    expect(s.dayWords).toBe("Monday 5 October");
    expect(timeWords(14 * 60)).toBe("2:00 pm");
  });
});

describe("R14 — Friday 12:30 for Zone 1", () => {
  it("is offered only when Friday 11:00 has a CONFIRMED Zone 1 booking; a hold does not unlock it", () => {
    expect(day(run({ zone: "zone_1" }), "2026-10-09")).not.toContain("12:30 pm");
    const booked = run({ zone: "zone_1", bookings: [{ startsAt: at(2026, 10, 9, 11), zone: "zone_1", farEdge: false }] });
    expect(day(booked, "2026-10-09")).toContain("12:30 pm");
    expect(day(booked, "2026-10-09")).not.toContain("11:00 am");
    const z2at11 = run({ zone: "zone_1", bookings: [{ startsAt: at(2026, 10, 9, 11), zone: "zone_2", farEdge: false }] });
    expect(day(z2at11, "2026-10-09")).not.toContain("12:30 pm");
    const held = run({ zone: "zone_1", holds: [{ startsAt: at(2026, 10, 9, 11), expiresAt: at(2026, 10, 9, 11, 10) }] });
    expect(day(held, "2026-10-09")).not.toContain("12:30 pm");
    expect(day(held, "2026-10-09")).not.toContain("11:00 am");
  });
});

describe("R15 / R16 — notice and window", () => {
  it("now is Monday 10:15: 11:00 hidden, 12:30 offered, exactly 2 hours ahead offered", () => {
    const d = day(run({ zone: "zone_1", now: MON(10, 15) }), "2026-10-05");
    expect(d).toEqual(["12:30 pm", "2:00 pm", "3:30 pm"]);
    const exact = day(run({ zone: "zone_1", now: MON(9, 0) }), "2026-10-05");
    expect(exact).toContain("11:00 am");
    expect(exact).not.toContain("9:30 am");
  });
  it("same-day off hides today only", () => {
    const days = run({ zone: "zone_1", now: MON(6), rules: { ...rules, sameDay: false } });
    expect(days[0].date).toBe("2026-10-06");
  });
  it("a slot 21 days ahead is offered; 22 days ahead is not", () => {
    const days = run({ zone: "zone_1", now: MON(6) });
    expect(days.map((d) => d.date)).toContain("2026-10-26"); // Mon, 21 days
    expect(days.map((d) => d.date)).not.toContain("2026-10-27");
    expect(days.at(-1)?.date).toBe("2026-10-26");
  });
});

describe("R18 — far edges", () => {
  const z4far = { startsAt: at(2026, 10, 9, 8), zone: "zone_4" as const, farEdge: true };
  it("Friday 08:00 booked by a far-edge Zone 4 suburb hides 09:30 for far-edge Zone 3 only", () => {
    expect(day(run({ zone: "zone_3", farEdge: true, bookings: [z4far] }), "2026-10-09")).toEqual([]);
    expect(day(run({ zone: "zone_3", farEdge: false, bookings: [z4far] }), "2026-10-09")).toEqual(["9:30 am"]);
    expect(day(run({ zone: "zone_1", farEdge: true, bookings: [z4far] }), "2026-10-09")).toEqual(["9:30 am", "11:00 am", "3:30 pm"]);
  });
  it("the same with the order reversed: 09:30 far-edge Zone 3 hides 08:00 for far-edge Zone 4", () => {
    const z3far = { startsAt: at(2026, 10, 9, 9, 30), zone: "zone_3" as const, farEdge: true };
    expect(day(run({ zone: "zone_4", farEdge: true, bookings: [z3far] }), "2026-10-09")).toEqual([]);
    expect(day(run({ zone: "zone_4", farEdge: false, bookings: [z3far] }), "2026-10-09")).toEqual(["8:00 am"]);
  });
  it("an ordinary Zone 4 booking next to a far-edge Zone 3 customer is fine; a hold is not a booking", () => {
    const z4 = { startsAt: at(2026, 10, 9, 8), zone: "zone_4" as const, farEdge: false };
    expect(day(run({ zone: "zone_3", farEdge: true, bookings: [z4] }), "2026-10-09")).toEqual(["9:30 am"]);
    const hold = { startsAt: at(2026, 10, 9, 8), expiresAt: at(2026, 10, 9, 8, 10) };
    expect(day(run({ zone: "zone_3", farEdge: true, holds: [hold], now: melbourneInstant(2026, 10, 8, 20) }), "2026-10-09")).toEqual(["9:30 am"]);
  });
});

describe("4.6 — the calendar", () => {
  it("a busy time of 13:00 to 13:30 on Wednesday hides the 12:30 slot only", () => {
    const d = day(run({ zone: "zone_2", busy: [{ start: at(2026, 10, 7, 13), end: at(2026, 10, 7, 13, 30) }] }), "2026-10-07");
    expect(d).toEqual(["8:00 am", "9:30 am", "11:00 am"]);
  });
  it("an all-day busy time hides the whole day", () => {
    const days = run({ zone: "zone_2", busy: [{ allDay: "2026-10-07" }] });
    expect(days.map((d) => d.date)).not.toContain("2026-10-07");
    expect(days.map((d) => d.date)).toContain("2026-10-14");
  });
  it("a booking blocks its full 90 minutes whatever happened to the travel block (test 19)", () => {
    const week: WeekSlot[] = [{ weekday: 1, startMinutes: 480, lengthMinutes: 90, zones: ["zone_1"], cond: null }, { weekday: 1, startMinutes: 540, lengthMinutes: 90, zones: ["zone_1"], cond: null }];
    // 09:00 overlaps the 08:00 run; with 08:00 booked, 09:00 is inside the booked run and must not be offered.
    const d = run({ zone: "zone_1", week, bookings: [{ startsAt: at(2026, 10, 5, 8), zone: "zone_1", farEdge: false }], busy: [{ start: at(2026, 10, 5, 8), end: at(2026, 10, 5, 9, 30) }] });
    expect(day(d, "2026-10-05")).toEqual([]);
  });
});

describe("daylight saving", () => {
  it("the Monday after DST starts (4 Oct 2026) and after it ends (5 Apr 2027) still offer 08:00 local", () => {
    const after = run({ zone: "zone_1", now: melbourneInstant(2026, 10, 3, 20) });
    const mon = after.find((d) => d.date === "2026-10-05")!;
    expect(mon.slots[0].timeWords).toBe("8:00 am");
    expect(melbourneParts(new Date(mon.slots[0].startsAt))).toMatchObject({ h: 8, min: 0, d: 5, m: 10 });
    expect(new Date(mon.slots[0].startsAt).toISOString()).toBe("2026-10-04T21:00:00.000Z"); // +11
    const ended = run({ zone: "zone_1", now: melbourneInstant(2027, 4, 3, 20) });
    const mon2 = ended.find((d) => d.date === "2027-04-05")!;
    expect(melbourneParts(new Date(mon2.slots[0].startsAt))).toMatchObject({ h: 8, min: 0, d: 5, m: 4 });
    expect(new Date(mon2.slots[0].startsAt).toISOString()).toBe("2027-04-04T22:00:00.000Z"); // +10
  });
});

describe("Settings changes the answer", () => {
  it("editing a slot's zones changes the function's answer", () => {
    const week = STANDARD_WEEK.map((s) => (s.weekday === 1 && s.startMinutes === 660 ? { ...s, zones: ["zone_3" as const] } : s));
    expect(day(run({ zone: "zone_1", week }), "2026-10-05")).not.toContain("11:00 am");
    expect(day(run({ zone: "zone_3", week }), "2026-10-05")).toEqual(["11:00 am"]);
  });
  it("a day in the public holidays list offers no slots; the same weekday a week later is normal", () => {
    const d = run({ zone: "zone_1", rules: { ...rules, publicHolidays: ["2026-10-05"] } });
    expect(d.map((x) => x.date)).not.toContain("2026-10-05");
    expect(day(d, "2026-10-12")).toHaveLength(6);
  });
  it("a slot with no zones is offered to nobody; a non-zone customer gets nothing", () => {
    const week: WeekSlot[] = [{ weekday: 1, startMinutes: 480, lengthMinutes: 90, zones: [], cond: null }];
    expect(run({ zone: "zone_1", week })).toEqual([]);
    expect(availability({ week: STANDARD_WEEK, bookings: [], holds: [], busy: [], rules, customer: { zone: "pre_arranged" as never, farEdge: false }, now: MON(6) })).toEqual([]);
  });
});

describe("rules and overlaps", () => {
  it("mergeBookingRules bounds and defaults", () => {
    expect(mergeBookingRules(null)).toEqual(rules);
    const m = mergeBookingRules({ windowDays: 500, minNoticeMinutes: -5, publicHolidays: ["2026-12-25", "bad", "2026-12-25"], farEdgePairs: [["zone_1", "zone_1"], ["zone_2", "zone_5"]], gateOrder: "range_first" });
    expect(m.windowDays).toBe(90);
    expect(m.minNoticeMinutes).toBe(0);
    expect(m.publicHolidays).toEqual(["2026-12-25"]);
    expect(m.farEdgePairs).toEqual([["zone_2", "zone_5"]]);
    expect(m.gateOrder).toBe("range_first");
  });
  it("a slot starting inside another's 90 minutes overlaps; one starting exactly at its end does not (test 18)", () => {
    const a = { weekday: 1, startMinutes: 480, lengthMinutes: 90 };
    expect(overlaps(a, { weekday: 1, startMinutes: 540, lengthMinutes: 90 })).toBe(true);
    expect(overlaps(a, { weekday: 1, startMinutes: 570, lengthMinutes: 90 })).toBe(false);
    expect(overlaps(a, { weekday: 1, startMinutes: 420, lengthMinutes: 90 })).toBe(true);
    expect(overlaps(a, { weekday: 2, startMinutes: 480, lengthMinutes: 90 })).toBe(false);
  });
});

describe("S4 additions", () => {
  it("speakWithUsFor: top of range at or under the cap, by job type (R34)", () => {
    const r = { speakInteriorCapCents: 600_000, speakExteriorCapCents: 1_200_000 };
    expect(speakWithUsFor("interior", 430_000, r)).toBe(true);
    expect(speakWithUsFor("interior", 600_000, r)).toBe(true);
    expect(speakWithUsFor("interior", 720_000, r)).toBe(false);
    expect(speakWithUsFor("exterior", 1_150_000, r)).toBe(true);
    expect(speakWithUsFor("both", 1_250_000, r)).toBe(false);
    expect(speakWithUsFor("interior", null, r)).toBe(false);
  });
  it("the staff view ('any') offers every free slot whatever its zone list, far edges aside", () => {
    const d = availability({ week: STANDARD_WEEK, bookings: [], holds: [], busy: [], rules, customer: { zone: "any", farEdge: false }, now: MON(6) });
    expect(d.find((x) => x.date === "2026-10-07")!.slots.map((s) => s.timeWords)).toEqual(["8:00 am", "9:30 am", "11:00 am", "12:30 pm", "2:00 pm"]);
    expect(d.find((x) => x.date === "2026-10-09")!.slots.map((s) => s.timeWords)).toContain("12:30 pm");
  });
});
