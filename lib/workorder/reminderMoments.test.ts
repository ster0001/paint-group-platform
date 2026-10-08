import { describe, expect, test } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { jobDays } from "./jobRhythm";
import {
  DEFAULT_JOB_UPDATE_RULES, decideSend, headsUpDue, mergeJobUpdateRules, momentState, planMoments, reconcilePlan, sendTimes, withinSendingWindow,
  type MomentRow,
} from "./reminderMoments";

const rules = DEFAULT_JOB_UPDATE_RULES;
const row = (over: Partial<MomentRow> = {}): MomentRow => ({
  id: "m", workOrderId: "w", kind: "day1", day: "2026-10-12", dueAt: melbourneInstant(2026, 10, 12, 7, 30).toISOString(),
  sendsCount: 0, lastSentAt: null, answeredAt: null, skippedReason: null, ...over,
});

describe("planMoments — the §4.2 schedule, from the one planner", () => {
  // Mon 12 Oct 2026 is a Monday; weekends are not booked days by default.
  const plan = (start: string, end: string) => planMoments(jobDays(start, end)).map((m) => `${m.kind}@${m.day} ${m.dueAt.toISOString()}`);
  test("1 day: 7:30 and 3:30 the same day", () => {
    expect(plan("2026-10-12", "2026-10-12")).toEqual(["day1@2026-10-12 2026-10-11T20:30:00.000Z", "day1_pm@2026-10-12 2026-10-12T04:30:00.000Z"]);
  });
  test("2 days: day 1 at 7:30, day 2 at 3:30", () => {
    expect(plan("2026-10-12", "2026-10-13")).toEqual(["day1@2026-10-12 2026-10-11T20:30:00.000Z", "day2@2026-10-13 2026-10-13T04:30:00.000Z"]);
  });
  test("5 days: day 1, half way (day 3) and the last day", () => {
    expect(plan("2026-10-12", "2026-10-16").map((s) => s.split(" ")[0])).toEqual(["day1@2026-10-12", "mid@2026-10-14", "last@2026-10-16"]);
  });
  test("9 days: day 1, 30% (day 3), 60% (day 6) and the last day", () => {
    expect(plan("2026-10-12", "2026-10-22").map((s) => s.split(" ")[0])).toEqual(["day1@2026-10-12", "mid30@2026-10-14", "mid60@2026-10-19", "last@2026-10-22"]);
  });
});

describe("sendTimes — the ⚑5 follow-ups", () => {
  test("a 7:30 moment: 10:30 and 1:30; a 3:30 moment: 5:30 and 7:00", () => {
    const hhmm = (d: Date) => d.toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false });
    expect(sendTimes(row(), rules).map(hhmm)).toEqual(["07:30", "10:30", "13:30"]);
    expect(sendTimes(row({ kind: "last", dueAt: melbourneInstant(2026, 10, 12, 15, 30).toISOString() }), rules).map(hhmm)).toEqual(["15:30", "17:30", "19:00"]);
  });
  test("maxTexts caps the list", () => {
    expect(sendTimes(row(), { ...rules, maxTexts: 1 })).toHaveLength(1);
  });
});

