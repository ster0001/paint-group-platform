/**
 * Session 5 — Marketing on the golden seed: by source, spend in a range
 * (recorded months first, Settings weekly for the rest), cost per accepted
 * job with NO double count (one row per acceptance), spend vs sales, the
 * twelve-month trend, repeat + referral derived from an earlier acceptance,
 * wizard starts by source — all owner/admin only.
 */
import { describe, expect, it } from "vitest";
import { runMetric, type MetricInput } from "../core";
import type { AnyMetricDef } from "../registry";
import { SEED_NOW, goldenSeed } from "../seed";
import { MARKETING_METRICS, bySource, costPerAcceptedJob, cpaByChannel, repeatReferralShare, spendIn, spendVsSales, spendVsSalesTrend, wizardStartsBySource } from "./marketing";

const seed = goldenSeed();
const range = { from: "2026-09-01", to: "2026-09-19" };
const day = (d: string | null) => d == null ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const inR = (d: string | null) => { const x = day(d); return x != null && x >= range.from && x <= range.to; };
const acceptedInRange = seed.estimates.filter((e) => e.status === "accepted" && inR(e.accepted_at));
const firstRepeat = acceptedInRange.find((e) => e.account_id)!;

const pl: MetricInput["pl"] = {
  closedJobs: [], weeklyFixedCents: 500_000, weeklyMarketingCents: 100_000,
  spend: [{ month: "2026-08-01", channel: "paid_google", spend_cents: 300_000 }, { month: "2026-08-01", channel: "social", spend_cents: 100_000 }],
  payments: [], repeatAccounts: [firstRepeat.account_id!],
  history: [{ month: "2026-08", sales_cents: 8_000_000, accepted: 5 }, { month: "2026-09", sales_cents: 4_000_000, accepted: 2 }],
};
const funnel: MetricInput["funnel"] = {
  drafts: [
    { id: "d1", started_at: "2026-09-05T01:00:00Z", email: "a@example.com", estimate_id: "e1", converted_at: "2026-09-05T02:00:00Z", last_seen_at: null, lead_source: "paid_google" },
    { id: "d2", started_at: "2026-09-06T01:00:00Z", email: null, estimate_id: null, converted_at: null, last_seen_at: null, lead_source: "paid_google" },
    { id: "d3", started_at: "2026-09-07T01:00:00Z", email: null, estimate_id: null, converted_at: null, last_seen_at: null, lead_source: null },
  ],
  estimates: [{ id: "e1", status: "accepted", sent_at: "2026-09-05T03:00:00Z", viewed_at: null, accepted_at: "2026-09-08T03:00:00Z", declined_at: null, lead_source: "paid_google" }],
};
const input: MetricInput = { now: SEED_NOW, estimates: seed.estimates, pl, funnel };
const owner = ["owner"] as const;

describe("by lead source", () => {
  it("one row per source over the estimates SENT in the range; sums to the seed", () => {
    const r = runMetric(bySource, input, range, owner);
    const sent = seed.estimates.filter((e) => inR(e.sent_at));
    expect(r.rows.reduce((s, x) => s + x.sent, 0)).toBe(sent.length);
    expect(r.rows.reduce((s, x) => s + x.accepted, 0)).toBe(sent.filter((e) => e.status === "accepted").length);
    expect(r.rows.map((x) => x.source)).toContain("Not recorded");
    for (const x of r.rows) expect(x.conversion_pct).toBe(x.sent ? Math.round((x.accepted / x.sent) * 100) : 0);
  });
});

describe("spend in a range", () => {
  it("September has no recorded rows → Settings weekly × weeks", () => {
    expect(spendIn(input, range)).toEqual({ cents: 271_000, recordedMonths: 0, basis: "settings" });
  });
  it("August is recorded → the rows, whole month", () => {
    expect(spendIn(input, { from: "2026-08-01", to: "2026-08-31" })).toEqual({ cents: 400_000, recordedMonths: 1, basis: "recorded" });
  });
  it("a range across both → recorded pro-rated + Settings for the uncovered weeks", () => {
    const r = spendIn(input, { from: "2026-08-15", to: "2026-09-19" });
    expect(r.basis).toBe("mixed");
    expect(r.recordedMonths).toBe(1);
    expect(r.cents).toBeGreaterThan(Math.round(400_000 * 0.548));
  });
  it("no pl slice → nothing", () => { expect(spendIn({ now: SEED_NOW, estimates: [] }, range).basis).toBe("none"); });
});

