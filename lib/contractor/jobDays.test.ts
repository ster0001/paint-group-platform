import { describe, expect, it } from "vitest";
import { jobDaysFor, spanOf } from "./jobDays";
import type { ContractorJob } from "./jobs";

const job = (over: Partial<ContractorJob> = {}): ContractorJob => ({
  id: "j1", woRef: "WO-1", status: "booked", startDate: "2026-09-01", endDate: null,
  issuedAt: null, viewedAt: null, paymentCents: 100_000, committed: true,
  doc: null, ...over,
} as ContractorJob);

describe("which days a contractor's booking covers", () => {
  it("uses the booking's own end date, inclusive of both ends", () => {
    expect(spanOf(job({ startDate: "2026-09-01", endDate: "2026-09-04" }))).toBe(4);
  });

  it("carries the job id onto every day, so a tap can open the job", () => {
    // The bug Tom reported: the offer card's calendar omitted the id, so
    // tapping a booked day did nothing at all.
    const days = jobDaysFor([job({ startDate: "2026-09-01", endDate: "2026-09-03" })]);
    expect(days.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(days.every((d) => d.id === "j1")).toBe(true);
  });

  it("shows the WHOLE booking, not just day one", () => {
    // On an offer card this is the dangerous one: a calendar that under-reports
    // existing commitments invites a contractor to accept a clashing job.
    expect(jobDaysFor([job({ startDate: "2026-09-01", endDate: "2026-09-04" })])).toHaveLength(4);
  });

  it("falls back to estimated hours only when no end date was booked", () => {
    // A guess must never override what the office actually booked.
    const doc = { areas: [{ surfaces: [{ hours: 24 }] }] } as unknown as ContractorJob["doc"];
    expect(spanOf(job({ endDate: null, doc }))).toBe(3);
    expect(spanOf(job({ endDate: "2026-09-01", doc }))).toBe(1);   // booked one day wins
  });

  it("treats a job with no dates as occupying nothing", () => {
    expect(jobDaysFor([job({ startDate: null })])).toEqual([]);
  });

  it("does not shift the day across a timezone boundary", () => {
    // The suite runs in Melbourne; toISOString() here would report 31 August.
    expect(jobDaysFor([job({ startDate: "2026-09-01", endDate: "2026-09-01" })])[0].date)
      .toBe("2026-09-01");
  });

  it("keeps every job's days when several are booked", () => {
    const days = jobDaysFor([
      job({ id: "a", startDate: "2026-09-01", endDate: "2026-09-02" }),
      job({ id: "b", startDate: "2026-09-10", endDate: "2026-09-10" }),
    ]);
    expect(days).toHaveLength(3);
    expect(new Set(days.map((d) => d.id))).toEqual(new Set(["a", "b"]));
  });
});
