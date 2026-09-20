/**
 * Session 5 — P&L on the golden seed plus hand-built signed-off jobs: ex GST
 * throughout, actual margin = contract − recorded costs, net = gross −
 * Settings overhead − marketing (recorded months first), and every tile is
 * owner/admin only (⚑2, enforced in runMetric).
 */
import { describe, expect, it } from "vitest";
import { runMetric, type ClosedJobRow, type MetricInput } from "../core";
import type { AnyMetricDef } from "../registry";
import { SEED_NOW, goldenSeed } from "../seed";
import { BASIS_CHIP, PL_METRICS, contractsSigned, grossMargin, marginByCategory, marginBySize, monthsIn, netMargin, revenueReceived, weeksIn } from "./pl";

const seed = goldenSeed();
const range = { from: "2026-09-01", to: "2026-09-19" };
const inR = (d: string | null) => d != null && new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) >= range.from && new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) <= range.to;

const job = (over: Partial<ClosedJobRow> & { wo_ref: string }): ClosedJobRow => ({
  work_order_id: `wo-${over.wo_ref}`, title: `${over.wo_ref} St`, closed_on: "2026-09-10", estimate_id: `est-${over.wo_ref}`, category: "Residential interior", size_band: "10_to_20k", account_id: null, lead_source: "referral",
  est: { net_subtotal_cents: 1_500_000, contractor_cents: 700_000, materials_cents: 200_000, third_party_cents: 0, margin_cents: 600_000 },
  actual: { contractor_cents: 720_000, materials_cents: 180_000, job_costs_cents: 20_000, expenses_cents: 5_000 },
  ...over,
});
const closedJobs: ClosedJobRow[] = [
  job({ wo_ref: "WO-1" }),                                                                                       // actual cost 925,000 → margin 575,000 (est 600,000)
  job({ wo_ref: "WO-2", closed_on: "2026-09-18", size_band: "over_20k", category: "Residential exterior", est: { net_subtotal_cents: 3_000_000, contractor_cents: 1_400_000, materials_cents: 500_000, third_party_cents: 100_000, margin_cents: 1_000_000 }, actual: { contractor_cents: 1_400_000, materials_cents: 600_000, job_costs_cents: 0, expenses_cents: 0 } }), // 3.0m − 0.1m − 2.0m = 900,000
  job({ wo_ref: "WO-3", closed_on: "2026-08-12" }),                                                              // 1–19 Aug: the comparison window, out of range
  job({ wo_ref: "WO-4", est: null }),                                                                            // no priced scope: never a margin row
];
const pl: MetricInput["pl"] = {
  closedJobs, weeklyFixedCents: 500_000, weeklyMarketingCents: 100_000,
  spend: [{ month: "2026-08-01", channel: "paid_google", spend_cents: 300_000 }],
  payments: [{ paid_on: "2026-09-03", amount_cents: 110_000 }, { paid_on: "2026-09-19", amount_cents: 220_000 }, { paid_on: "2026-08-10", amount_cents: 999_999 }],
  repeatAccounts: [], history: [],
};
const sales: MetricInput["sales"] = { presentations: [{ id: "pinterior-0000-4000-8000-000000000000", category_label: "Residential interior" }], staff: [], targets: [], history: [], viewerUserId: null, who: "team" };
const input: MetricInput = { now: SEED_NOW, estimates: seed.estimates, pl, sales };
const owner = ["owner"] as const;

describe("contracts signed and revenue received — ex GST", () => {
  it("contracts signed = the seed's acceptances in the range ÷ 1.1, with the basis chip", () => {
    const r = runMetric(contractsSigned, input, range, owner);
    const acc = seed.estimates.filter((e) => e.status === "accepted" && inR(e.accepted_at));
    expect(r.rows).toHaveLength(acc.length);
    expect(r.value).toBe(acc.reduce((s, e) => s + Math.round((e.accepted_total_cents ?? e.total_cents) / 1.1), 0));
    expect(r.gst).toBe("ex");
    expect(r.note).toBe(`${acc.length} accepted · ${BASIS_CHIP}`);
  });
  it("revenue received = payments landed in the range ÷ 1.1, newest first; last month's is the comparison", () => {
    const r = runMetric(revenueReceived, input, range, owner);
    expect(r.rows.map((x) => x.amount_ex_cents)).toEqual([200_000, 100_000]);
    expect(r.value).toBe(300_000);
    expect(r.compare).toBe(Math.round(999_999 / 1.1));
  });
});

