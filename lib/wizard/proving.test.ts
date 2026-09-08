import { describe, expect, it } from "vitest";
import { exclusionFrom, provingRow, provingSummary, splitProving, type WizardSnapshot } from "./proving";

const est = (over: Partial<{ id: string; title: string; status: string; source: string }> = {}) => ({
  id: "e1", title: "14 Smith St", status: "draft", source: "wizard", ...over,
});
const snap = (over: Partial<WizardSnapshot> = {}): WizardSnapshot => ({
  totalCents: 1_000_000, accuracyPct: 82, outcome: "reveal", walkthroughRequired: false, ...over,
});

describe("provingRow", () => {
  it("measures the staff correction against the frozen original", () => {
    const r = provingRow(est(), snap(), 1_120_000, "2026-08-19T00:00:00Z");
    expect(r?.originalCents).toBe(1_000_000);
    expect(r?.currentCents).toBe(1_120_000);
    expect(r?.correctionCents).toBe(120_000);
    expect(r?.correctionPct).toBeCloseTo(12, 5);
  });

  it("is null without a snapshot — a non-wizard estimate isn't in the window", () => {
    expect(provingRow(est(), null, 500_000, null)).toBeNull();
  });

  it("flags acceptance from the estimate status", () => {
    expect(provingRow(est({ status: "accepted" }), snap(), 1_000_000, null)?.accepted).toBe(true);
  });
});

describe("provingSummary", () => {
  const rows = (corrections: number[]) =>
    corrections.map((c, i) => provingRow(est({ id: `e${i}` }), snap(), 1_000_000 + c, null)!);

  it("median correction is the gate metric", () => {
    const s = provingSummary(rows([10_000, 20_000, 30_000, -14_000, 5_000]));
    expect(s.medianAbsCorrectionCents).toBe(14_000);
    expect(s.count).toBe(5);
  });

  it("the gate needs a real sample AND the median under threshold", () => {
    // 12 tight corrections -> passes
    const tight = provingSummary(rows(Array.from({ length: 12 }, () => 5_000)));
    expect(tight.gatePasses).toBe(true);
    // same median but too few jobs -> not yet
    const few = provingSummary(rows([5_000, 5_000, 5_000]));
    expect(few.gatePasses).toBe(false);
    // enough jobs but a fat median -> fails
    const loose = provingSummary(rows(Array.from({ length: 12 }, () => 40_000)));
    expect(loose.gatePasses).toBe(false);
  });

  it("counts the within-10% share and the outcome mix", () => {
    const s = provingSummary([
      provingRow(est({ id: "a" }), snap({ outcome: "reveal" }), 1_050_000, null)!,      // +5%
      provingRow(est({ id: "b" }), snap({ outcome: "handoff" }), 1_300_000, null)!,     // +30%
      provingRow(est({ id: "c", status: "accepted" }), snap({ outcome: "reveal" }), 1_020_000, null)!, // +2%, accepted
    ]);
    expect(s.withinTenPctShare).toBeCloseTo(2 / 3, 5);
    expect(s.acceptedCount).toBe(1);
    expect(s.outcomes).toEqual({ reveal: 2, handoff: 1 });
  });

  it("an empty window is honest, not a divide-by-zero", () => {
    const s = provingSummary([]);
    expect(s.count).toBe(0);
    expect(s.medianAbsCorrectionCents).toBe(0);
    expect(s.gatePasses).toBe(false);
  });
});

// ---- Tom, 9 Sep: setting rows aside -----------------------------------------

describe("excluding a row that isn't a fair test", () => {
  const rowFor = (id: string, currentCents: number) =>
    provingRow(est({ id }), snap({ totalCents: 500_000 }), currentCents, null)!;

  it("leaves every number on the page, and changes nothing about the estimate", () => {
    const rows = [rowFor("a", 500_000), rowFor("b", 900_000), rowFor("c", 520_000)];
    const all = provingSummary(rows);
    const { kept, excluded } = splitProving(rows, {
      b: { at: "2026-09-09T00:00:00.000Z", by: "staff-1", reason: "compared against PaintScout" },
    });
    expect(kept.map((r) => r.estimateId)).toEqual(["a", "c"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].exclusion.reason).toBe("compared against PaintScout");

    // The median moves because the outlier left the sample — the whole point.
    const after = provingSummary(kept);
    expect(all.count).toBe(3);
    expect(after.count).toBe(2);
    expect(after.medianAbsCorrectionCents).toBeLessThan(all.medianAbsCorrectionCents);

    // The row itself is untouched — its frozen original is still there.
    expect(rows[1].originalCents).toBe(500_000);
  });

  it("keeps only a usable record", () => {
    expect(exclusionFrom(null)).toBeNull();
    expect(exclusionFrom({ by: "x" })).toBeNull();
    expect(exclusionFrom({ at: "2026-09-09T00:00:00.000Z" })).toEqual({ at: "2026-09-09T00:00:00.000Z", by: null, reason: "" });
    expect(exclusionFrom({ at: "2026-09-09T00:00:00.000Z", by: "s", reason: "  not a fair test  " })?.reason).toBe("not a fair test");
  });
});
