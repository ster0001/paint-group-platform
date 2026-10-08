import { describe, expect, test } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { jobDays } from "@/lib/workorder/jobRhythm";
import { DEFAULT_DEFECT_TAPE_RULES, defectTapeDue, mergeDefectTapeRules } from "./defectTape";

// Tom, 8 Oct 2026. October 2026: Thu 1, Fri 2, Sat 3, Sun 4 (daylight saving starts), Mon 5 … Wed 14.
const rules = DEFAULT_DEFECT_TAPE_RULES;
const none = new Set<string>();
// Wed 30 Sep → Wed 7 Oct: six working days; two before the end is Mon 5, the first weekday on AEDT.
const six = jobDays("2026-09-30", "2026-10-07");

describe("defect-tape timing — Melbourne wall clock, measured from the zone", () => {
  test("ships at 9:00 am (until noon) and 3:30 pm (until 7 pm)", () => {
    expect(rules).toEqual({ morning: "09:00", morningUntil: "12:00", afternoon: "15:30", afternoonUntil: "19:00" });
  });
  test("3–6 days: the morning text from 9:00 am AEDT on the day — 22:00 UTC the day before", () => {
    expect(defectTapeDue(six, new Date("2026-10-04T22:00:00Z"), rules, none)).toEqual({ id: "am", date: "2026-10-05" });
    // 9:30 am AEDT; a hardcoded +10:00 would read 8:30 am and wait.
    expect(defectTapeDue(six, new Date("2026-10-04T22:30:00Z"), rules, none)).toEqual({ id: "am", date: "2026-10-05" });
    expect(defectTapeDue(six, new Date("2026-10-04T21:59:00Z"), rules, none)).toBeNull();
  });
  test("a morning missed by noon is not sent late", () => {
    // 12:30 pm AEDT; a hardcoded +10:00 would read 11:30 am and send.
    expect(defectTapeDue(six, new Date("2026-10-05T01:30:00Z"), rules, none)).toBeNull();
  });
  test("3–6 days: the afternoon text from 3:30 pm, once", () => {
    const pm = melbourneInstant(2026, 10, 5, 15, 30);
    expect(pm.toISOString()).toBe("2026-10-05T04:30:00.000Z");
    expect(defectTapeDue(six, pm, rules, new Set(["am"]))).toEqual({ id: "pm", date: "2026-10-05" });
    expect(defectTapeDue(six, pm, rules, new Set(["am", "pm"]))).toBeNull();
    expect(defectTapeDue(six, melbourneInstant(2026, 10, 5, 19, 0), rules, new Set(["am"]))).toBeNull();
  });
  test("once each: a claimed morning text is not sent again", () => {
    expect(defectTapeDue(six, melbourneInstant(2026, 10, 5, 10, 0), rules, new Set(["am"]))).toBeNull();
  });
  test("7+ days: one morning text three working days before the end, no afternoon one", () => {
    const ten = jobDays("2026-10-01", "2026-10-14");
    expect(defectTapeDue(ten, melbourneInstant(2026, 10, 9, 9, 0), rules, none)).toEqual({ id: "am", date: "2026-10-09" });
    expect(defectTapeDue(ten, melbourneInstant(2026, 10, 9, 15, 30), rules, new Set(["am"]))).toBeNull();
    expect(defectTapeDue(ten, melbourneInstant(2026, 10, 12, 9, 0), rules, none)).toBeNull();
  });
  test("a moved end date moves the day — the plan is read from the dates at send time", () => {
    // The same six working days moved to Thu 1 → Thu 8: the finish is a day later, and so is the text.
    const moved = jobDays("2026-10-01", "2026-10-08");
    expect(defectTapeDue(moved, melbourneInstant(2026, 10, 5, 9, 0), rules, none)).toBeNull();
    expect(defectTapeDue(moved, melbourneInstant(2026, 10, 6, 9, 0), rules, none)).toEqual({ id: "am", date: "2026-10-06" });
  });
  test("short jobs and other days: nothing", () => {
    expect(defectTapeDue(jobDays("2026-10-05", "2026-10-06"), melbourneInstant(2026, 10, 5, 9, 0), rules, none)).toBeNull();
    expect(defectTapeDue(six, melbourneInstant(2026, 10, 6, 9, 0), rules, none)).toBeNull();
  });
  test("the times come from the defect_tape_rules row; a malformed field keeps its default", () => {
    expect(mergeDefectTapeRules(null)).toEqual(rules);
    expect(mergeDefectTapeRules({ morning: "08:30", afternoon: "3:30", afternoonUntil: 19 })).toEqual({ ...rules, morning: "08:30" });
    const allDay = mergeDefectTapeRules({ morning: "00:01", morningUntil: "23:59" });
    expect(defectTapeDue(six, melbourneInstant(2026, 10, 5, 0, 30), allDay, none)).toEqual({ id: "am", date: "2026-10-05" });
  });
});
