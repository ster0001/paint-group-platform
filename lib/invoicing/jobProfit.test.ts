/**
 * Step 7 acceptance: "gross profit equals job value excluding GST minus the
 * listed costs, to the cent, and every line traces to a cost row".
 */
import { describe, expect, it } from "vitest";
import { jobProfit, type ProfitInput } from "./jobProfit";

const base: ProfitInput = {
  contractIncCents: 1_100_000,                      // $11,000 inc GST → $10,000 ex
  offerCents: 400_000, contractorVariationCents: 30_000,
  costs: [
    { id: "lab1", category: "labour", status: "approved", amountExCents: 50_000, label: "Timesheet" },
    { id: "lab2", category: "labour", status: "recorded", amountExCents: 99_999, label: "Not approved yet" },
    { id: "mat1", category: "materials", status: "approved", amountExCents: 52_008, label: "Dulux 0911" },
    { id: "old1", category: "other", status: "recorded", amountExCents: 16_584, label: "Dulux filed as other" },
    { id: "scf1", category: "scaffold", status: "paid", amountExCents: 120_000, label: "Scaffold" },
    { id: "del1", category: "materials", status: "void", amountExCents: 77_777, label: "Deleted" },
  ],
  materialsCostIds: new Set(["mat1", "old1", "del1"]),
  materialCosts: [
    { id: "mc1", amountIncCents: 11_000, overhead: null, label: "Haymes (Airtable)" },
    { id: "mc2", amountIncCents: 5_500, overhead: true, label: "Overhead — not this job" },
  ],
  expenses: [
    { id: "ex1", amountExCents: 6_000, status: "approved", label: "Parking" },
    { id: "ex2", amountExCents: 9_000, status: "submitted", label: "Not approved" },
  ],
  started: true,
};

describe("money out and profit (§4.7, R19)", () => {
  const p = jobProfit(base);
  const line = (k: string) => p.lines.find((l) => l.key === k)!;

  it("each line from its own rows; voided, unapproved and overhead rows count nowhere", () => {
    expect(p.valueExCents).toBe(1_000_000);
    expect(line("contractor").cents).toBe(430_000);
    expect(line("own_painters").cents).toBe(50_000);
    expect(line("materials").cents).toBe(52_008 + 16_584 + 10_000);    // ex GST of the $110 material cost
    expect(line("other").cents).toBe(120_000);
    expect(line("expenses").cents).toBe(6_000);
  });
  it("gross profit = job value ex GST − the listed costs, to the cent", () => {
    expect(p.totalCostsCents).toBe(p.lines.reduce((s, l) => s + l.cents, 0));
    expect(p.grossProfitCents).toBe(p.valueExCents - p.totalCostsCents);
    expect(p.grossProfitCents).toBe(1_000_000 - (430_000 + 50_000 + 78_592 + 120_000 + 6_000));
    expect(p.marginPct).toBe(31.5);
  });
  it("every line traces to the rows it adds up", () => {
    for (const l of p.lines) expect(l.sources.reduce((s, x) => s + x.cents, 0)).toBe(l.cents);
    expect(line("materials").sources.map((s) => s.id)).toEqual(["mat1", "old1", "mc1"]);
    // Job costs carry their status for the panel's Approve / ✓ Paid; material_costs and the offer don't.
    expect(line("other").sources[0].jobCostStatus).toBe("paid");
    expect(line("materials").sources.find((s) => s.id === "mc1")!.jobCostStatus).toBeUndefined();
  });
  it("the bar: costs then profit, as shares of the job value", () => {
    expect(p.bar.map((b) => b.key)).toEqual(["contractor", "own_painters", "materials", "other", "expenses", "profit"]);
    expect(p.bar.find((b) => b.key === "profit")!.pct).toBe(31.5);
  });
  it("a started job with no materials says the profit reads too high", () => {
    expect(p.noMaterialsWarning).toBe(false);
    expect(jobProfit({ ...base, costs: [], materialCosts: [] }).noMaterialsWarning).toBe(true);
    expect(jobProfit({ ...base, costs: [], materialCosts: [], started: false }).noMaterialsWarning).toBe(false);
  });
});
