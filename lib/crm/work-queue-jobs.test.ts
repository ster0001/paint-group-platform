import { describe, expect, it } from "vitest";
import { buildJobCheckinItems, isCustomerVisible, KIND_WEIGHT, type JobCheckinRow } from "./work-queue";
import { melbourneInstant } from "@/lib/time/businessHours";

// Mon 5 Oct → Fri 9 Oct 2026: five booked days → one mid-job check-in on Wed 7 Oct.
const row = (over: Partial<JobCheckinRow> = {}): JobCheckinRow => ({
  id: "wo1", wo_ref: "WO-101", stage: "in_progress", start_date: "2026-10-05", end_date: "2026-10-09",
  wo_snapshot: { jobTitle: "Exterior repaint", jobAddress: "12 Test St, Thornbury" },
  estimates: { account_id: "acc1", accepted_name: "Melissa Hartley", title: null },
  contractors: { company_name: "Brush Co", works_saturday: false, works_sunday: false, profiles: { name: "Sam" } },
  ...over,
});

describe("mid-job check-ins (Tom, 25 Sep 2026)", () => {
  it("does not exist before its day, appears that morning, and is due by 5 pm", () => {
    expect(buildJobCheckinItems([row()], melbourneInstant(2026, 10, 6, 9))).toEqual([]);
    const [item] = buildJobCheckinItems([row()], melbourneInstant(2026, 10, 7, 9));
    expect(item.kind).toBe("job_checkin");
    expect(item.title).toBe("Melissa Hartley — mid-job check-in (50% through, day 3 of 5)");
    expect(item.detail).toContain("WO-101");
    expect(item.detail).toContain("HIGH IMPORTANCE");
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 7, 17).toISOString());
    expect(item.bucket).toBe("today");
    expect(item.action.href).toBe("/pc/wo/wo1");
    // Still there, overdue, the next morning if nobody rang.
    const [late] = buildJobCheckinItems([row()], melbourneInstant(2026, 10, 8, 9));
    expect(late.bucket).toBe("overdue");
  });
  it("is high importance: a customer-visible kind at the top weight", () => {
    expect(isCustomerVisible("job_checkin")).toBe(true);
    expect(KIND_WEIGHT.job_checkin).toBeGreaterThanOrEqual(30);
    const [item] = buildJobCheckinItems([row()], melbourneInstant(2026, 10, 7, 9));
    expect(item.priority).toBeGreaterThanOrEqual(70);
  });
  it("a job of seven or more days gets two, at 35% and 70%", () => {
    const long = row({ start_date: "2026-10-05", end_date: "2026-10-16" });   // 10 booked days
    const items = buildJobCheckinItems([long], melbourneInstant(2026, 10, 16, 9));
    expect(items.map((i) => i.title)).toEqual([
      "Melissa Hartley — mid-job check-in (35% through, day 4 of 10)",
      "Melissa Hartley — mid-job check-in (70% through, day 7 of 10)",
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
  it("goes when the job closes, and never exists for an offer", () => {
    expect(buildJobCheckinItems([row({ stage: "closed" })], melbourneInstant(2026, 10, 8, 9))).toEqual([]);
    expect(buildJobCheckinItems([row({ stage: "offered" })], melbourneInstant(2026, 10, 8, 9))).toEqual([]);
  });
});

describe("the after-job call on a 1–2 day job", () => {
  const short = row({ start_date: "2026-10-05", end_date: "2026-10-06" });
  it("appears once the last booked day has passed, due the next business morning", () => {
    expect(buildJobCheckinItems([short], melbourneInstant(2026, 10, 6, 12))).toEqual([]);
    const [item] = buildJobCheckinItems([short], melbourneInstant(2026, 10, 7, 8));
    expect(item.kind).toBe("job_followup");
    expect(item.title).toBe("Melissa Hartley — job done, check they are happy");
    expect(item.detail).toContain("a 2-day job by Sam");
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 7, 9).toISOString());
  });
  it("appears the moment the job closes, even on its last day", () => {
    const [item] = buildJobCheckinItems([short.stage === "closed" ? short : { ...short, stage: "closed" }], melbourneInstant(2026, 10, 6, 15));
    expect(item.kind).toBe("job_followup");
  });
  it("is history after ten days", () => {
    expect(buildJobCheckinItems([short], melbourneInstant(2026, 10, 20, 9))).toEqual([]);
  });
  it("no mid-job check-in on a short job", () => {
    expect(buildJobCheckinItems([short], melbourneInstant(2026, 10, 6, 9)).some((i) => i.kind === "job_checkin")).toBe(false);
  });
});
