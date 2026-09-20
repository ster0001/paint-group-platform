/**
 * Session 1 — the first metrics, in the Sales section, as the pattern every
 * later session copies: a definition string beside the function, rows the
 * tile is the count or sum of, and nothing computed anywhere else.
 */
import { inRange, type EstimateRow, type MetricDef, type MetricInput } from "../core";

export type SentEstimateRow = {
  id: string; title: string; sent_on: string; status: string; total_cents: number;
  lead_source: string; sent_by_user_id: string;
};

export type AcceptedEstimateRow = {
  id: string; title: string; accepted_on: string; sent_on: string; accepted_total_cents: number;
  lead_source: string; sent_by_user_id: string;
};

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : "");

const sentRows = (estimates: EstimateRow[], range: { from: string; to: string }): SentEstimateRow[] =>
  estimates
    .filter((e) => inRange(e.sent_at, range))
    .map((e) => ({
      id: e.id, title: e.title ?? "", sent_on: day(e.sent_at), status: e.status, total_cents: e.total_cents,
      lead_source: e.lead_source ?? "unknown", sent_by_user_id: e.sent_by_user_id ?? "",
    }))
    .sort((a, b) => (a.sent_on < b.sent_on ? 1 : a.sent_on > b.sent_on ? -1 : a.id.localeCompare(b.id)));

const acceptedRows = (estimates: EstimateRow[], range: { from: string; to: string }): AcceptedEstimateRow[] =>
  estimates
    .filter((e) => e.status === "accepted" && inRange(e.accepted_at, range))
    .map((e) => ({
      id: e.id, title: e.title ?? "", accepted_on: day(e.accepted_at), sent_on: day(e.sent_at),
      // The figure the customer signed. A pre-snapshot row falls back to the estimate's total.
      accepted_total_cents: e.accepted_total_cents ?? e.total_cents,
      lead_source: e.lead_source ?? "unknown", sent_by_user_id: e.sent_by_user_id ?? "",
    }))
    .sort((a, b) => (a.accepted_on < b.accepted_on ? 1 : a.accepted_on > b.accepted_on ? -1 : a.id.localeCompare(b.id)));

export const estimatesSent: MetricDef<SentEstimateRow> = {
  key: "sales.estimates_sent",
  kind: "period",
  section: "sales",
  title: "Estimates sent",
  definition: "Estimates whose send happened on a day in the range (estimates.sent_at, Melbourne days). Re-sends do not count twice: sent_at is the first send. Compared with the previous period of the same length.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: "count",
  columns: [
    { key: "sent_on", label: "Sent" }, { key: "title", label: "Estimate" }, { key: "status", label: "Status" },
    { key: "total_cents", label: "Total (cents, inc GST)" }, { key: "lead_source", label: "Lead source" }, { key: "sent_by_user_id", label: "Sent by (user id)" },
  ],
  href: "/estimates?status=sent",
  select: (input, range) => sentRows(input.estimates, range),
};

export const salesCount: MetricDef<AcceptedEstimateRow> = {
  key: "sales.sales_count",
  kind: "period",
  section: "sales",
  title: "Sales (number)",
  definition: "Estimates accepted on a day in the range (estimates.accepted_at, Melbourne days), whatever month they were sent. Compared with the previous period of the same length.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: "count",
  columns: [
    { key: "accepted_on", label: "Accepted" }, { key: "sent_on", label: "Sent" }, { key: "title", label: "Estimate" },
    { key: "accepted_total_cents", label: "Accepted total (cents, inc GST)" }, { key: "lead_source", label: "Lead source" }, { key: "sent_by_user_id", label: "Sent by (user id)" },
  ],
  href: "/estimates?status=accepted",
  select: (input, range) => acceptedRows(input.estimates, range),
};

