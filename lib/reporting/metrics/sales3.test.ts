/**
 * Session 3 — conversion as a cohort, AOV by presentation category, by
 * salesperson with the sales login's "mine", the target card (no target =
 * "no target set", never 0%), the funnel from wizard sessions, and the
 * role-scoped activity feed on the CRM timeline — on the golden seed and a
 * few hand-built rows.
 */
import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { runMetric, type MetricInput } from "../core";
import { SEED_NOW, SEED_SALESPEOPLE, goldenSeed } from "../seed";
import { aovByCategory, bySalesperson, conversion } from "./sales";
import { buildTarget } from "./target";
import { buildFunnel, wizardSessions } from "./funnel";
import { activity, familiesFor, familyOf } from "./activity";

const seed = goldenSeed();
const range = { from: "2026-09-01", to: "2026-09-19" };
const sales: MetricInput["sales"] = {
  presentations: [
    { id: "pinterior-0000-4000-8000-000000000000", category_label: "Residential interior" },
    { id: "pexterior-0000-4000-8000-000000000000", category_label: "Residential exterior" },
    // Commercial has no presentation row on purpose → "Uncategorised"
  ],
  staff: [{ id: SEED_SALESPEOPLE[0], name: "Tom" }, { id: SEED_SALESPEOPLE[1], name: "Sarah" }],
  targets: [{ month: "2026-09-01", target_cents: 19_000_000 }],
  history: [{ month: "2026-08", sales_cents: 8_000_000, accepted: 5 }],
  viewerUserId: SEED_SALESPEOPLE[1],
  who: "team",
};
const input: MetricInput = { now: SEED_NOW, estimates: seed.estimates, sales };
const owner = ["owner"] as const;
const inR = (d: string | null) => d != null && new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) >= range.from && new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) <= range.to;

describe("conversion — a cohort by month sent", () => {
  it("is accepted ÷ sent over the estimates SENT in the range, with the still-open count", () => {
    const r = runMetric(conversion, input, range, owner);
    const sent = seed.estimates.filter((e) => inR(e.sent_at));
    const acc = sent.filter((e) => e.status === "accepted").length;
    expect(r.rows).toHaveLength(sent.length);
    expect(r.value).toBe(Math.round((acc / sent.length) * 1000) / 10);
    expect(r.note).toBe(`${acc} of ${sent.length} sent · ${sent.filter((e) => e.status === "sent").length} still open`);
    expect(r.unit).toBe("pct");
  });
});

describe("average order value by presentation category", () => {
  it("groups accepted totals by the presentation's label, Uncategorised last, the tile the overall average", () => {
    const r = runMetric(aovByCategory, input, range, owner);
    const acc = seed.estimates.filter((e) => e.status === "accepted" && inR(e.accepted_at));
    const total = acc.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0);
    expect(r.value).toBe(Math.round(total / acc.length));
    expect(r.rows.map((x) => x.category)).toEqual(expect.arrayContaining(["Residential interior", "Residential exterior", "Uncategorised"]));
    expect(r.rows[r.rows.length - 1].category).toBe("Uncategorised");
    expect(r.rows.reduce((s, x) => s + x.accepted, 0)).toBe(acc.length);
    for (const row of r.rows) expect(row.aov_cents).toBe(Math.round(row.total_cents / row.accepted));
  });
});

describe("by salesperson, and a sales login's Mine", () => {
  it("team: one row per sender, sorted by sales; mine: only the viewer's estimates", () => {
    const team = runMetric(bySalesperson, input, range, owner);
    expect(team.rows.map((x) => x.name).sort()).toEqual(["Sarah", "Tom"]);
    expect(team.rows[0].sales_cents).toBeGreaterThanOrEqual(team.rows[1].sales_cents);
    for (const row of team.rows) expect(row.conversion_pct).toBe(Math.round((row.accepted / row.sent) * 100));
    const mine = runMetric(bySalesperson, { ...input, sales: { ...sales, who: "mine" } }, range, ["sales"]);
    expect(mine.rows.map((x) => x.name)).toEqual(["Sarah"]);
    expect(mine.note).toContain("you");
    const c = runMetric(conversion, { ...input, sales: { ...sales, who: "mine" } }, range, ["sales"]);
    expect(c.rows.every((x) => x.sent_by === "Sarah")).toBe(true);
  });
});

describe("the target card", () => {
  it("sales this month against the Settings target, pace from the day of the month, twelve months of bars", () => {
    const t = buildTarget(input, range);
    const acc = seed.estimates.filter((e) => e.status === "accepted" && inR(e.accepted_at));
    expect(t.month).toBe("2026-09");
    expect(t.label).toBe("September");
    expect(t.sales_cents).toBe(acc.reduce((s, e) => s + (e.accepted_total_cents ?? e.total_cents), 0));
    expect(t.target_cents).toBe(19_000_000);
    expect(t.pct_hit).toBe(Math.round((t.sales_cents / 19_000_000) * 100));
    expect(t.pct_month_gone).toBe(Math.round((19 / 30) * 100));
    expect(["ahead", "on pace", "behind"]).toContain(t.pace);
    expect(t.months).toHaveLength(12);
    expect(t.months[11].month).toBe("2026-09");
    expect(t.months[10]).toMatchObject({ month: "2026-08", sales_cents: 8_000_000, accepted: 5, target_cents: null });
    expect(t.months[0].month).toBe("2025-10");
  });
  it("a month with no target says so — never 0%", () => {
    const t = buildTarget({ ...input, sales: { ...sales, targets: [] } }, range);
    expect(t.target_cents).toBeNull();
    expect(t.pct_hit).toBeNull();
    expect(t.pace).toBeNull();
  });
});