describe("decideSend", () => {
  const m = row();
  test("the first text at the moment, not before", () => {
    expect(decideSend(m, melbourneInstant(2026, 10, 12, 7, 0), rules)).toEqual({ send: false, why: "not_due" });
    expect(decideSend(m, melbourneInstant(2026, 10, 12, 7, 31), rules)).toEqual({ send: true, which: 1 });
  });
  test("the second at 10:30, the third at 1:30, then never again (R8: up to three)", () => {
    expect(decideSend({ ...m, sendsCount: 1 }, melbourneInstant(2026, 10, 12, 9, 0), rules)).toEqual({ send: false, why: "too_soon" });
    expect(decideSend({ ...m, sendsCount: 1 }, melbourneInstant(2026, 10, 12, 10, 30), rules)).toEqual({ send: true, which: 2 });
    expect(decideSend({ ...m, sendsCount: 2 }, melbourneInstant(2026, 10, 12, 13, 30), rules)).toEqual({ send: true, which: 3 });
    expect(decideSend({ ...m, sendsCount: 3 }, melbourneInstant(2026, 10, 12, 16, 0), rules)).toEqual({ send: false, why: "max" });
  });
  test("answered or skipped: nothing more (R8 'they stop the moment the update is in')", () => {
    expect(decideSend({ ...m, answeredAt: "2026-10-11T22:00:00Z" }, melbourneInstant(2026, 10, 12, 10, 30), rules)).toEqual({ send: false, why: "answered" });
    expect(decideSend({ ...m, skippedReason: "no_work" }, melbourneInstant(2026, 10, 12, 10, 30), rules)).toEqual({ send: false, why: "skipped" });
  });
  test("nothing after 7:00 pm, and nothing on another day — a missed day is not caught up", () => {
    const pm = row({ kind: "last", dueAt: melbourneInstant(2026, 10, 12, 15, 30).toISOString(), sendsCount: 2 });
    expect(decideSend(pm, melbourneInstant(2026, 10, 12, 19, 0), rules)).toEqual({ send: true, which: 3 });
    expect(decideSend(pm, melbourneInstant(2026, 10, 12, 19, 6), rules)).toEqual({ send: false, why: "after_hours" });
    expect(decideSend(m, melbourneInstant(2026, 10, 13, 9, 0), rules)).toEqual({ send: false, why: "other_day" });
    expect(withinSendingWindow(melbourneInstant(2026, 10, 12, 19, 5), rules)).toBe(true);
    expect(withinSendingWindow(melbourneInstant(2026, 10, 12, 19, 6), rules)).toBe(false);
  });
});

describe("reconcilePlan — dates move, past moments never do", () => {
  const now = melbourneInstant(2026, 10, 13, 9, 0); // Tue, during a job booked Mon–Fri
  const plan5 = planMoments(jobDays("2026-10-12", "2026-10-16"));
  test("a fresh job: every moment inserted", () => {
    expect(reconcilePlan([], plan5, now).insert.map((p) => p.kind)).toEqual(["day1", "mid", "last"]);
  });
  test("the job extends to the next Monday: mid and last move, day 1 (sent) stays", () => {
    const existing = [
      row({ id: "a", kind: "day1", day: "2026-10-12", sendsCount: 1 }),
      row({ id: "b", kind: "mid", day: "2026-10-14", dueAt: melbourneInstant(2026, 10, 14, 15, 30).toISOString() }),
      row({ id: "c", kind: "last", day: "2026-10-16", dueAt: melbourneInstant(2026, 10, 16, 15, 30).toISOString() }),
    ];
    const r = reconcilePlan(existing, planMoments(jobDays("2026-10-12", "2026-10-19")), now);
    expect(r.insert).toEqual([]);
    expect(r.move.map((x) => `${x.id}→${x.day}`)).toEqual(["b→2026-10-15", "c→2026-10-19"]);
    expect(r.skip).toEqual([]);
  });
  test("a 5-day job cut to 2 days: mid and last (not yet happened) are skipped as rescheduled; day2 is inserted", () => {
    const existing = [
      row({ id: "a", kind: "day1", day: "2026-10-12", sendsCount: 1 }),
      row({ id: "b", kind: "mid", day: "2026-10-14", dueAt: melbourneInstant(2026, 10, 14, 15, 30).toISOString() }),
      row({ id: "c", kind: "last", day: "2026-10-16", dueAt: melbourneInstant(2026, 10, 16, 15, 30).toISOString() }),
    ];
    const r = reconcilePlan(existing, planMoments(jobDays("2026-10-12", "2026-10-13")), now);
    expect(r.insert.map((p) => p.kind)).toEqual(["day2"]);
    expect(r.skip.sort()).toEqual(["b", "c"]);
  });
  test("a moment whose day passed with no text is marked not_sent — never a miss", () => {
    const existing = [row({ id: "a", kind: "day1", day: "2026-10-12", sendsCount: 0 })];
    expect(reconcilePlan(existing, plan5, now).notSent).toEqual(["a"]);
    expect(reconcilePlan([row({ id: "a", kind: "day1", day: "2026-10-12", sendsCount: 2 })], plan5, now).notSent).toEqual([]);
  });
});

