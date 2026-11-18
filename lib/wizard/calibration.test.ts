import { describe, expect, it } from "vitest";
import { calibrationReport, matchAreas, normaliseAreaName, summariseAll, summarisePair, type PricedEstimate } from "./calibration";

const est = (id: string, total: number, areas: Array<[string, number]>): PricedEstimate => ({
  id, label: id, source: "staff", createdAt: "2026-11-01T00:00:00Z", totalCents: total,
  areas: areas.map(([name, cents]) => ({ name, type: "Interior" as const, cents })),
});

describe("go-live S6 — the calibration report (pure half)", () => {
  it("matches areas by a forgiving name", () => {
    expect(normaliseAreaName("Bedroom 1")).toBe(normaliseAreaName("Bed 1"));
    expect(normaliseAreaName("Kitchen / Living")).toBe("kitchen living");
    expect(normaliseAreaName("Living room")).toBe("living");
    const m = matchAreas(est("s", 0, [["Bed 1", 100], ["Living room", 200], ["Study", 50]]).areas, est("w", 0, [["Living", 210], ["Bedroom 1", 90], ["Hall & Entry", 40]]).areas);
    expect(m).toEqual([
      { name: "Bed 1", staffCents: 100, wizardCents: 90 },
      { name: "Living room", staffCents: 200, wizardCents: 210 },
      { name: "Study", staffCents: 50, wizardCents: null },
      { name: "Hall & Entry", staffCents: null, wizardCents: 40 },
    ]);
  });
  it("summarises a pair and the roll-up", () => {
    const p = summarisePair(est("s", 1_000_00, []), est("w", 1_100_00, []));
    expect(p).toMatchObject({ diffCents: 10_000, diffPct: 10 });
    const all = summariseAll([p, summarisePair(est("s2", 200_000, []), est("w2", 170_000, [])), summarisePair(est("s3", 100_000, []), est("w3", 104_000, []))]);
    expect(all).toEqual({ medianPct: 4, within10: 2, count: 3 });
    expect(summariseAll([])).toEqual({ medianPct: 0, within10: 0, count: 0 });
  });
  it("writes the report with the roll-up first and a table per job", () => {
    const md = calibrationReport([{ staff: est("s", 500_000, [["Bed 1", 120_000]]), wizard: est("w", 520_000, [["Bedroom 1", 125_000]]) }], "19 Nov 2026");
    expect(md).toContain("# Wizard calibration — 1 past jobs re-entered (19 Nov 2026)");
    expect(md).toContain("| 1 | +4.0% | 1 of 1 |");
    expect(md).toContain("| Bed 1 | $1,200 | $1,250 | $50 |");
  });
});
