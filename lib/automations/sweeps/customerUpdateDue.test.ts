import { describe, expect, it } from "vitest";
import { jobsDueAnUpdate } from "./customerUpdateDue";

/** Tom, 7 Oct 2026: the office is texted/emailed when a customer is due an update — the console card's rule, as a sweep. */
describe("jobsDueAnUpdate", () => {
  const now = new Date("2026-10-07T06:00:00.000Z"); // 7 Oct, 5pm Melbourne
  const daysAgoIso = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it("a job in progress with no update for the setting's days is due; one updated yesterday is not", () => {
    const due = jobsDueAnUpdate({
      workOrders: [
        { id: "quiet", stage: "in_progress", startDate: "2026-09-28" },
        { id: "fresh", stage: "in_progress", startDate: "2026-09-28" },
        { id: "prep", stage: "completion_prep", startDate: "2026-09-28" },
        { id: "closed", stage: "closed", startDate: "2026-09-01" },
        { id: "nostart", stage: "in_progress", startDate: null },
      ],
      draftedWorkOrderIds: [],
      lastUpdateAt: { quiet: daysAgoIso(4), fresh: daysAgoIso(1) },
      everyDays: 3, now,
    });
    expect(due.map((d) => d.workOrderId).sort()).toEqual(["prep", "quiet"]);
    expect(due.find((d) => d.workOrderId === "quiet")?.quietDays).toBe(4);
    expect(due.find((d) => d.workOrderId === "prep")?.quietDays).toBe(9); // from the start date
  });

  it("a drafted update waiting on the office means nobody needs reminding to write one", () => {
    expect(jobsDueAnUpdate({
      workOrders: [{ id: "w", stage: "in_progress", startDate: "2026-09-20" }],
      draftedWorkOrderIds: ["w"], lastUpdateAt: {}, everyDays: 3, now,
    })).toEqual([]);
  });
});
