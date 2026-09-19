/**
 * Session 1 — the first metrics, in the Sales section, as the pattern every
 * later session copies: a definition string beside the function, rows the
 * tile is the count or sum of, and nothing computed anywhere else.
 */
import { inRange, type EstimateRow, type MetricDef } from "../core";

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
