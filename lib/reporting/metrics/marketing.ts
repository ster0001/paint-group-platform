/**
 * Session 5 — Marketing (owner, admin only — ⚑2). By lead source from the
 * 0a capture on every estimate; spend from Settings "Weekly marketing" or
 * the `marketing_spend` rows where a month has them (⚑5); repeat customers
 * derived from an earlier accepted estimate on the same account, never a
 * stored flag; wizard starts by source from the funnel's own rows.
 */
import { SOURCES } from "@/lib/crm/attribution";
import { inRange, type MetricDef, type MetricInput, type Range } from "../core";
import { funnelRows } from "./funnel";
import { monthsIn, weeksIn } from "./pl";

const ROLES = ["owner", "admin"] as const;
const aud = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const label = (key: string) => SOURCES.find((s) => s.key === key)?.label ?? key;

// ---- by lead source ---------------------------------------------------------------------------

export type SourceRow = { source: string; sent: number; accepted: number; conversion_pct: number; aov_cents: number; revenue_cents: number };
export const bySource: MetricDef<SourceRow> = {
  key: "mk.by_source", kind: "period", section: "marketing", title: "By lead source",
  definition: "Per lead source on the estimate: estimates sent on a day in the range, how many of those were accepted (whenever), conversion, average accepted value and accepted revenue — inc GST, as sold. \"Not recorded\" is an estimate whose source was never captured.",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "revenue_cents" }, display: "rows",
  columns: [{ key: "source", label: "Source" }, { key: "sent", label: "Sent" }, { key: "accepted", label: "Accepted" }, { key: "conversion_pct", label: "Conversion (%)" }, { key: "aov_cents", label: "Average (cents, inc GST)" }, { key: "revenue_cents", label: "Revenue (cents, inc GST)" }], href: "/crm/sources",
  select: (input, range) => {
    const g = new Map<string, { sent: number; accepted: number; revenue: number }>();
    for (const e of input.estimates) {
      if (!inRange(e.sent_at, range)) continue;
      const k = e.lead_source ?? "unknown";
      const x = g.get(k) ?? { sent: 0, accepted: 0, revenue: 0 };
      x.sent += 1; if (e.status === "accepted") { x.accepted += 1; x.revenue += e.accepted_total_cents ?? e.total_cents; }
      g.set(k, x);
    }
    return [...g.entries()].map(([k, x]) => ({ source: label(k), sent: x.sent, accepted: x.accepted, conversion_pct: x.sent ? Math.round((x.accepted / x.sent) * 100) : 0, aov_cents: x.accepted ? Math.round(x.revenue / x.accepted) : 0, revenue_cents: x.revenue }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents || b.sent - a.sent);
  },
  note: (rows) => rows.length ? `${rows.reduce((s, r) => s + r.sent, 0)} sent across ${rows.length} source${rows.length === 1 ? "" : "s"}` : "nothing sent in this range",
};

// ---- spend in a range: recorded months, else the Settings weekly figure ----------------------------

/** Marketing spend for a range: marketing_spend rows for months that have them, else Settings weekly × the uncovered weeks. */
export function spendIn(input: MetricInput, range: Range): { cents: number; recordedMonths: number; basis: "recorded" | "settings" | "mixed" | "none" } {
  const s = input.pl; if (!s) return { cents: 0, recordedMonths: 0, basis: "none" };
  const months = monthsIn(range);
  let recorded = 0; let coveredShare = 0; let recordedMonths = 0;
  for (const m of months) {
    const rows = s.spend.filter((x) => x.month.slice(0, 7) === m.ym);
    if (rows.length) { recorded += Math.round(rows.reduce((t, x) => t + x.spend_cents, 0) * m.share); coveredShare += m.share; recordedMonths += 1; }
  }
  const totalShare = months.reduce((t, m) => t + m.share, 0);
  const uncoveredWeeks = weeksIn(range) * (1 - coveredShare / Math.max(totalShare, 0.001));
  const settings = s.weeklyMarketingCents != null && uncoveredWeeks > 0.01 ? Math.round(s.weeklyMarketingCents * uncoveredWeeks) : 0;
  const cents = recorded + settings;
  return { cents, recordedMonths, basis: recorded && settings ? "mixed" : recorded ? "recorded" : settings ? "settings" : "none" };
}

