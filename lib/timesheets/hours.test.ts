import { describe, expect, test } from "vitest";
import { allocatedHours, labourCents, melbourneClock, melbourneDay, payrollCsv, workedHours } from "./hours";

describe("timesheet hours (Session 6)", () => {
  test("a 07:00–15:06 day with a 30-minute break is 7.6 hours — the brief's acceptance figure", () => {
    expect(workedHours("2026-09-17T07:00:00+10:00", "2026-09-17T15:06:00+10:00", 30)).toBe(7.6);
  });

  test("an open entry has no hours yet", () => {
    expect(workedHours("2026-09-17T07:00:00+10:00", null, 30)).toBeNull();
  });

  test("hours round to two places and the break comes off the span", () => {
    expect(workedHours("2026-09-17T07:00:00+10:00", "2026-09-17T07:20:00+10:00", 0)).toBe(0.33);
    expect(workedHours("2026-09-17T07:00:00+10:00", "2026-09-17T16:00:00+10:00", 60)).toBe(8);
  });

  test("labour cents = hours × the cost rate, to the cent", () => {
    // 7.6 h at $52.50/h = $399.00
    expect(labourCents(7.6, 5250)).toBe(39900);
    // 0.33 h at $52.50 = $17.325 → 1733 cents
    expect(labourCents(0.33, 5250)).toBe(1733);
  });

  test("the work day is the Melbourne day, not the UTC one (a 07:00 AEST start is 21:00 UTC the day before)", () => {
    expect(melbourneDay("2026-09-16T21:00:00Z")).toBe("2026-09-17");
    expect(melbourneClock("2026-09-16T21:00:00Z")).toBe("07:00");
  });

  test("the payroll CSV carries hours only — no rate, no pay, no cents column", () => {
    const csv = payrollCsv([{
      painter: "Alfa Painter", woRef: "WO-TEST1", workDate: "2026-09-17",
      startedAt: "2026-09-17T07:00:00+10:00", finishedAt: "2026-09-17T15:06:00+10:00",
      breakMinutes: 30, source: "pc", approvedAt: "2026-09-17T16:00:00+10:00",
    }]);
    expect(csv.split("\n")[0]).toBe("painter,job,date,start,finish,break_minutes,hours,source,approved_at");
    expect(csv).toContain("Alfa Painter,WO-TEST1,2026-09-17,07:00,15:06,30,7.60,pc,");
    expect(csv).not.toMatch(/rate|pay|cents|\$/i);
  });

  test("a painter name with a comma is quoted", () => {
    const csv = payrollCsv([{
      painter: 'Painter, "Alfa"', woRef: "WO-1", workDate: "2026-09-17",
      startedAt: "2026-09-17T07:00:00+10:00", finishedAt: "2026-09-17T08:00:00+10:00",
      breakMinutes: 0, source: "painter", approvedAt: "2026-09-17T16:00:00+10:00",
    }]);
    expect(csv).toContain('"Painter, ""Alfa""",WO-1');
  });

  test("allocated hours sum the document's surfaces, the same way employee_jobs() does", () => {
    expect(allocatedHours({ areas: [{ surfaces: [{ hours: 2 }, { hours: 1.5 }] }, { surfaces: [{ hours: "4" }] }] })).toBe(7.5);
    expect(allocatedHours(null)).toBe(0);
    expect(allocatedHours({ areas: "nope" })).toBe(0);
  });
});
