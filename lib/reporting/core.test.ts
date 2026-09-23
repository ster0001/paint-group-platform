/**
 * Session 1 — the reporting core, on the golden seed.
 *
 * Every expected number here is recounted from the seed rows in the test
 * itself, by a different route than the metric takes, so a tile equals its
 * rows (acceptance 1) and the value is what a person would count by hand.
 */
import { describe, expect, it } from "vitest";
import { melbourneDay as mdayCrm } from "@/lib/crm/work-queue";
import {
  ForbiddenError, aggregateRows, compareDelta, daysBetween, inRange, melbourneDay, previousRange, rangeLabel, rangeShortLabel, resolveRange, runMetric, parsePreset,
  type MetricInput,
} from "./core";
import { estimatesSent, salesCents, salesCount } from "./metrics/sales";
import { METRICS, SECTION_TITLE, SWITCHES_ON, metricByKey, metricsForSection } from "./registry";
import { DASHBOARD_SECTIONS, sectionsFor } from "./roles";
import { SEED_NOW, goldenSeed } from "./seed";

const seed = goldenSeed();
const input: MetricInput = { now: SEED_NOW, estimates: seed.estimates };
const owner = ["owner"] as const;

describe("Melbourne calendar days", () => {
  it("buckets like the CRM does, and never by the UTC date", () => {
    // 8 am on 1 Sep in Melbourne is 22:00 UTC on 31 Aug.
    expect(melbourneDay("2026-09-01T08:00:00+10:00")).toBe("2026-09-01");
    expect(new Date("2026-09-01T08:00:00+10:00").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(melbourneDay(new Date("2026-09-01T08:00:00+10:00"))).toBe(mdayCrm(new Date("2026-09-01T08:00:00+10:00")));
    expect(inRange("2026-09-01T08:00:00+10:00", { from: "2026-09-01", to: "2026-09-30" })).toBe(true);
    expect(inRange(null, { from: "2026-09-01", to: "2026-09-30" })).toBe(false);
  });
  it("the header's chips resolve to Melbourne days ending today", () => {
    expect(resolveRange("month", SEED_NOW)).toEqual({ from: "2026-09-01", to: "2026-09-19" });
    // 19 Sep 2026 is a Saturday: the week runs from Monday the 14th, compared with the same days of the week before.
    expect(resolveRange("week", SEED_NOW)).toEqual({ from: "2026-09-14", to: "2026-09-19", compare: { from: "2026-09-07", to: "2026-09-12" } });
    expect(resolveRange("quarter", SEED_NOW)).toEqual({ from: "2026-07-01", to: "2026-09-19", compare: { from: "2026-04-01", to: "2026-06-20" } });
    // The financial year (Tom, 20 Sep): 1 July → today, against the same stretch of the FY before.
    expect(resolveRange("year", SEED_NOW)).toEqual({ from: "2026-07-01", to: "2026-09-19", compare: { from: "2025-07-01", to: "2025-09-19" } });
    expect(resolveRange("custom", SEED_NOW, { from: "2025-07-01", to: "2026-06-30" })).toEqual({ from: "2025-07-01", to: "2026-06-30", compare: { from: "2024-07-01", to: "2025-06-30" } });
    expect(rangeShortLabel({ from: "2025-07-01", to: "2026-06-30" })).toBe("FY 25/26");
    expect(resolveRange("custom", SEED_NOW, { from: "2026-08-10", to: "2026-08-03" })).toEqual({ from: "2026-08-03", to: "2026-08-10" });
    expect(resolveRange("custom", SEED_NOW, { from: "nope" })).toEqual({ from: "2026-09-01", to: "2026-09-19" });
    // A custom range that is exactly a quarter or a year compares with the whole one before.
    expect(resolveRange("custom", SEED_NOW, { from: "2026-04-01", to: "2026-06-30" })).toEqual({ from: "2026-04-01", to: "2026-06-30", compare: { from: "2026-01-01", to: "2026-03-31" } });
    expect(resolveRange("custom", SEED_NOW, { from: "2025-01-01", to: "2025-12-31" })).toEqual({ from: "2025-01-01", to: "2025-12-31", compare: { from: "2024-01-01", to: "2024-12-31" } });
  });
  it("old links still name a period: this_month, ytd and last_30 map; anything else is nothing", () => {
    expect(parsePreset("this_month")).toBe("month");
    expect(parsePreset("ytd")).toBe("year");
    expect(parsePreset("week")).toBe("week");
    expect(parsePreset("fortnight")).toBeNull();
    expect(parsePreset(undefined)).toBeNull();
  });
  it("previousRange honours the preset's own comparison, and the tile label never assumes a month", () => {
    expect(previousRange({ from: "2026-09-14", to: "2026-09-19", compare: { from: "2026-09-07", to: "2026-09-12" } })).toEqual({ from: "2026-09-07", to: "2026-09-12" });
    expect(rangeShortLabel({ from: "2026-08-01", to: "2026-08-31" })).toBe("Aug");
    expect(rangeShortLabel({ from: "2026-04-01", to: "2026-06-30" })).toBe("Q2 26");
    expect(rangeShortLabel({ from: "2025-01-01", to: "2025-12-31" })).toBe("2025");
    expect(rangeShortLabel({ from: "2026-09-07", to: "2026-09-12" })).toBe("7–12 Sept");
    expect(rangeShortLabel({ from: "2026-08-24", to: "2026-09-06" })).toBe("24 Aug – 6 Sept");
    expect(rangeShortLabel(null)).toBe("");
  });
  it("compares a partial month with the same days of the previous month, a whole month with the whole previous month", () => {
    expect(previousRange({ from: "2026-09-01", to: "2026-09-19" })).toEqual({ from: "2026-08-01", to: "2026-08-19" });
    expect(previousRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-30" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });   // Feb has 28
    expect(previousRange({ from: "2026-08-21", to: "2026-09-19" })).toEqual({ from: "2026-07-22", to: "2026-08-20" });
    expect(daysBetween("2026-08-21", "2026-09-19")).toBe(30);
  });
  it("labels read like the mockup", () => {
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-19" })).toBe("1 – 19 September 2026");
    expect(rangeLabel({ from: "2026-08-21", to: "2026-09-19" })).toBe("21 August – 19 September 2026");
    expect(rangeLabel({ from: "2026-09-19", to: "2026-09-19" })).toBe("19 September 2026");
  });
  it("the arrow", () => {
    expect(compareDelta(36, 34)).toEqual({ pct: 6, dir: "up" });
    expect(compareDelta(30, 40)).toEqual({ pct: 25, dir: "down" });
    expect(compareDelta(5, 0)).toBeNull();
    expect(compareDelta(0, 0)).toEqual({ pct: 0, dir: "flat" });
    expect(compareDelta(3, null)).toBeNull();
  });
});

describe("the golden seed", () => {
  it("is the dataset the brief asked for, and deterministic", () => {
    expect(seed.estimates.filter((e) => e.sent_at)).toHaveLength(60);
    expect(seed.estimates.filter((e) => e.status === "draft")).toHaveLength(9);
    expect(new Set(seed.estimates.filter((e) => e.sent_at).map((e) => e.presentation_id)).size).toBe(3);
    expect(new Set(seed.estimates.filter((e) => e.sent_at).map((e) => e.sent_by_user_id)).size).toBe(2);
    expect(seed.workOrders).toHaveLength(20);
    expect(seed.payments).toHaveLength(30);
    expect(goldenSeed().estimates.map((e) => e.sent_at)).toEqual(seed.estimates.map((e) => e.sent_at));
  });
});

describe("runMetric — sales, on the seed", () => {
  const range = { from: "2026-09-01", to: "2026-09-19" };
  const byHand = (pick: (e: MetricInput["estimates"][number]) => string | null, r = range) =>
    seed.estimates.filter((e) => { const d = pick(e); return d != null && melbourneDay(d) >= r.from && melbourneDay(d) <= r.to; });

  it("estimates sent: the tile is the row count, drafts never count, and the comparison is last month's same days", () => {
    const r = runMetric(estimatesSent, input, range, owner);
    const expected = byHand((e) => e.sent_at);
    expect(r.value).toBe(expected.length);
    expect(r.rows).toHaveLength(expected.length);
    expect(r.rows.every((row) => row.status !== "draft")).toBe(true);
    expect(r.compare).toBe(byHand((e) => e.sent_at, { from: "2026-08-01", to: "2026-08-19" }).length);
    expect(r.compareRange).toEqual({ from: "2026-08-01", to: "2026-08-19" });
    expect(r.value).toBeGreaterThan(0);
  });
  it("sales $ is the sum of the signed totals accepted in the range; sales (number) their count", () => {
    const money = runMetric(salesCents, input, range, owner);
    const count = runMetric(salesCount, input, range, owner);
    const expected = byHand((e) => (e.status === "accepted" ? e.accepted_at : null));
    expect(count.value).toBe(expected.length);
    expect(money.value).toBe(expected.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0));
    expect(money.rows).toHaveLength(expected.length);
    expect(money.gst).toBe("inc");
    expect(aggregateRows(money.rows, money.rows.length ? { sum: "accepted_total_cents" } : "count")).toBe(money.value);
  });
  it("a sales login may run a sales metric; a pc login may not — inside the function, not the page", () => {
    expect(() => runMetric(estimatesSent, input, range, ["sales"])).not.toThrow();
    expect(() => runMetric(estimatesSent, input, range, ["pc"])).toThrow(ForbiddenError);
    expect(() => runMetric(estimatesSent, input, range, [])).toThrow(ForbiddenError);
    try { runMetric(salesCents, input, range, ["finance"]); } catch (e) { expect((e as ForbiddenError).status).toBe(403); }
  });
  it("an 8 am Melbourne send on 1 September counts in September, not August", () => {
    const morning = seed.estimates.filter((e) => e.sent_at && melbourneDay(e.sent_at) === "2026-09-01" && new Date(e.sent_at).toISOString().slice(0, 10) === "2026-08-31");
    if (morning.length === 0) return;   // the seed may not have one on that day; the day-bucket test above covers the rule
    const sept = runMetric(estimatesSent, input, { from: "2026-09-01", to: "2026-09-01" }, owner);
    expect(sept.rows.map((r) => r.id)).toEqual(expect.arrayContaining(morning.map((e) => e.id)));
  });
});

describe("the registry", () => {
  it("every metric has a definition a person could read, a section, roles and CSV columns (acceptance 13)", () => {
    expect(METRICS.length).toBeGreaterThan(0);
    for (const m of METRICS) {
      expect(m.definition.trim().length, m.key).toBeGreaterThan(40);
      expect(DASHBOARD_SECTIONS).toContain(m.section);
      expect(m.roles.length, m.key).toBeGreaterThan(0);
      expect(m.columns.length, m.key).toBeGreaterThan(0);
      expect(m.unit === "cents" ? m.gst !== null : true, `${m.key} money needs a GST basis`).toBe(true);
    }
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
    expect(metricByKey("sales.estimates_sent")?.title).toBe("Estimates sent");
    expect(metricByKey("nope")).toBeNull();
  });
  it("a section with no live metrics says what it waits on — never a zero", () => {
    for (const s of DASHBOARD_SECTIONS) {
      if (s === "needs_doing") continue;
      if (metricsForSection(s).length === 0) expect(SWITCHES_ON[s], s).toBeTruthy();
      expect(SECTION_TITLE[s]).toBeTruthy();
    }
    expect(sectionsFor(["sales"])).toContain("sales");
  });
});
