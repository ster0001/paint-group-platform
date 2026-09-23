/**
 * Regression tests for the timezone bug described in dates.ts.
 *
 * These only mean anything east of Greenwich, so `npm test` pins the suite to
 * Australia/Melbourne — the timezone the business actually runs in. The first
 * test asserts that pinning worked; without it the rest would pass vacuously on
 * a machine set to UTC and the bug could come back unnoticed.
 */
import { describe, it, test, expect } from "vitest";
import { addDays, dayDiff, todayIso, localIso, isDateString, dateRange, addWorkingDays, workingDaysBetween, isWorkingDay } from "./dates.ts";

test("the suite is running east of Greenwich, or these tests prove nothing", () => {
  const offsetMinutes = -new Date("2026-09-01T00:00:00Z").getTimezoneOffset();
  expect(offsetMinutes).toBeGreaterThan(0);
});

test("addDays moves a calendar date without a timezone shifting it", () => {
  expect(addDays("2026-09-01", 1)).toBe("2026-09-02");
  expect(addDays("2026-09-01", 0)).toBe("2026-09-01");
  expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
});

test("THE BUG: a job dropped on 1 September is not written as 31 August", () => {
  // What the broken version did: parse as LOCAL midnight, format via
  // toISOString() (the UTC day). In Melbourne that is the previous date.
  const broken = (iso: string, n: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  expect(broken("2026-09-01", 0)).toBe("2026-08-31"); // the bug, reproduced
  expect(addDays("2026-09-01", 0)).toBe("2026-09-01"); // the fix
});

test("addDays crosses months, years and a leap day", () => {
  expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
});

test("addDays is unmoved by the daylight-saving change", () => {
  // Melbourne clocks go forward on the first Sunday of October. A day of
  // calendar arithmetic must still be one day, not 23 or 25 hours.
  expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
  expect(dayDiff("2026-10-03", "2026-10-05")).toBe(2);
  // And back again in April.
  expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
  expect(dayDiff("2026-04-04", "2026-04-06")).toBe(2);
});

test("dayDiff counts whole days in both directions", () => {
  expect(dayDiff("2026-09-01", "2026-09-08")).toBe(7);
  expect(dayDiff("2026-09-08", "2026-09-01")).toBe(-7);
  expect(dayDiff("2026-09-01", "2026-09-01")).toBe(0);
});

test("addDays and dayDiff are inverses over a two-month window", () => {
  const from = "2026-08-15";
  for (let n = 0; n <= 60; n++) expect(dayDiff(from, addDays(from, n))).toBe(n);
});

test("today is the LOCAL date, even late on a Melbourne evening", () => {
  // 11pm on 1 September in Melbourne is still 1 September, though it is already
  // the 1st at 13:00 UTC — and would be the 31st if the clock were 9am.
  const lateEvening = new Date("2026-09-01T13:00:00Z"); // 11pm Melbourne
  expect(todayIso(lateEvening)).toBe("2026-09-01");
  expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-09-01");

  const earlyMorning = new Date("2026-09-01T22:00:00Z"); // 8am on the 2nd, Melbourne
  expect(todayIso(earlyMorning)).toBe("2026-09-02");
  expect(earlyMorning.toISOString().slice(0, 10)).toBe("2026-09-01"); // what UTC would have said
});

test("localIso pads single-digit months and days", () => {
  expect(localIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  expect(localIso(new Date(2026, 11, 31))).toBe("2026-12-31");
});

test("isDateString accepts only a plain calendar date", () => {
  expect(isDateString("2026-09-01")).toBe(true);
  expect(isDateString("2026-9-1")).toBe(false);
  expect(isDateString("2026-09-01T00:00:00Z")).toBe(false);
  expect(isDateString("")).toBe(false);
  expect(isDateString(null)).toBe(false);
  expect(isDateString(undefined)).toBe(false);
});

test("dateRange is inclusive at both ends", () => {
  expect(dateRange("2026-09-01", "2026-09-03")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  expect(dateRange("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  expect(dateRange("2026-09-03", "2026-09-01")).toEqual([]);
});

describe("working days (Tom, 22 Sep 2026: weekends are not working days)", () => {
  // 21 Sep 2026 is a Monday.
  it("a 7-day job starting on a Monday finishes the following Tuesday", () => {
    expect(addWorkingDays("2026-09-21", 7)).toBe("2026-09-29");
    expect(workingDaysBetween("2026-09-21", "2026-09-29")).toBe(7);
  });
  it("five days from a Monday is the Friday; one day is the day itself; a Friday plus two is Monday", () => {
    expect(addWorkingDays("2026-09-21", 5)).toBe("2026-09-25");
    expect(addWorkingDays("2026-09-21", 1)).toBe("2026-09-21");
    expect(addWorkingDays("2026-09-25", 2)).toBe("2026-09-28");
  });
  it("a start on a weekend counts from the next working day", () => {
    expect(addWorkingDays("2026-09-26", 1)).toBe("2026-09-28");   // Saturday → Monday
    expect(workingDaysBetween("2026-09-26", "2026-09-27")).toBe(1); // never fewer than one
  });
  it("a painter who works Saturdays keeps them", () => {
    expect(isWorkingDay("2026-09-26", { saturday: true })).toBe(true);
    expect(isWorkingDay("2026-09-27", { saturday: true })).toBe(false);
    expect(addWorkingDays("2026-09-21", 7, { saturday: true })).toBe("2026-09-28");   // Mon–Sat + Mon
    expect(addWorkingDays("2026-09-21", 7, { saturday: true, sunday: true })).toBe("2026-09-27");
  });
});

