import { describe, expect, it } from "vitest";
import {
  customerCheckins, customerDefectTapeRungs, dayAt, dayLabel, jobDays, painterMorningHeadsUps, painterUpdateRungs, rungInstant,
} from "./jobRhythm";

// Mon 5 Oct 2026 → Fri 9 Oct is a five-day week; the 10th/11th are a weekend.
const week5 = jobDays("2026-10-05", "2026-10-09");

describe("a job's booked days", () => {
  it("skips the weekend unless the painter works it", () => {
    expect(jobDays("2026-10-05", "2026-10-12")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]);
    expect(jobDays("2026-10-09", "2026-10-12", { worksSaturday: true })).toEqual(["2026-10-09", "2026-10-10", "2026-10-12"]);
    expect(jobDays("2026-10-09", "2026-10-12", { worksSaturday: true, worksSunday: true })).toHaveLength(4);
  });
  it("is empty when the booking has no dates, and one day for a one-day job", () => {
    expect(jobDays(null, "2026-10-09")).toEqual([]);
    expect(jobDays("2026-10-09", "2026-10-09")).toEqual(["2026-10-09"]);
  });
  it("a weekend-only booking for a weekday painter still has its start day", () => {
    expect(jobDays("2026-10-10", "2026-10-11")).toEqual(["2026-10-10"]);
  });
});

describe("N% of the way through", () => {
  it("lands inside the job on three or more days — never day 1 or the last day", () => {
    expect(dayAt(["a", "b", "c"], 0.5)).toBe("b");
    expect(dayAt(["a", "b", "c"], 0.99)).toBe("b");
    expect(dayAt(week5, 0.5)).toBe("2026-10-07");
    expect(dayAt(week5, 0.3)).toBe("2026-10-06");
    expect(dayAt(week5, 0.6)).toBe("2026-10-07");
  });
});

describe("the painter's update reminders (Tom, 25 Sep)", () => {
  it("1–2 days: day 1 at 07:30 and day 2 at 15:30", () => {
    const two = painterUpdateRungs(["2026-10-05", "2026-10-06"]);
    expect(two).toEqual([
      { id: "day1", date: "2026-10-05", hour: 7, minute: 30 },
      { id: "day2", date: "2026-10-06", hour: 15, minute: 30 },
    ]);
    // A one-day job keeps both moments on its one day.
    expect(painterUpdateRungs(["2026-10-05"]).map((r) => [r.id, r.hour])).toEqual([["day1", 7], ["day1_pm", 15]]);
  });
  it("3–6 days: day 1, half way and the last day", () => {
    expect(painterUpdateRungs(week5).map((r) => `${r.id}@${r.date} ${r.hour}:${r.minute}`)).toEqual([
      "day1@2026-10-05 7:30", "mid@2026-10-07 15:30", "last@2026-10-09 15:30",
    ]);
    // Six days is the top of this bracket.
    const six = jobDays("2026-10-05", "2026-10-12");
    expect(painterUpdateRungs(six).map((r) => r.id)).toEqual(["day1", "mid", "last"]);
  });
  it("7+ days: day 1, 30%, 60% and the last day — and beyond 15 days the same pattern", () => {
    const ten = jobDays("2026-10-05", "2026-10-16");
    expect(ten).toHaveLength(10);
    expect(painterUpdateRungs(ten).map((r) => `${r.id}@${r.date}`)).toEqual([
      "day1@2026-10-05", "mid30@2026-10-08", "mid60@2026-10-12", "last@2026-10-16",
    ]);
    const twenty = jobDays("2026-10-05", "2026-10-30");
    expect(painterUpdateRungs(twenty).map((r) => r.id)).toEqual(["day1", "mid30", "mid60", "last"]);
  });
  it("rung instants are Melbourne wall-clock — 07:30 on 5 Oct is 20:30 UTC the day before (AEDT)", () => {
    expect(rungInstant({ date: "2026-10-05", hour: 7, minute: 30 }).toISOString()).toBe("2026-10-04T20:30:00.000Z");
    expect(rungInstant({ date: "2026-10-05", hour: 15, minute: 30 }).toISOString()).toBe("2026-10-05T04:30:00.000Z");
  });
});

