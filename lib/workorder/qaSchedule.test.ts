import { test, expect } from "vitest";
import {
  QA_DEFAULT_TIME, defaultQaWhen, qaCheckLabel, qaWhenMessage, qaWhenProblem, workingDayBefore,
} from "./qaSchedule";
import { melbourneDate } from "./console";

/**
 * Tom, 8 Oct 2026: the quality check sits before the final walkthrough and
 * follows it. The rule (twin of wo_qa_place_open_checks, 20270247): the
 * WORKING day before the final — Mon–Fri, public holidays skipped — at the
 * check's own time, else 09:00.
 */
const none = new Set<string>();

test("the working day before a weekday final is the day before", () => {
  expect(workingDayBefore("2026-10-15", none)).toBe("2026-10-14"); // Thu → Wed
});

test("a Monday final puts the check on the Friday before, never the weekend", () => {
  expect(workingDayBefore("2026-10-12", none)).toBe("2026-10-09");
  // A weekend final (rare, but a works-Saturday painter books one) still lands on a weekday.
  expect(workingDayBefore("2026-10-11", none)).toBe("2026-10-09"); // Sun → Fri
  expect(workingDayBefore("2026-10-10", none)).toBe("2026-10-09"); // Sat → Fri
});

test("public holidays are skipped — Easter Monday final, check on the Thursday before Good Friday", () => {
  const easter = new Set(["2026-04-03", "2026-04-06"]);
  expect(workingDayBefore("2026-04-07", easter)).toBe("2026-04-02");
});

test("month and year boundaries", () => {
  expect(workingDayBefore("2026-11-02", none)).toBe("2026-10-30");          // Mon 2 Nov → Fri 30 Oct
  expect(workingDayBefore("2027-01-04", new Set(["2027-01-01"]))).toBe("2026-12-31");
});

test("daylight saving changes nothing — dates are calendar days, not 24-hour steps", () => {
  // Melbourne goes to +11 at 2am Sun 4 Oct 2026 and back to +10 at 3am Sun 5 Apr 2026.
  expect(workingDayBefore("2026-10-05", none)).toBe("2026-10-02");
  expect(workingDayBefore("2026-04-06", none)).toBe("2026-04-03");
  // "Today" in Melbourne across both changes (a UTC slice would say yesterday).
  expect(melbourneDate(new Date("2026-10-04T14:30:00Z"))).toBe("2026-10-05"); // 01:30 AEDT Mon
  expect(melbourneDate(new Date("2026-04-05T13:30:00Z"))).toBe("2026-04-05"); // 23:30 AEST Sun
});

test("default placement keeps the check's own time, else 09:00", () => {
  expect(QA_DEFAULT_TIME).toBe("09:00");
  expect(defaultQaWhen("2026-10-12", none)).toEqual({ date: "2026-10-09", time: "09:00" });
  expect(defaultQaWhen("2026-10-12", none, "13:30")).toEqual({ date: "2026-10-09", time: "13:30" });
});

test("a check must be strictly before the booked final", () => {
  const final = { date: "2026-10-15", time: "15:30" };
  const today = "2026-10-08";
  expect(qaWhenProblem({ date: "2026-10-14", time: "09:00" }, final, today)).toBeNull();
  expect(qaWhenProblem({ date: "2026-10-15", time: "09:00" }, final, today)).toBeNull();      // same morning
  expect(qaWhenProblem({ date: "2026-10-15", time: "15:30" }, final, today)).toBe("after_final");
  expect(qaWhenProblem({ date: "2026-10-16", time: "08:00" }, final, today)).toBe("after_final");
  // A final with no agreed time: the check needs an earlier DAY.
  expect(qaWhenProblem({ date: "2026-10-15", time: "08:00" }, { date: "2026-10-15", time: null }, today)).toBe("after_final");
});

test("a day already gone is refused; no final booked means only the past is refused", () => {
  expect(qaWhenProblem({ date: "2026-10-07", time: "09:00" }, null, "2026-10-08")).toBe("past");
  expect(qaWhenProblem({ date: "2026-10-08", time: "09:00" }, null, "2026-10-08")).toBeNull();
  expect(qaWhenProblem({ date: "2026-12-01", time: "09:00" }, null, "2026-10-08")).toBeNull();
  expect(qaWhenProblem({ date: "2026-10-09", time: null }, null, "2026-10-08")).toBe("no_time");
});

test("every refusal has words for the office", () => {
  for (const p of ["past", "after_final", "no_time", "already_recorded", "closed"] as const) {
    expect(qaWhenMessage(p)).toMatch(/\w/);
  }
  expect(qaWhenMessage("after_final")).toMatch(/before the final walkthrough/i);
});

test("the main check and the extras have their own names", () => {
  expect(qaCheckLabel("final")).toBe("Quality check");
  expect(qaCheckLabel("mid")).toBe("Site check-in");
  expect(qaCheckLabel("spot")).toBe("Spot check");
  expect(qaCheckLabel("day_one")).toBe("Day-one check");
});
