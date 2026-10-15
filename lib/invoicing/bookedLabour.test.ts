/**
 * Booked labour (Tom, 15 Oct 2026): every working day a painter is booked is
 * a work day at hours × their rate, ahead of the day as well as behind it.
 */
import { describe, expect, it } from "vitest";
import { bookedLabour, missingRateNote, rateOn, standardDayHours, type BookedPainter } from "./bookedLabour";

const DAY = { dayStart: "07:30:00", dayFinish: "15:30:00", breakMinutes: 30 };
const NONE = new Set<string>();
// 12 First Avenue: Thu 9 Oct → Thu 16 Oct 2026 (Sat 10, Sun 11 inside it).
const adi: BookedPainter = { id: "adi", name: "Adi Rapoport", employee: true, startDate: "2026-10-09", endDate: "2026-10-16" };
const abdul: BookedPainter = { id: "abdul", name: "Abdul Kalfat", employee: true, startDate: "2026-10-09", endDate: "2026-10-16" };
const rates = [{ painterId: "abdul", effectiveFrom: "2026-09-18", centsPerHour: 3700 }];

describe("the standard day", () => {
  it("7:30 to 15:30 less 30 minutes is 7.5 h; odd minutes round to two places", () => {
    expect(standardDayHours(DAY)).toBe(7.5);
    expect(standardDayHours({ dayStart: "07:00:00", dayFinish: "15:06:00", breakMinutes: 30 })).toBe(7.6);
    expect(standardDayHours({ dayStart: "09:00", dayFinish: "09:00", breakMinutes: 30 })).toBe(0);
  });
  it("the rate on a day is the latest effective on or before it", () => {
    const r = [...rates, { painterId: "abdul", effectiveFrom: "2026-10-15", centsPerHour: 4000 }];
    expect(rateOn(r, "abdul", "2026-10-14")).toBe(3700);
    expect(rateOn(r, "abdul", "2026-10-15")).toBe(4000);
    expect(rateOn(r, "abdul", "2026-09-17")).toBeNull();
    expect(rateOn(r, "adi", "2026-10-15")).toBeNull();
  });
});

describe("booked days become labour", () => {
  it("six working days each for a Thu→Thu booking — the weekend counts nothing; every day priced at 7.5 h × the rate, and reported when no rate covers it", () => {
    const out = bookedLabour({ painters: [adi, abdul], entries: [], rates, day: DAY, holidays: NONE, countedCostIds: NONE });
    expect(out.workingDays).toBe(12);
    expect(out.projected.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(out.projected.every((d) => d.cents === 27_750 && d.hours === 7.5 && d.painterId === "abdul")).toBe(true);
    expect(out.projected[5]).toMatchObject({ id: "booked:abdul:2026-10-16", label: "Abdul Kalfat · 16 Oct · booked 7.5 h" });
    expect(out.missingRate).toEqual([{ painterId: "adi", name: "Adi Rapoport", days: 6 }]);
    expect(missingRateNote(out.missingRate)).toContain("Adi Rapoport (6 booked days)");
    expect(missingRateNote([])).toBeNull();
  });
  it("a day already recorded with a counted labour row is not projected again; a rejected day is not worked; a waiting day (no rate yet) is still booked", () => {
    const entries = [
      { painterId: "abdul", workDate: "2026-10-09", status: "approved", jobCostId: "jc1" },
      { painterId: "abdul", workDate: "2026-10-12", status: "rejected", jobCostId: null },
      { painterId: "abdul", workDate: "2026-10-13", status: "submitted", jobCostId: null },
      { painterId: "abdul", workDate: "2026-10-14", status: "approved", jobCostId: "voided" }, // its row was deleted — the day is booked again
    ];
    const out = bookedLabour({ painters: [abdul], entries, rates, day: DAY, holidays: NONE, countedCostIds: new Set(["jc1"]) });
    expect(out.projected.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  });
  it("a public holiday inside the booking is not a work day; a subcontractor is never costed by the day", () => {
    const out = bookedLabour({ painters: [abdul, { ...adi, id: "sub", employee: false }], entries: [], rates, day: DAY, holidays: new Set(["2026-10-13"]), countedCostIds: NONE });
    expect(out.projected.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(out.missingRate).toEqual([]);
  });
  it("the rate can change mid-booking and each day takes its own", () => {
    const r = [...rates, { painterId: "abdul", effectiveFrom: "2026-10-15", centsPerHour: 4000 }];
    const out = bookedLabour({ painters: [abdul], entries: [], rates: r, day: DAY, holidays: NONE, countedCostIds: NONE });
    expect(out.projected.map((d) => d.cents)).toEqual([27_750, 27_750, 27_750, 27_750, 30_000, 30_000]);
  });
  it("a one-day booking on a Saturday counts nothing until the office records it; a one-day weekday booking is one day", () => {
    expect(bookedLabour({ painters: [{ ...abdul, startDate: "2026-10-10", endDate: "2026-10-10" }], entries: [], rates, day: DAY, holidays: NONE, countedCostIds: NONE }).workingDays).toBe(0);
    expect(bookedLabour({ painters: [{ ...abdul, startDate: "2026-10-20", endDate: "2026-10-20" }], entries: [], rates, day: DAY, holidays: NONE, countedCostIds: NONE }).projected).toHaveLength(1);
  });
});