describe("where estimates go", () => {
  const at = (d: string, h = 10) => { const [y, m, dd] = d.split("-").map(Number); return melbourneInstant(y, m, dd, h).toISOString(); };
  const fInput: MetricInput = {
    now: SEED_NOW, estimates: [],
    funnel: {
      drafts: [
        { id: "d1", started_at: at("2026-09-02"), email: null, estimate_id: null, converted_at: null, last_seen_at: null, lead_source: null },            // dropped before email
        { id: "d2", started_at: at("2026-09-03"), email: "a@x.com", estimate_id: null, converted_at: null, last_seen_at: null, lead_source: "paid_google" },   // warm, not saved
        { id: "d3", started_at: at("2026-09-04"), email: "b@x.com", estimate_id: "e3", converted_at: at("2026-09-04", 11), last_seen_at: null, lead_source: null },   // saved, never sent
        { id: "d4", started_at: at("2026-09-05"), email: "c@x.com", estimate_id: "e4", converted_at: at("2026-09-05", 11), last_seen_at: null, lead_source: null },   // sent, never opened
        { id: "d5", started_at: at("2026-09-06"), email: "d@x.com", estimate_id: "e5", converted_at: at("2026-09-06", 11), last_seen_at: null, lead_source: null },   // accepted
        { id: "d6", started_at: at("2026-08-15"), email: "e@x.com", estimate_id: null, converted_at: null, last_seen_at: null, lead_source: null },       // last month
      ],
      estimates: [
        { id: "e3", status: "draft", sent_at: null, viewed_at: null, accepted_at: null, declined_at: null, lead_source: null },
        { id: "e4", status: "sent", sent_at: at("2026-09-05", 12), viewed_at: null, accepted_at: null, declined_at: null, lead_source: "referral" },
        { id: "e5", status: "accepted", sent_at: at("2026-09-06", 12), viewed_at: at("2026-09-07"), accepted_at: at("2026-09-09", 12), declined_at: null, lead_source: "social" },
      ],
    },
  };
  it("counts each step as a cohort of sessions started in the range, with the drop-offs written out", () => {
    const f = buildFunnel(fInput, range);
    expect(f.steps.map((s) => [s.key, s.count])).toEqual([["started", 5], ["email", 4], ["saved", 3], ["sent", 2], ["viewed", 1], ["accepted", 1]]);
    expect(f.steps[1].drop_note).toBe("1 dropped before leaving an email — nothing to chase");
    expect(f.steps[4].drop_note).toBe("1 never opened — chase ladder running");
    expect(f.median_days_sent_to_accepted).toBe(3);
    expect(f.self_serve_note).toContain("outcome tier");
  });
  it("the export rows are the sessions with their furthest step; a sales login may run it", () => {
    const r = runMetric(wizardSessions, fInput, range, ["sales"]);
    expect(r.value).toBe(5);
    expect(r.rows.map((x) => x.furthest)).toEqual(["started", "email", "saved", "sent", "accepted"]);
    expect(r.rows[4].lead_source).toBe("social");
    expect(r.compare).toBe(1);
    expect(r.note).toBe("1 accepted · 2 warm, not sent");
  });
});

describe("activity — the CRM timeline, role-scoped", () => {
  it("families: estimates, messages, jobs, money, wizard, visits", () => {
    expect(familyOf("estimate_viewed")).toBe("estimates");
    expect(familyOf("message_in")).toBe("messages");
    expect(familyOf("job_completed")).toBe("jobs");
    expect(familyOf("invoice_paid")).toBe("money");
    expect(familyOf("wizard_started")).toBe("wizard");
    expect(familyOf("visit_booked")).toBe("visits");
    expect(familiesFor(["finance"])).toEqual(["messages", "money"]);
    expect(familiesFor(["pc", "sales"])).toEqual(["estimates", "messages", "jobs", "wizard", "visits"]);
    expect(familiesFor(["owner"])).toHaveLength(7);
  });
  it("a finance login sees money and messages only; the filters narrow further; the same label wording as the record", () => {
    const events = [
      { id: "1", type: "invoice_paid", payload: { amountCents: 120000 }, occurred_at: "2026-09-10T02:00:00Z", source: "system", account_id: "a", account_name: "Lachlan Reid" },
      { id: "2", type: "message_in", payload: { channel: "sms", excerpt: "Can you do the ceilings" }, occurred_at: "2026-09-11T02:00:00Z", source: "customer", account_id: "b", account_name: "Mark Ellis" },
      { id: "3", type: "estimate_viewed", payload: {}, occurred_at: "2026-09-12T02:00:00Z", source: "customer", account_id: "c", account_name: "Priya Nair" },
      { id: "4", type: "job_completed", payload: {}, occurred_at: "2026-08-12T02:00:00Z", source: "system", account_id: "d", account_name: "Old" },
    ];
    const base = { now: SEED_NOW, estimates: [] };
    const fin = runMetric(activity, { ...base, activity: { events, roles: ["finance"], family: null, q: null } }, range, ["finance"]);
    expect(fin.rows.map((r) => r.type)).toEqual(["message_in", "invoice_paid"]);   // newest first
    expect(fin.rows[1].who).toBe("Lachlan Reid");
    const only = runMetric(activity, { ...base, activity: { events, roles: ["finance"], family: "money", q: null } }, range, ["finance"]);
    expect(only.rows.map((r) => r.type)).toEqual(["invoice_paid"]);
    const q = runMetric(activity, { ...base, activity: { events, roles: ["owner"], family: null, q: "priya" } }, range, owner);
    expect(q.rows.map((r) => r.who)).toEqual(["Priya Nair"]);
    const all = runMetric(activity, { ...base, activity: { events, roles: ["owner"], family: null, q: null } }, range, owner);
    expect(all.value).toBe(3);
    expect(all.compare).toBe(1);
  });
});