describe("cost per accepted job — one row per acceptance, never a double count", () => {
  it("the tile is spend ÷ accepted; the rows are the acceptances with an equal share each", () => {
    const r = runMetric(costPerAcceptedJob, input, range, owner);
    expect(r.rows).toHaveLength(acceptedInRange.length);
    expect(r.value).toBe(Math.round(271_000 / acceptedInRange.length));
    expect(r.rows.every((x) => x.spend_share_cents === Math.round(271_000 / acceptedInRange.length) && x.one === 1)).toBe(true);
    expect(r.note).toBe(`$2,710 spend · ${acceptedInRange.length} accepted · Settings basis`);
  });
  it("by channel: only channels with recorded spend, against acceptances from that source", () => {
    const aug = { from: "2026-08-01", to: "2026-08-31" };
    const r = runMetric(cpaByChannel, input, aug, owner);
    const augAccepted = seed.estimates.filter((e) => e.status === "accepted" && (day(e.accepted_at) ?? "") >= aug.from && (day(e.accepted_at) ?? "") <= aug.to);
    const google = augAccepted.filter((e) => e.lead_source === "paid_google").length;
    expect(r.rows.map((x) => x.channel)).toEqual(["Paid Google", "Social"]);
    expect(r.rows[0]).toMatchObject({ spend_cents: 300_000, accepted: google, cpa_cents: google ? Math.round(300_000 / google) : 0 });
    expect(r.value).toBe(400_000);
    expect(runMetric(cpaByChannel, input, range, owner).note).toContain("no recorded spend in this range");
  });
});

describe("spend vs sales", () => {
  it("the tile is spend ÷ accepted sales over the range, one decimal", () => {
    const r = runMetric(spendVsSales, input, range, owner);
    const sales = acceptedInRange.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0);
    expect(r.rows).toHaveLength(acceptedInRange.length);
    expect(r.value).toBe(Math.round((r.rows.reduce((s, x) => s + x.spend_share_cents, 0) / sales) * 1000) / 10);
    expect(r.unit).toBe("pct");
  });
  it("twelve months: recorded where a month has it, else Settings weekly × 52 ÷ 12", () => {
    const r = runMetric(spendVsSalesTrend, input, range, owner);
    expect(r.rows).toHaveLength(12);
    expect(r.rows[11]).toMatchObject({ month: "2026-09", spend_cents: 433_333, sales_cents: 4_000_000, pct: 10.8, basis: "Settings" });
    expect(r.rows[10]).toMatchObject({ month: "2026-08", spend_cents: 400_000, sales_cents: 8_000_000, pct: 5, basis: "recorded" });
    expect(r.note).toBe("1 of 12 months from recorded spend");
  });
});

describe("repeat + referral share — derived, never a stored flag", () => {
  it("repeat = the account had an earlier acceptance; referral = the lead source; the tile is the share", () => {
    const r = runMetric(repeatReferralShare, input, range, owner);
    expect(r.rows).toHaveLength(acceptedInRange.length);
    const repeats = r.rows.filter((x) => x.repeat);
    expect(repeats.length).toBeGreaterThanOrEqual(1);
    expect(r.rows.find((x) => x.title === firstRepeat.title)?.repeat).toBe(true);
    const referrals = acceptedInRange.filter((e) => e.lead_source === "referral").length;
    expect(r.rows.filter((x) => x.referral)).toHaveLength(referrals);
    const either = r.rows.filter((x) => x.repeat_or_referral).length;
    expect(r.value).toBe(Math.round((either / r.rows.length) * 1000) / 10);
    expect(r.note).toBe(`${repeats.length} repeat · ${referrals} referral · of ${r.rows.length} accepted`);
  });
});

describe("wizard starts by source", () => {
  it("groups the funnel's own rows", () => {
    const r = runMetric(wizardStartsBySource, input, range, owner);
    expect(r.rows).toEqual([{ source: "Paid Google", starts: 2, saved: 1, accepted: 1 }, { source: "Not recorded", starts: 1, saved: 0, accepted: 0 }]);
    expect(r.value).toBe(3);
  });
});

describe("⚑2 — Marketing is owner/admin only", () => {
  it.each([["pc"], ["sales"], ["finance"]] as const)("%s cannot run any marketing tile", (role) => {
    for (const def of MARKETING_METRICS as ReadonlyArray<AnyMetricDef>) expect(() => runMetric(def, input, range, [role])).toThrow();
  });
});