export const salesCents: MetricDef<AcceptedEstimateRow> = {
  key: "sales.sales_cents",
  kind: "period",
  section: "sales",
  title: "Sales $",
  definition: "The signed totals, inc GST, of estimates accepted on a day in the range — recognised on the acceptance date, not when invoiced or paid. Compared with the previous period of the same length.",
  unit: "cents",
  gst: "inc",
  roles: ["owner", "admin", "sales"],
  aggregate: { sum: "accepted_total_cents" },
  columns: salesCount.columns,
  href: "/estimates?status=accepted",
  select: (input, range) => acceptedRows(input.estimates, range),
};

// ---- session 3 ---------------------------------------------------------------

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const daysBetweenIso = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000 * 10) / 10;

/** "Mine" for a sales-only login: the rows narrow to the estimates they sent. */
const mine = (input: MetricInput, e: EstimateRow) => input.sales?.who !== "mine" || !input.sales.viewerUserId || e.sent_by_user_id === input.sales.viewerUserId;

export type ConversionRow = { title: string; sent_on: string; outcome: string; accepted: boolean; accepted_on: string; days_to_accept: number; accepted_total_cents: number; lead_source: string; sent_by: string };
const staffName = (input: MetricInput, id: string | null) => (id ? input.sales?.staff.find((s) => s.id === id)?.name ?? id.slice(0, 8) : "Wizard (self-serve)");

export const conversion: MetricDef<ConversionRow> = {
  key: "sales.conversion",
  kind: "period",
  section: "sales",
  title: "Conversion",
  definition: "Accepted ÷ sent, as a cohort by the month SENT: every estimate sent on a day in the range, and how many of those went on to be accepted (whenever). \"Still open\" is sent and neither accepted nor declined. Compared with the previous period's cohort.",
  unit: "pct",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: { shareWhere: "accepted" },
  columns: [
    { key: "sent_on", label: "Sent" }, { key: "title", label: "Estimate" }, { key: "outcome", label: "Outcome" }, { key: "accepted_on", label: "Accepted" },
    { key: "days_to_accept", label: "Days to accept" }, { key: "accepted_total_cents", label: "Accepted total (cents, inc GST)" }, { key: "lead_source", label: "Lead source" }, { key: "sent_by", label: "Sent by" },
  ],
  href: "/estimates",
  select: (input, range) => input.estimates
    .filter((e) => inRange(e.sent_at, range) && mine(input, e))
    .map((e) => ({
      title: e.title ?? "", sent_on: day(e.sent_at), outcome: e.status === "accepted" ? "accepted" : e.status === "declined" || e.status === "expired" ? e.status : "still open",
      accepted: e.status === "accepted", accepted_on: e.status === "accepted" ? day(e.accepted_at) : "",
      days_to_accept: e.status === "accepted" && e.accepted_at && e.sent_at ? daysBetweenIso(e.sent_at, e.accepted_at) : 0,
      accepted_total_cents: e.status === "accepted" ? (e.accepted_total_cents ?? e.total_cents) : 0, lead_source: e.lead_source ?? "unknown", sent_by: staffName(input, e.sent_by_user_id),
    })),
  note: (rows) => rows.length ? `${rows.filter((r) => r.accepted).length} of ${rows.length} sent · ${rows.filter((r) => r.outcome === "still open").length} still open` : "nothing sent in this range",
};

