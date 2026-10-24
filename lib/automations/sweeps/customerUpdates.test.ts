import { describe, expect, it } from "vitest";
import { dueNow, notesDue } from "./customerUpdates";

const base = { today: "2026-10-07", hhmm: "10:00", checkinPct: 0.4, checkinMinDays: 3, checkinTime: "09:00", defectTime: "07:30" };
const week5 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

describe("notesDue — which notes a job is due today (Step 3)", () => {
  it("a five-day job: the check-in on day 3 from 9:00, the defect day on day 3 too (two working days before the last)", () => {
    expect(notesDue({ days: week5 }, base)).toEqual(["checkin_40", "defect_day"]);
    expect(notesDue({ days: week5 }, { ...base, hhmm: "08:00" })).toEqual(["defect_day"]);
    expect(notesDue({ days: week5 }, { ...base, hhmm: "07:00" })).toEqual([]);
    expect(notesDue({ days: week5 }, { ...base, today: "2026-10-06" })).toEqual([]);
  });
  it("a two-day job: no check-in, the defect-day note on the last day (R10, R11)", () => {
    const two = ["2026-10-06", "2026-10-07"];
    expect(notesDue({ days: two }, base)).toEqual(["defect_day"]);
    expect(notesDue({ days: two }, { ...base, today: "2026-10-06" })).toEqual([]);
  });
  it("the office's numbers move the check-in", () => {
    expect(notesDue({ days: week5 }, { ...base, today: "2026-10-08", checkinPct: 0.6 })).toEqual(["checkin_40"]);
    expect(notesDue({ days: week5 }, { ...base, checkinMinDays: 6 })).toEqual(["defect_day"]);
  });
});

describe("dueNow — what the auto-send sweep sends", () => {
  const now = new Date("2026-10-07T06:00:00Z"); // 17:00 Melbourne (AEDT)
  const row = (kind: string, minutesAgo: number, extra: Partial<{ for_date: string; work_order_id: string }> = {}) => ({
    id: `${kind}-${minutesAgo}`, work_order_id: extra.work_order_id ?? "job", kind, for_date: extra.for_date ?? "2026-10-07",
    created_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  });
  const opts = { now, bundleMinutes: 5, today: "2026-10-07", hhmm: "17:00", milestoneSentToday: new Set<string>() };

  it("a milestone goes once its bundle window has passed; the two notes go at once", () => {
    const { send, skip } = dueNow([row("surface_milestone", 6), row("surface_milestone", 2), row("checkin_40", 0), row("defect_day", 0)], opts);
    expect(send.map((r) => r.id)).toEqual(["surface_milestone-6", "checkin_40-0", "defect_day-0"]);
    expect(skip).toEqual([]);
  });
  it("the end-of-day summary goes from 16:00, never on a day a milestone already went (⚑2), never for another day", () => {
    expect(dueNow([row("end_of_day", 60)], opts).send).toHaveLength(1);
    expect(dueNow([row("end_of_day", 60)], { ...opts, hhmm: "15:59" }).send).toHaveLength(0);
    expect(dueNow([row("end_of_day", 60)], { ...opts, milestoneSentToday: new Set(["job"]) }).skip).toHaveLength(1);
    expect(dueNow([row("end_of_day", 60, { for_date: "2026-10-06" })], opts).skip).toHaveLength(1);
  });
});
