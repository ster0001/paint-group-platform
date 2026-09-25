import { describe, expect, it } from "vitest";
import { jobUpdateLadder } from "./jobReminders";
import { dueRungs } from "../reminders";
import { jobDays } from "@/lib/workorder/jobRhythm";
import { melbourneInstant } from "@/lib/time/businessHours";

// Mon 5 Oct → Fri 9 Oct 2026, a five-day job (3–6 bracket): day 1 07:30, Wed 15:30, Fri 15:30.
const days = jobDays("2026-10-05", "2026-10-09");

describe("the painter's update ladder", () => {
  it("anchors on day 1 at 07:30 Melbourne and measures every rung from there", () => {
    const l = jobUpdateLadder(days)!;
    expect(l.anchor.toISOString()).toBe("2026-10-04T20:30:00.000Z");
    expect(l.rungs.map((r) => `${r.id}+${r.afterHours}h`)).toEqual(["day1+0h", "mid+56h", "last+104h"]);
  });
  it("only the latest due rung fires — a sweep at 4 pm on the last day fires 'last', not the two before it", () => {
    const l = jobUpdateLadder(days)!;
    expect(dueRungs(l.anchor, l.rungs, melbourneInstant(2026, 10, 5, 7, 0)).map((r) => r.id)).toEqual([]);
    expect(dueRungs(l.anchor, l.rungs, melbourneInstant(2026, 10, 5, 7, 45)).map((r) => r.id)).toEqual(["day1"]);
    expect(dueRungs(l.anchor, l.rungs, melbourneInstant(2026, 10, 7, 15, 0)).map((r) => r.id)).toEqual(["day1"]);
    expect(dueRungs(l.anchor, l.rungs, melbourneInstant(2026, 10, 7, 16, 0)).map((r) => r.id)).toEqual(["day1", "mid"]);
    const atEnd = dueRungs(l.anchor, l.rungs, melbourneInstant(2026, 10, 9, 16, 0));
    expect(atEnd[atEnd.length - 1].id).toBe("last");
  });
  it("an unbooked job has no ladder", () => {
    expect(jobUpdateLadder([])).toBeNull();
  });
});
