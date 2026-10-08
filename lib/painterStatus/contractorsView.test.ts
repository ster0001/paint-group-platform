import { describe, expect, test } from "vitest";
import { buildContractorsView, type ContractorsInputs } from "./contractorsView";

const now = new Date("2026-10-09T03:00:00Z");
const base: ContractorsInputs = {
  painters: [
    { id: "a", name: "Marco", employmentType: "contractor", active: true },
    { id: "b", name: "Dan", employmentType: "contractor", active: true },
    { id: "c", name: "Nikos", employmentType: "employee", active: true },
    { id: "d", name: "Gone", employmentType: "contractor", active: false },
  ],
  statuses: [
    { painterId: "a", colour: "green", line: "Your last 4 jobs were all clean.", streak: 6, bestStreak: 6, bonusCounter: 3, measures: { checks: { passedFirstTime: 3, done: 3, band: "yellow" }, reminders: { answered: 12, scored: 12, creditsApplied: 0, band: "yellow" }, callbacks: { scored: 0, band: "yellow" } }, offersClearedAt: null, computedAt: "2026-10-09T02:00:00Z" },
    { painterId: "b", colour: "red", line: "Four call backs.", streak: 0, bestStreak: 2, bonusCounter: 0, measures: { callbacks: { scored: 4, band: "red" } }, offersClearedAt: null, computedAt: "2026-10-09T02:00:00Z" },
    { painterId: "d", colour: "green", line: "x", streak: 4, bestStreak: 4, bonusCounter: 0, measures: {}, offersClearedAt: null, computedAt: "2026-10-09T02:00:00Z" },
  ],
  changes: [{ painterId: "b", at: "2026-10-01T00:00:00Z", to: "red" }, { painterId: "a", at: "2026-08-01T00:00:00Z", to: "yellow" }, { painterId: "a", at: "2026-09-20T00:00:00Z", to: "green" }],
  bonuses: [{ id: "bo1", painterId: "a", status: "due", amountCents: null, decidedAt: null, triggeredAt: "2026-10-08T00:00:00Z" }, { id: "bo2", painterId: "a", status: "paid", amountCents: 50_000, decidedAt: "2026-09-02T00:00:00Z", triggeredAt: "2026-09-01T00:00:00Z" }],
  callbacks: [{ id: "cb1", painterId: "b", workOrderId: "w1", status: "booked", woRef: "WO-1" }, { id: "cb2", painterId: "b", workOrderId: "w2", status: "done", woRef: "WO-2" }],
  standards: [{ painterId: "a", status: "confirmed" }, { painterId: "b", status: "blocked" }, { painterId: "c", status: "employee_unsigned" }],
  results: [{ painterId: "a", workOrderId: "w3", result: "clean", reasons: [], hours: 20, signedOn: "2026-09-20", title: "14 Rosella St" }],
  jobs: [{ painterId: "a", workOrderId: "w9", woRef: "WO-9", title: "9 Grevillea Ct", stage: "in_progress" }, { painterId: "a", workOrderId: "w3", woRef: "WO-3", title: "14 Rosella St", stage: "closed" }],
};

describe("the Contractors view — one model for the strip and the rows", () => {
  test("strip counts equal what the rows show (brief Step 8 acceptance)", () => {
    const v = buildContractorsView(base, now);
    expect(v.rows.map((r) => r.name)).toEqual(["Dan", "Nikos", "Marco"]); // Red first, then un-evaluated, then Green; the inactive one is gone
    expect(v.counts).toEqual({ green: 1, yellow: 0, orange: 0, red: 1, new: 0, openCallbacks: 1, bonusDue: 1, notSigned: 2 });
    expect(v.rows.filter((r) => r.colour === "green").length).toBe(v.counts.green);
    expect(v.rows.filter((r) => r.tags.some((t) => t.text === "Standards not signed")).length).toBe(v.counts.notSigned);
  });

  test("a row carries counts not percentages, the trend, the tags, the last ten and the staff-only bonus history", () => {
    const marco = buildContractorsView(base, now).rows.find((r) => r.name === "Marco")!;
    expect(marco.checks).toBe("3/3");
    expect(marco.app).toBe("12/12");
    expect(marco.trend).toBe("better");
    expect(marco.tags.map((t) => t.text)).toEqual(["Bonus due"]);
    expect(marco.lastTen).toHaveLength(1);
    expect(marco.bonusHistory).toEqual([{ id: "bo2", amountCents: 50_000, decidedAt: "2026-09-02T00:00:00Z", status: "paid" }]);
    expect(marco.underWay.map((j) => j.woRef)).toEqual(["WO-9"]);
    expect(marco.finished.map((j) => j.woRef)).toEqual(["WO-3"]);
    const dan = buildContractorsView(base, now).rows.find((r) => r.name === "Dan")!;
    expect(dan.offersBlocked).toBe(true);
    expect(dan.tags.map((t) => t.text)).toEqual(["Open call back", "Check every job", "Standards not signed"]);
    expect(dan.app).toBe("No jobs yet");
  });
});
