import { describe, expect, it } from "vitest";
import { melbourneInstant, melbourneParts } from "./businessHours";
import { endOfNextWorkingDay, holidaysInYear, isWorkingDay, nextYearHolidaysMissing } from "./workingDays";

/** S4 done-when: Friday → end of Monday; day before a public holiday → end of the next working day after it. */
const H = new Set(["2026-11-03", "2026-12-25", "2026-12-26", "2026-12-28", "2027-01-01"]);
const mel = (d: Date) => { const p = melbourneParts(d); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${p.h}:00 (${p.weekday})`; };

describe("endOfNextWorkingDay", () => {
  it("a request on a Friday is due by the end of Monday", () => {
    const fri = melbourneInstant(2026, 10, 9, 14); // Fri 9 Oct 2026
    expect(mel(endOfNextWorkingDay(fri, H))).toBe("2026-10-12 17:00 (1)");
  });
  it("a request on Monday 2 November, the day before Melbourne Cup Day, is due by the end of Wednesday", () => {
    const mon = melbourneInstant(2026, 11, 2, 11);
    expect(mel(endOfNextWorkingDay(mon, H))).toBe("2026-11-04 17:00 (3)");
  });
  it("a request on Christmas Eve 2026 skips Christmas, the weekend and the Boxing Day substitute", () => {
    const thu = melbourneInstant(2026, 12, 24, 9);
    expect(mel(endOfNextWorkingDay(thu, H))).toBe("2026-12-29 17:00 (2)");
  });
  it("a request at 23:30 on a Tuesday is still due Wednesday 17:00 Melbourne, across the UTC day boundary", () => {
    const late = melbourneInstant(2026, 10, 6, 23, 30);
    expect(mel(endOfNextWorkingDay(late, H))).toBe("2026-10-07 17:00 (3)");
  });
  it("isWorkingDay: weekends and listed days are not", () => {
    expect(isWorkingDay(6, "2026-10-10", H)).toBe(false);
    expect(isWorkingDay(2, "2026-11-03", H)).toBe(false);
    expect(isWorkingDay(2, "2026-11-10", H)).toBe(true);
  });
});

describe("the November reminder", () => {
  const list = [...H];
  it("is raised from 1 November when next year's list is empty", () => {
    expect(nextYearHolidaysMissing(list.filter((d) => d.startsWith("2026")), melbourneInstant(2026, 11, 1, 9))).toBe(true);
    expect(nextYearHolidaysMissing(list.filter((d) => d.startsWith("2026")), melbourneInstant(2026, 10, 31, 9))).toBe(false);
    expect(nextYearHolidaysMissing(list, melbourneInstant(2026, 11, 1, 9))).toBe(false);
    expect(holidaysInYear(list, 2027)).toEqual(["2027-01-01"]);
  });
});