export type AovRow = { category: string; accepted: number; total_cents: number; aov_cents: number; median_cents: number };
export const aovByCategory: MetricDef<AovRow> = {
  key: "sales.aov_by_category",
  kind: "period",
  section: "sales",
  title: "Average order value",
  definition: "Accepted totals inc GST ÷ accepted count, over estimates accepted on a day in the range, grouped by the category label of the presentation on the estimate (Settings → Presentations). An estimate with no presentation is \"Uncategorised\". The tile is the overall figure; each row carries its own average and median.",
  unit: "cents",
  gst: "inc",
  roles: ["owner", "admin", "sales"],
  aggregate: { divide: { num: "total_cents", den: "accepted" } },
  columns: [{ key: "category", label: "Category" }, { key: "accepted", label: "Accepted" }, { key: "total_cents", label: "Total (cents, inc GST)" }, { key: "aov_cents", label: "Average (cents)" }, { key: "median_cents", label: "Median (cents)" }],
  href: "/estimates?status=accepted",
  display: "rows",
  select: (input, range) => {
    const label = new Map((input.sales?.presentations ?? []).map((p) => [p.id, p.category_label || "Uncategorised"]));
    const groups = new Map<string, number[]>();
    for (const e of input.estimates) {
      if (e.status !== "accepted" || !inRange(e.accepted_at, range) || !mine(input, e)) continue;
      const cat = (e.presentation_id && label.get(e.presentation_id)) || "Uncategorised";
      groups.set(cat, [...(groups.get(cat) ?? []), e.accepted_total_cents ?? e.total_cents]);
    }
    return [...groups.entries()]
      .map(([category, totals]) => ({ category, accepted: totals.length, total_cents: totals.reduce((s, x) => s + x, 0), aov_cents: Math.round(totals.reduce((s, x) => s + x, 0) / totals.length), median_cents: median(totals) }))
      .sort((a, b) => (a.category === "Uncategorised" ? 1 : b.category === "Uncategorised" ? -1 : b.total_cents - a.total_cents));
  },
  note: (rows) => rows.length ? `${rows.reduce((s, r) => s + r.accepted, 0)} accepted across ${rows.length} categor${rows.length === 1 ? "y" : "ies"}` : "nothing accepted in this range",
};

export type SalespersonRow = { name: string; user_id: string; sent: number; accepted: number; sales_cents: number; conversion_pct: number };
export const bySalesperson: MetricDef<SalespersonRow> = {
  key: "sales.by_salesperson",
  kind: "period",
  section: "sales",
  title: "By salesperson",
  definition: "Per person who pressed Send (estimates.sent_by_user_id): estimates sent on a day in the range, how many of those were accepted (whenever), the accepted total inc GST, and the conversion. Estimates sent by the wizard's own flow are \"Wizard (self-serve)\". A sales login sees its own row by default; Team shows everyone.",
  unit: "cents",
  gst: "inc",
  roles: ["owner", "admin", "sales"],
  aggregate: { sum: "sales_cents" },
  columns: [{ key: "name", label: "Salesperson" }, { key: "sent", label: "Sent" }, { key: "accepted", label: "Accepted" }, { key: "sales_cents", label: "Sales (cents, inc GST)" }, { key: "conversion_pct", label: "Conversion (%)" }],
  href: "/estimates",
  display: "rows",
  select: (input, range) => {
    const groups = new Map<string, { sent: number; accepted: number; sales: number }>();
    for (const e of input.estimates) {
      if (!inRange(e.sent_at, range) || !mine(input, e)) continue;
      const k = e.sent_by_user_id ?? "";
      const g = groups.get(k) ?? { sent: 0, accepted: 0, sales: 0 };
      g.sent += 1;
      if (e.status === "accepted") { g.accepted += 1; g.sales += e.accepted_total_cents ?? e.total_cents; }
      groups.set(k, g);
    }
    return [...groups.entries()]
      .map(([user_id, g]) => ({ name: staffName(input, user_id || null), user_id, sent: g.sent, accepted: g.accepted, sales_cents: g.sales, conversion_pct: g.sent ? Math.round((g.accepted / g.sent) * 100) : 0 }))
      .sort((a, b) => b.sales_cents - a.sales_cents);
  },
  note: (rows, _v, input) => rows.length ? `${input.sales?.who === "mine" ? "you" : `${rows.length} ${rows.length === 1 ? "person" : "people"}`} · ${money(rows.reduce((s, r) => s + r.sales_cents, 0))} accepted` : "nothing sent in this range",
};
