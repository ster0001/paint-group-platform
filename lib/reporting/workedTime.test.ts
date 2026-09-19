/**
 * Dashboard 0c — the blended hours rule (Tom, 19 Sep 2026), and the migration
 * that captures its inputs. The rule is pure; the file pins are what a hand
 * paste cannot be trusted to keep.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageLine, isCalibrationEvidence, scheduleDays, sourceLabel, workedTime } from "./workedTime";

describe("scheduleDays", () => {
  it("counts booked weekdays inclusive, skipping the weekend unless the painter works it", () => {
    // Mon 14 Sep → Fri 18 Sep 2026 = 5; through Sun 20 = still 5; Saturdays on = 6; both = 7.
    expect(scheduleDays("2026-09-14", "2026-09-18")).toBe(5);
    expect(scheduleDays("2026-09-14", "2026-09-20")).toBe(5);
    expect(scheduleDays("2026-09-14", "2026-09-20", { worksSaturday: true })).toBe(6);
    expect(scheduleDays("2026-09-14", "2026-09-20", { worksSaturday: true, worksSunday: true })).toBe(7);
  });
  it("a one-day booking is one day; an inverted or malformed range is zero", () => {
    expect(scheduleDays("2026-09-15", "2026-09-15")).toBe(1);
    expect(scheduleDays("2026-09-18", "2026-09-14")).toBe(0);
    expect(scheduleDays("nope", "2026-09-14")).toBe(0);
  });
});

describe("workedTime — the blended rule", () => {
  const booking = { startDate: "2026-09-14", endDate: "2026-09-18" };

  it("an entered row wins, verbatim, whatever the schedule says", () => {
    expect(workedTime({ entered: { days: 3, hours: 26.5 }, booking, dayHours: 8 }))
      .toEqual({ days: 3, hours: 26.5, source: "entered" });
  });
  it("no entry → the schedule: booked days × the day length", () => {
    expect(workedTime({ booking, dayHours: 8 })).toEqual({ days: 5, hours: 40, source: "schedule" });
    expect(workedTime({ booking, dayHours: 7.5 })).toEqual({ days: 5, hours: 37.5, source: "schedule" });
  });
  it("finished early: counting stops on the day of the last tick, and the estimate caps it", () => {
    expect(workedTime({ booking, finishedOn: "2026-09-16", dayHours: 8 }))
      .toEqual({ days: 3, hours: 24, source: "schedule" });
    expect(workedTime({ booking, finishedOn: "2026-09-16", estimateHours: 20, dayHours: 8 }))
      .toEqual({ days: 3, hours: 20, source: "schedule" });
    // Not finished yet: nothing is capped, the whole booking counts.
    expect(workedTime({ booking, estimateHours: 20, dayHours: 8 })).toEqual({ days: 5, hours: 40, source: "schedule" });
  });
  it("extensions are already in the booking's end date — a longer booking is more days", () => {
    expect(workedTime({ booking: { startDate: "2026-09-14", endDate: "2026-09-22" }, dayHours: 8 }))
      .toEqual({ days: 7, hours: 56, source: "schedule" });
  });
  it("the painter's weekend counts only when they work it", () => {
    const wk = { startDate: "2026-09-14", endDate: "2026-09-19" };
    expect(workedTime({ booking: wk, dayHours: 8 }).days).toBe(5);
    expect(workedTime({ booking: wk, dayHours: 8, worksSaturday: true }).days).toBe(6);
  });
  it("a booking with no dates is an honest zero, flagged incomplete — never a fake number", () => {
    expect(workedTime({ booking: null, dayHours: 8 })).toEqual({ days: 0, hours: 0, source: "schedule", incomplete: true });
    expect(workedTime({ booking: { startDate: "2026-09-14", endDate: null }, dayHours: 8 }).incomplete).toBe(true);
  });
  it("an entry of zero days is not an entry", () => {
    expect(workedTime({ entered: { days: 0, hours: 0 }, booking, dayHours: 8 }).source).toBe("schedule");
  });
});

describe("what the tiles say", () => {
  it("only entered rows are calibration evidence", () => {
    expect(isCalibrationEvidence({ days: 1, hours: 8, source: "entered" })).toBe(true);
    expect(isCalibrationEvidence({ days: 1, hours: 8, source: "schedule" })).toBe(false);
  });
  it("the coverage line never hides the blend", () => {
    const times = [
      { days: 1, hours: 8, source: "entered" as const }, { days: 1, hours: 8, source: "schedule" as const },
      { days: 1, hours: 8, source: "schedule" as const },
    ];
    expect(coverageLine(times)).toBe("actual on 1 of 3 jobs, schedule on 2");
    expect(coverageLine([])).toBe("no jobs in range");
    expect(sourceLabel("entered")).toBe("Entered by the painter");
    expect(sourceLabel("schedule")).toBe("From the schedule");
  });
});

describe("migration 20270178 — the inputs are captured", () => {
  const FILE = "20270178000000_dashboard_capture_workorders.sql";
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");
  it("the last tick writes all_surfaces_done once", () => {
    expect(sql).toMatch(/type = 'all_surfaces_done'[\s\S]*?insert into public\.wo_events[\s\S]*?'all_surfaces_done'/);
  });
  it("the entered source is the only value the worked-hours table accepts", () => {
    expect(sql).toContain("check (source in ('entered'))");
  });
  it("an opted-out contractor's entry is refused by the server, not just hidden", () => {
    expect(sql).toContain("if not coalesce(v_on, false) then return 'error:not_asked'; end if;");
  });
  it("attempt_no is one plus the failed checks before it", () => {
    expect(sql).toMatch(/select 1 \+ count\(\*\) into new\.attempt_no[\s\S]*?c\.result = 'fail'/);
  });
  it("the booked end is frozen at acceptance and a grown span is an event", () => {
    expect(sql).toContain("if new.state = 'accepted' and new.booked_end_date is null then");
    expect(sql).toMatch(/if v_new_span > v_old_span then[\s\S]*?'booking_extended'/);
  });
  it("both new tables have policies in the same file, and it registers itself", () => {
    expect(sql).toContain("create policy review_requests_staff on public.review_requests");
    expect(sql).toContain("create policy wo_worked_hours_own on public.wo_worked_hours");
    expect(sql).toContain(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`);
  });
});