describe("words and rules", () => {
  test("momentState", () => {
    const now = melbourneInstant(2026, 10, 13, 9, 0);
    expect(momentState(row({ day: "2026-10-13" }), now)).toBe("due");
    expect(momentState(row({ day: "2026-10-14" }), now)).toBe("upcoming");
    expect(momentState(row({ day: "2026-10-12", answeredAt: "x" }), now)).toBe("answered");
    expect(momentState(row({ day: "2026-10-12" }), now)).toBe("missed");
    expect(momentState(row({ skippedReason: "no_work" }), now)).toBe("skipped");
    // R10: a day marked no work leaves the count even if an update landed on it.
    expect(momentState(row({ skippedReason: "no_work", answeredAt: "x" }), now)).toBe("skipped");
  });
  test("mergeJobUpdateRules tolerates a malformed row", () => {
    expect(mergeJobUpdateRules(null)).toEqual(rules);
    expect(mergeJobUpdateRules({ morningFollowUps: ["9:00"], lastSend: "18:30", maxTexts: 9 })).toEqual({ ...rules, lastSend: "18:30" });
  });
});

describe("the morning heads-up on a 3:30 pm day (Tom, 8 Oct)", () => {
  // Thu 1 → Fri 9 Oct 2026 is seven working days; 30% lands on Mon 5, the first weekday of daylight saving.
  const seven = jobDays("2026-10-01", "2026-10-09");
  test("ships at 7:30 am until noon, Melbourne", () => {
    expect(rules.headsUp).toBe("07:30");
    expect(rules.headsUpUntil).toBe("12:00");
  });
  test("due from 7:30 am AEDT on Mon 5 Oct — 20:30 UTC the day before, measured from the zone", () => {
    expect(headsUpDue(seven, new Date("2026-10-04T20:30:00Z"), rules)).toEqual({ forKind: "mid30", day: "2026-10-05" });
    // 8:00 am AEDT; a hardcoded +10:00 would read 7:00 am and wait.
    expect(headsUpDue(seven, new Date("2026-10-04T21:00:00Z"), rules)).toEqual({ forKind: "mid30", day: "2026-10-05" });
    expect(headsUpDue(seven, new Date("2026-10-04T20:15:00Z"), rules)).toBeNull();
  });
  test("never after noon: a missed morning is not sent in the afternoon", () => {
    // 12:30 pm AEDT; a hardcoded +10:00 would read 11:30 am and send.
    expect(headsUpDue(seven, new Date("2026-10-05T01:30:00Z"), rules)).toBeNull();
  });
  test("nothing on day 1 (it has its own 7:30 text) or on a day with no 3:30 moment", () => {
    expect(headsUpDue(seven, melbourneInstant(2026, 10, 1, 8, 0), rules)).toBeNull();
    expect(headsUpDue(seven, melbourneInstant(2026, 10, 6, 8, 0), rules)).toBeNull();
    expect(headsUpDue(seven, melbourneInstant(2026, 10, 7, 8, 0), rules)).toEqual({ forKind: "mid60", day: "2026-10-07" });
    expect(headsUpDue(seven, melbourneInstant(2026, 10, 9, 8, 0), rules)).toEqual({ forKind: "last", day: "2026-10-09" });
  });
  test("the times come from the job_update_rules row; a malformed one keeps the default", () => {
    const early = mergeJobUpdateRules({ headsUp: "00:01", headsUpUntil: "23:59" });
    expect(headsUpDue(seven, melbourneInstant(2026, 10, 5, 0, 30), early)).toEqual({ forKind: "mid30", day: "2026-10-05" });
    expect(mergeJobUpdateRules({ headsUp: "7:30", headsUpUntil: 12 })).toMatchObject({ headsUp: "07:30", headsUpUntil: "12:00" });
  });
});
