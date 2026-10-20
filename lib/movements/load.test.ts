import { describe, expect, it } from "vitest";
import { coloursConfirmed, geocodeWanted, jobFrom, qaCheckRequired } from "./load";

describe("loadMovementsWeek's pure pieces", () => {
  it("a quality check reaches the board only when the job has it ticked as required and not waived (Tom, 20 Oct 2026)", () => {
    expect(qaCheckRequired({ qa_required: true, qa_waived: false })).toBe(true);
    expect(qaCheckRequired({ qa_required: true, qa_waived: null })).toBe(true);
    expect(qaCheckRequired({ qa_required: true, qa_waived: true })).toBe(false);
    expect(qaCheckRequired({ qa_required: false, qa_waived: false })).toBe(false);
    expect(qaCheckRequired({ qa_required: null, qa_waived: null })).toBe(false);
    expect(qaCheckRequired(null)).toBe(false);
  });
  it("coloursConfirmed mirrors wo_colours_confirmed: a snapshot with rows, every row confirmed", () => {
    const rows = [{ product: "A", photoUrl: "", litres: 1, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" as const }];
    expect(coloursConfirmed({ wo_snapshot: null, colours: null })).toBe(false);
    expect(coloursConfirmed({ wo_snapshot: { materials: [] }, colours: null })).toBe(false);
    expect(coloursConfirmed({ wo_snapshot: { materials: rows }, colours: { A: { status: "tbc" } } })).toBe(false);
    expect(coloursConfirmed({ wo_snapshot: { materials: rows }, colours: { A: { status: "confirmed" } } })).toBe(true);
    expect(coloursConfirmed({ wo_snapshot: { materials: rows }, colours: null })).toBe(false);
  });
  it("jobFrom: PG ref, suburb and the centroid point", () => {
    const job = jobFrom({ id: "w", wo_ref: "WO-9", job_no: 9, stage: "pre_start", start_date: "2026-10-26", end_date: "2026-10-28", contractor_id: null,
      wo_snapshot: { jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: "Test" }, colours: null }, new Map([["oakleigh south", { lat: -37.92, lng: 145.1 }]]));
    expect(job).toMatchObject({ jobRef: "PG-0009", suburb: "Oakleigh South", point: { lat: -37.92, lng: 145.1 }, title: "Test", coloursConfirmed: false });
  });
});

describe("geocodeWanted (flag 3: lazy, at most once a week per job)", () => {
  const NOW = Date.parse("2026-10-21T00:00:00Z");
  it("never for a job that already has its real point", () => {
    expect(geocodeWanted({ lat: -37.9, lng: 145.1, point_checked_at: null }, NOW)).toBe(false);
  });
  it("yes for a job never checked; no for one checked this week; yes again after a week", () => {
    expect(geocodeWanted({ lat: null, lng: null, point_checked_at: null }, NOW)).toBe(true);
    expect(geocodeWanted({ lat: null, lng: null, point_checked_at: "2026-10-20T00:00:00Z" }, NOW)).toBe(false);
    expect(geocodeWanted({ lat: null, lng: null, point_checked_at: "2026-10-01T00:00:00Z" }, NOW)).toBe(true);
  });
});
