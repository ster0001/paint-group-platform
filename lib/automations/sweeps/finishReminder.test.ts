import { describe, expect, test } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { DEFAULT_FINISH_REMINDER_RULES, finishReminderDue, mergeFinishReminderRules } from "./finishReminder";

/**
 * Tom, 19 Oct 2026: "a reminder text message 2 business days before the job
 * is completed reminding of the final walk through date and to change in the
 * app if they are running behind or ahead of schedule."
 *
 * October 2026: Thu 1, Fri 2, Sat 3, Sun 4 (daylight saving starts), Mon 5 …
 * The timing is the Melbourne wall clock, measured from the zone.
 */
const rules = DEFAULT_FINISH_REMINDER_RULES;
const none = new Set<string>();
const noHolidays = new Set<string>();

describe("the painter's finish reminder — two business days before the walkthrough", () => {
  test("ships at 7:30 am until noon", () => {
    expect(rules).toEqual({ from: "07:30", until: "12:00" });
  });
  test("a Wednesday walkthrough is reminded on the Monday, from 7:30 am AEDT (20:30 UTC the night before)", () => {
    expect(finishReminderDue("2026-10-07", new Date("2026-10-04T20:30:00Z"), rules, noHolidays, none)).toEqual({ walkthroughDay: "2026-10-07", reminderDay: "2026-10-05" });
    // 7:29 am: not yet. A hardcoded +10:00 would read 6:30 am and wait an hour.
    expect(finishReminderDue("2026-10-07", new Date("2026-10-04T20:29:00Z"), rules, noHolidays, none)).toBeNull();
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 5, 9), rules, noHolidays, none)).toEqual({ walkthroughDay: "2026-10-07", reminderDay: "2026-10-05" });
  });
  test("a Monday walkthrough is reminded on the Thursday before — the weekend is not business days", () => {
    expect(finishReminderDue("2026-10-05", melbourneInstant(2026, 10, 1, 9), rules, noHolidays, none)).toEqual({ walkthroughDay: "2026-10-05", reminderDay: "2026-10-01" });
    expect(finishReminderDue("2026-10-05", melbourneInstant(2026, 10, 2, 9), rules, noHolidays, none)).toBeNull();
  });
  test("a public holiday is skipped like a weekend", () => {
    // Fri 2 Oct a holiday: Mon 5's two business days before are Thu 1 and Wed 30 Sep.
    expect(finishReminderDue("2026-10-05", melbourneInstant(2026, 9, 30, 9), rules, new Set(["2026-10-02"]), none)).toEqual({ walkthroughDay: "2026-10-05", reminderDay: "2026-09-30" });
    expect(finishReminderDue("2026-10-05", melbourneInstant(2026, 10, 1, 9), rules, new Set(["2026-10-02"]), none)).toBeNull();
  });
  test("a morning missed by noon is not sent late; other days get nothing", () => {
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 5, 12, 0), rules, noHolidays, none)).toBeNull();
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 6, 9), rules, noHolidays, none)).toBeNull();
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 7, 9), rules, noHolidays, none)).toBeNull();
  });
  test("once per walkthrough day: a claimed day is not sent again, a moved date is a new one", () => {
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 5, 9), rules, noHolidays, new Set(["2026-10-07"]))).toBeNull();
    expect(finishReminderDue("2026-10-08", melbourneInstant(2026, 10, 6, 9), rules, noHolidays, new Set(["2026-10-07"]))).toEqual({ walkthroughDay: "2026-10-08", reminderDay: "2026-10-06" });
  });
  test("no walkthrough day, no text", () => {
    expect(finishReminderDue(null, melbourneInstant(2026, 10, 5, 9), rules, noHolidays, none)).toBeNull();
  });
  test("the window comes from the finish_reminder_rules row; a malformed field keeps its default", () => {
    expect(mergeFinishReminderRules(null)).toEqual(rules);
    expect(mergeFinishReminderRules({ from: "06:00", until: 12 })).toEqual({ from: "06:00", until: "12:00" });
    const allDay = mergeFinishReminderRules({ from: "00:01", until: "23:59" });
    expect(finishReminderDue("2026-10-07", melbourneInstant(2026, 10, 5, 0, 30), allDay, noHolidays, none)).not.toBeNull();
  });
});