describe("the office's customer check-ins (Tom, 25 Sep)", () => {
  it("1–2 days: one follow-up after the job, on its last day", () => {
    expect(customerCheckins(["2026-10-05", "2026-10-06"])).toEqual([{ id: "after", kind: "after", date: "2026-10-06" }]);
  });
  it("3–6 days: a mid-job check-in half way", () => {
    expect(customerCheckins(week5)).toEqual([{ id: "mid50", kind: "mid", date: "2026-10-07", pct: 50 }]);
  });
  it("7+ days: check-ins at 35% and 70%", () => {
    const ten = jobDays("2026-10-05", "2026-10-16");
    expect(customerCheckins(ten)).toEqual([
      { id: "mid35", kind: "mid", date: "2026-10-08", pct: 35 },
      { id: "mid70", kind: "mid", date: "2026-10-13", pct: 70 },
    ]);
  });
  it("says which day of the job a date is", () => {
    expect(dayLabel(week5, "2026-10-07")).toBe("day 3 of 5");
    expect(dayLabel(week5, "2026-10-10")).toBe("");
  });
});

// Tom, 8 Oct 2026. October 2026: Thu 1, Fri 2, Sat 3, Sun 4 (daylight saving starts), Mon 5 … Fri 9, Sat 10, Sun 11, Mon 12.
describe("the painter's morning heads-up (Tom, 8 Oct)", () => {
  it("every day with a 3:30 pm moment gets a morning heads-up; a day that already has a 7:30 text does not", () => {
    expect(painterMorningHeadsUps(week5)).toEqual([
      { forRung: "mid", date: "2026-10-07" },
      { forRung: "last", date: "2026-10-09" },
    ]);
    expect(painterMorningHeadsUps(["2026-10-05", "2026-10-06"])).toEqual([{ forRung: "day2", date: "2026-10-06" }]);
  });
  it("a one-day job's only day already starts with the 7:30 text — no second morning text", () => {
    expect(painterMorningHeadsUps(["2026-10-05"])).toEqual([]);
    expect(painterMorningHeadsUps([])).toEqual([]);
  });
  it("a 7-day job across the weekend and the clock change: 30%, 60% and the last day", () => {
    const seven = jobDays("2026-10-01", "2026-10-09");
    expect(seven).toHaveLength(7);
    expect(painterMorningHeadsUps(seven)).toEqual([
      { forRung: "mid30", date: "2026-10-05" },
      { forRung: "mid60", date: "2026-10-07" },
      { forRung: "last", date: "2026-10-09" },
    ]);
  });
});

describe("the customer's defect-tape text (Tom, 8 Oct)", () => {
  it("jobs of one or two days get none", () => {
    expect(customerDefectTapeRungs([])).toEqual([]);
    expect(customerDefectTapeRungs(["2026-10-05"])).toEqual([]);
    expect(customerDefectTapeRungs(["2026-10-05", "2026-10-06"])).toEqual([]);
  });
  it("3 days: two working days before the end is day 1 — a morning and an afternoon text", () => {
    expect(customerDefectTapeRungs(jobDays("2026-10-05", "2026-10-07"))).toEqual([
      { id: "am", date: "2026-10-05" },
      { id: "pm", date: "2026-10-05" },
    ]);
  });
  it("4 days across a weekend: counts WORKING days back from the end (Fri, not Sun)", () => {
    const four = jobDays("2026-10-01", "2026-10-06");
    expect(four).toEqual(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]);
    expect(customerDefectTapeRungs(four)).toEqual([
      { id: "am", date: "2026-10-02" },
      { id: "pm", date: "2026-10-02" },
    ]);
  });
  it("4 days for a painter who works weekends: the weekend days count", () => {
    const four = jobDays("2026-10-02", "2026-10-05", { worksSaturday: true, worksSunday: true });
    expect(customerDefectTapeRungs(four).map((r) => r.date)).toEqual(["2026-10-03", "2026-10-03"]);
  });
  it("6 days across the weekend and the clock change: two texts on day 4", () => {
    const six = jobDays("2026-09-30", "2026-10-07");
    expect(six).toHaveLength(6);
    expect(customerDefectTapeRungs(six)).toEqual([
      { id: "am", date: "2026-10-05" },
      { id: "pm", date: "2026-10-05" },
    ]);
  });
  it("7 days: one morning text, three working days before the end", () => {
    const seven = jobDays("2026-10-05", "2026-10-13");
    expect(seven).toHaveLength(7);
    expect(customerDefectTapeRungs(seven)).toEqual([{ id: "am", date: "2026-10-08" }]);
  });
  it("10 days across two weekends: three working days back from Wed 14 is Fri 9", () => {
    const ten = jobDays("2026-10-01", "2026-10-14");
    expect(ten).toHaveLength(10);
    expect(customerDefectTapeRungs(ten)).toEqual([{ id: "am", date: "2026-10-09" }]);
  });
});