export type CpaRow = { accepted_on: string; title: string; source: string; spend_share_cents: number; one: number; basis: string };
export const costPerAcceptedJob: MetricDef<CpaRow> = {
  key: "mk.cost_per_accepted", kind: "period", section: "marketing", title: "Cost per accepted job",
  definition: "Blended: marketing spend for the range ÷ estimates accepted in it. Spend is the marketing_spend rows for months that have them, otherwise Settings \"Weekly marketing\" × weeks. Each row is one accepted estimate carrying its equal share of the spend; the per-channel view is the card beside it.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { divide: { num: "spend_share_cents", den: "one" } },
  columns: [{ key: "accepted_on", label: "Accepted" }, { key: "title", label: "Estimate" }, { key: "source", label: "Lead source" }, { key: "spend_share_cents", label: "Share of spend (cents)" }, { key: "basis", label: "Spend basis" }], href: "/settings#dashboard",
  select: (input, range) => {
    const accepted = input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, range));
    const total = spendIn(input, range);
    const share = accepted.length ? Math.round(total.cents / accepted.length) : 0;
    return accepted.map((e) => ({ accepted_on: (e.accepted_at ?? "").slice(0, 10), title: e.title ?? "", source: label(e.lead_source ?? "unknown"), spend_share_cents: share, one: 1, basis: total.basis }));
  },
  note: (rows, _v, input, range) => { const t = spendIn(input, range); return `${aud(t.cents)} spend · ${rows.length} accepted · ${t.basis === "settings" ? "Settings basis" : t.basis === "recorded" ? "recorded spend" : t.basis === "mixed" ? "recorded + Settings" : "no spend recorded or set"}`; },
};

export type ChannelRow = { channel: string; spend_cents: number; accepted: number; cpa_cents: number };
export const cpaByChannel: MetricDef<ChannelRow> = {
  key: "mk.cpa_by_channel", kind: "period", section: "marketing", title: "Cost per accepted job, by channel",
  definition: "Each channel with recorded marketing_spend in the range's months (pro-rated to the range) against the acceptances whose lead source is that channel. Channels with no recorded spend are not shown — the blended tile covers them.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "spend_cents" }, display: "rows",
  columns: [{ key: "channel", label: "Channel" }, { key: "spend_cents", label: "Spend (cents)" }, { key: "accepted", label: "Accepted" }, { key: "cpa_cents", label: "Cost per accepted (cents)" }], href: "/settings#dashboard",
  select: (input, range) => {
    const s = input.pl; if (!s) return [];
    const accepted = input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, range));
    const byChannel = new Map<string, number>();
    for (const m of monthsIn(range)) for (const x of s.spend.filter((r) => r.month.slice(0, 7) === m.ym)) byChannel.set(x.channel, (byChannel.get(x.channel) ?? 0) + Math.round(x.spend_cents * m.share));
    return [...byChannel.entries()].sort((a, b) => b[1] - a[1]).map(([channel, spend]) => { const acc = accepted.filter((e) => e.lead_source === channel).length; return { channel: label(channel), spend_cents: spend, accepted: acc, cpa_cents: acc ? Math.round(spend / acc) : 0 }; });
  },
  note: (rows) => rows.length ? `${rows.length} channel${rows.length === 1 ? "" : "s"} with recorded spend` : "no recorded spend in this range — Settings → Dashboard → Marketing spend",
};

export type SpendSalesRow = { accepted_on: string; title: string; spend_share_cents: number; sales_cents: number };
export const spendVsSales: MetricDef<SpendSalesRow> = {
  key: "mk.spend_vs_sales_pct", kind: "period", section: "marketing", title: "Spend vs sales",
  definition: "Marketing spend for the range as a share of accepted sales (inc GST) in it. Each row is one accepted estimate with its equal share of the spend against its own total, so the tile is spend ÷ sales over the range. The twelve-month trend is the card beside it.",
  unit: "pct", gst: null, roles: ROLES, aggregate: { pctOf: { num: "spend_share_cents", den: "sales_cents" } },
  columns: [{ key: "accepted_on", label: "Accepted" }, { key: "title", label: "Estimate" }, { key: "spend_share_cents", label: "Share of spend (cents)" }, { key: "sales_cents", label: "Accepted (cents, inc GST)" }], href: "/settings#dashboard",
  select: (input, range) => {
    const accepted = input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, range));
    const total = spendIn(input, range);
    const share = accepted.length ? Math.round(total.cents / accepted.length) : 0;
    return accepted.map((e) => ({ accepted_on: (e.accepted_at ?? "").slice(0, 10), title: e.title ?? "", spend_share_cents: share, sales_cents: e.accepted_total_cents ?? e.total_cents }));
  },
  note: (rows, _v, input, range) => { const t = spendIn(input, range); return rows.length ? `${aud(t.cents)} against ${aud(rows.reduce((s, r) => s + r.sales_cents, 0))} · ${t.basis === "recorded" ? "recorded spend" : t.basis === "settings" ? "Settings basis" : t.basis === "mixed" ? "recorded + Settings" : "no spend"}` : "nothing accepted in this range"; },
};