describe("gross margin on signed-off jobs", () => {
  it("actual margin = contract − third party − (contractor + materials + job costs + expenses); no scope = no row; last month out", () => {
    const r = runMetric(grossMargin, input, range, owner);
    expect(r.rows.map((x) => [x.wo_ref, x.actual_margin_cents, x.est_margin_cents, x.delta_cents])).toEqual([["WO-1", 575_000, 600_000, -25_000], ["WO-2", 900_000, 1_000_000, -100_000]]);
    expect(r.value).toBe(1_475_000);
    expect(r.rows[0].margin_pct).toBe(38.3);
    expect(r.rows[0].materials_pct).toBe(12);
    expect(r.note).toBe(`estimated $16,000 · 2 jobs · 33% of contract · ${BASIS_CHIP}`);
    expect(r.compare).toBe(575_000);   // WO-3 in the comparison window
  });
  it("by size band and by category: the tile is the overall share, the rows each band's", () => {
    const size = runMetric(marginBySize, input, range, owner);
    expect(size.rows.map((x) => [x.band, x.jobs, x.margin_pct])).toEqual([["Over $20k", 1, 30], ["$10k – $20k", 1, 38.3]]);
    expect(size.value).toBe(Math.round((1_475_000 / 4_500_000) * 1000) / 10);
    const cat = runMetric(marginByCategory, input, range, owner);
    expect(cat.rows.map((x) => [x.band, x.materials_pct])).toEqual([["Residential exterior", 20], ["Residential interior", 12]]);
  });
});

describe("net margin on the Settings basis", () => {
  it("weeks and months of a range", () => {
    expect(weeksIn(range)).toBe(2.71);
    expect(monthsIn(range)).toEqual([{ ym: "2026-09", share: 0.633 }]);
    expect(monthsIn({ from: "2026-08-15", to: "2026-09-19" }).map((m) => m.ym)).toEqual(["2026-08", "2026-09"]);
  });
  it("gross − fixed × weeks − marketing (Settings weekly where the month has no recorded spend)", () => {
    const r = runMetric(netMargin, input, range, owner);
    expect(r.rows.map((x) => [x.line, x.cents, x.basis])).toEqual([
      ["Gross margin on signed-off jobs", 1_475_000, "actual"],
      ["Fixed overhead · 2.71 weeks × $5,000", -1_355_000, "Settings"],
      ["Marketing · 2.71 weeks × $1,000", -271_000, "Settings"],
    ]);
    expect(r.value).toBe(1_475_000 - 1_355_000 - 271_000);
    expect(r.note).toBe(BASIS_CHIP);
  });
  it("a month with recorded marketing_spend uses it (pro-rated) instead of the weekly figure", () => {
    const r = runMetric(netMargin, input, { from: "2026-08-01", to: "2026-08-31" }, owner);
    expect(r.rows.find((x) => x.basis === "marketing_spend")).toMatchObject({ cents: -300_000 });
    expect(r.rows.some((x) => x.line.startsWith("Marketing ·") && x.basis === "Settings")).toBe(false);
    expect(r.note).toContain("recorded spend");
  });
  it("no weekly fixed cost set → overhead is not deducted and the note says so", () => {
    const r = runMetric(netMargin, { ...input, pl: { ...pl, weeklyFixedCents: null } }, range, owner);
    expect(r.rows.some((x) => x.line.startsWith("Fixed overhead"))).toBe(false);
    expect(r.note).toBe("Weekly fixed costs not set in Settings — overhead not deducted");
  });
});

describe("⚑2 — P&L is owner/admin only", () => {
  it.each([["pc"], ["sales"], ["finance"]] as const)("%s cannot run any P&L tile", (role) => {
    for (const def of PL_METRICS as ReadonlyArray<AnyMetricDef>) expect(() => runMetric(def, input, range, [role])).toThrow();
  });
  it("admin can", () => { expect(runMetric(grossMargin, input, range, ["admin"]).value).toBe(1_475_000); });
});