export type TrendRow = { month: string; spend_cents: number; sales_cents: number; pct: number; basis: string };
export const spendVsSalesTrend: MetricDef<TrendRow> = {
  key: "mk.spend_vs_sales_trend", kind: "period", section: "marketing", title: "Spend vs sales, twelve months",
  definition: "Each of the last twelve months: recorded marketing spend (or Settings weekly × 52 ÷ 12 where none is recorded) against that month's accepted totals inc GST, as a percentage.",
  unit: "pct", gst: null, roles: ROLES, aggregate: { pctOf: { num: "spend_cents", den: "sales_cents" } }, display: "rows",
  columns: [{ key: "month", label: "Month" }, { key: "spend_cents", label: "Spend (cents)" }, { key: "sales_cents", label: "Sales (cents, inc GST)" }, { key: "pct", label: "Spend / sales (%)" }, { key: "basis", label: "Basis" }], href: "/settings#dashboard",
  select: (input, range) => {
    const s = input.pl; if (!s) return [];
    const monthly = s.weeklyMarketingCents != null ? Math.round((s.weeklyMarketingCents * 52) / 12) : null;
    const [y, m] = range.to.slice(0, 7).split("-").map(Number);
    const rows: TrendRow[] = [];
    for (let i = 11; i >= 0; i--) {
      const ym = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
      const recorded = s.spend.filter((x) => x.month.slice(0, 7) === ym).reduce((t, x) => t + x.spend_cents, 0);
      const spend = recorded || monthly || 0;
      const sales = s.history.find((h) => h.month === ym)?.sales_cents ?? 0;
      rows.push({ month: ym, spend_cents: spend, sales_cents: sales, pct: sales ? Math.round((spend / sales) * 1000) / 10 : 0, basis: recorded ? "recorded" : monthly ? "Settings" : "none" });
    }
    return rows;
  },
  note: (rows) => `${rows.filter((r) => r.basis === "recorded").length} of 12 months from recorded spend`,
};

// ---- repeat + referral share ------------------------------------------------------------------------

export type RepeatRow = { accepted_on: string; title: string; source: string; repeat: boolean; referral: boolean; repeat_or_referral: boolean; total_cents: number };
export const repeatReferralShare: MetricDef<RepeatRow> = {
  key: "mk.repeat_referral_share", kind: "period", section: "marketing", title: "Repeat + referral share",
  definition: "Of estimates accepted on a day in the range, the share that came from a referral (lead source Referral) or a repeat customer — an account with an accepted estimate before this one; derived, never a typed flag.",
  unit: "pct", gst: null, roles: ROLES, aggregate: { shareWhere: "repeat_or_referral" },
  columns: [{ key: "accepted_on", label: "Accepted" }, { key: "title", label: "Estimate" }, { key: "source", label: "Lead source" }, { key: "repeat", label: "Repeat customer" }, { key: "referral", label: "Referral" }, { key: "total_cents", label: "Accepted (cents, inc GST)" }], href: "/estimates?status=accepted",
  select: (input, range) => {
    const repeat = new Set(input.pl?.repeatAccounts ?? []);
    return input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, range)).map((e) => {
      const isRepeat = Boolean(e.account_id && repeat.has(e.account_id)) || e.lead_source === "repeat_customer";
      const isReferral = e.lead_source === "referral";
      return { accepted_on: (e.accepted_at ?? "").slice(0, 10), title: e.title ?? "", source: label(e.lead_source ?? "unknown"), repeat: isRepeat, referral: isReferral, repeat_or_referral: isRepeat || isReferral, total_cents: e.accepted_total_cents ?? e.total_cents };
    });
  },
  note: (rows) => rows.length ? `${rows.filter((r) => r.repeat).length} repeat · ${rows.filter((r) => r.referral).length} referral · of ${rows.length} accepted` : "nothing accepted in this range",
};

// ---- wizard starts by source ---------------------------------------------------------------------------

export type StartsRow = { source: string; starts: number; saved: number; accepted: number };
export const wizardStartsBySource: MetricDef<StartsRow> = {
  key: "mk.wizard_starts_by_source", kind: "period", section: "marketing", title: "Wizard starts by source",
  definition: "Wizard sessions started on a day in the range, by the lead source on the account or the estimate they became, with how many saved an estimate and how many were accepted — the funnel's own rows, grouped.",
  unit: "count", gst: null, roles: ROLES, aggregate: { sum: "starts" }, display: "rows",
  columns: [{ key: "source", label: "Source" }, { key: "starts", label: "Started" }, { key: "saved", label: "Saved" }, { key: "accepted", label: "Accepted" }], href: "/crm/sources",
  select: (input, range) => {
    const g = new Map<string, { starts: number; saved: number; accepted: number }>();
    for (const r of funnelRows(input, range)) {
      const x = g.get(r.lead_source) ?? { starts: 0, saved: 0, accepted: 0 };
      x.starts += 1; if (r.saved) x.saved += 1; if (r.accepted) x.accepted += 1; g.set(r.lead_source, x);
    }
    return [...g.entries()].map(([k, x]) => ({ source: label(k), ...x })).sort((a, b) => b.starts - a.starts);
  },
  note: (rows) => rows.length ? `${rows.reduce((s, r) => s + r.starts, 0)} starts` : "no wizard sessions in this range",
};

export const MARKETING_METRICS = [bySource, costPerAcceptedJob, cpaByChannel, spendVsSales, spendVsSalesTrend, repeatReferralShare, wizardStartsBySource] as const;
