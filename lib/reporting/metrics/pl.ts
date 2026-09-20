/**
 * Session 5 — P&L (owner, admin only — ⚑2). Ex GST throughout; every tile
 * carries the "Settings basis until MYOB" chip because overhead and weekly
 * marketing come from Settings ("Weekly fixed costs", "Weekly marketing"),
 * and a month with `marketing_spend` rows uses those instead. When MYOB
 * lands the inputs swap and nothing here changes (brief Part A).
 *
 * Gross margin actual vs estimated reads the SAME signed-off-job rows the PC
 * materials card reads (`ClosedJobRow`), with the engine's own
 * `marginCents` on the estimate side and the recorded costs on the actual.
 */
import { daysBetween, inRange, type MetricDef, type MetricInput, type Range } from "../core";

const ROLES = ["owner", "admin"] as const;
const aud = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const exGst = (incCents: number) => Math.round(incCents / 1.1);
const slice = (input: MetricInput) => input.pl ?? null;
export const BASIS_CHIP = "Settings basis until MYOB";

// ---- contracts signed, revenue received -----------------------------------------------

export type SignedRow = { accepted_on: string; title: string; category: string; contract_ex_cents: number; lead_source: string };
export const contractsSigned: MetricDef<SignedRow> = {
  key: "pl.contracts_signed_ex", kind: "period", section: "pl", title: "Contracts signed",
  definition: "The signed totals of estimates accepted on a day in the range, ex GST (the inc-GST figure ÷ 1.1) — the same acceptances as Sales $, on the P&L's basis.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "contract_ex_cents" },
  columns: [{ key: "accepted_on", label: "Accepted" }, { key: "title", label: "Estimate" }, { key: "category", label: "Category" }, { key: "contract_ex_cents", label: "Contract (cents, ex GST)" }, { key: "lead_source", label: "Lead source" }], href: "/estimates?status=accepted",
  select: (input, range) => {
    const label = new Map((input.sales?.presentations ?? []).map((p) => [p.id, p.category_label || "Uncategorised"]));
    return input.estimates.filter((e) => e.status === "accepted" && inRange(e.accepted_at, range))
      .map((e) => ({ accepted_on: (e.accepted_at ?? "").slice(0, 10), title: e.title ?? "", category: (e.presentation_id && label.get(e.presentation_id)) || "Uncategorised", contract_ex_cents: exGst(e.accepted_total_cents ?? e.total_cents), lead_source: e.lead_source ?? "unknown" }));
  },
  note: (rows) => rows.length ? `${rows.length} accepted · ${BASIS_CHIP}` : BASIS_CHIP,
};

export type ReceivedExRow = { paid_on: string; amount_ex_cents: number };
export const revenueReceived: MetricDef<ReceivedExRow> = {
  key: "pl.revenue_received_ex", kind: "period", section: "pl", title: "Revenue received",
  definition: "Customer payments that landed on a day in the range, ex GST (÷ 1.1) — the payment-received status change in invoicing, on the P&L's basis. Refunds are negative.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "amount_ex_cents" },
  columns: [{ key: "paid_on", label: "Paid" }, { key: "amount_ex_cents", label: "Amount (cents, ex GST)" }], href: "/invoicing",
  select: (input, range) => (slice(input)?.payments ?? []).filter((p) => p.paid_on >= range.from && p.paid_on <= range.to).map((p) => ({ paid_on: p.paid_on, amount_ex_cents: exGst(p.amount_cents) })).sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
  note: (rows) => rows.length ? `${rows.length} payment${rows.length === 1 ? "" : "s"} · ${BASIS_CHIP}` : BASIS_CHIP,
};

// ---- gross margin on signed-off jobs ---------------------------------------------------

export type MarginRow = {
  wo_ref: string; title: string; closed_on: string; category: string; size_band: string;
  contract_ex_cents: number; est_margin_cents: number; est_cost_cents: number; actual_cost_cents: number; actual_margin_cents: number; margin_pct: number; materials_pct: number; delta_cents: number;
};
export function marginRows(input: MetricInput, range: Range): MarginRow[] {
  return (slice(input)?.closedJobs ?? [])
    .filter((j) => j.est && j.closed_on >= range.from && j.closed_on <= range.to)
    .map((j) => {
      const est = j.est!;
      const actualCost = j.actual.contractor_cents + j.actual.materials_cents + j.actual.job_costs_cents + j.actual.expenses_cents;
      const actualMargin = est.net_subtotal_cents - est.third_party_cents - actualCost;
      return {
        wo_ref: j.wo_ref, title: j.title, closed_on: j.closed_on, category: j.category, size_band: j.size_band,
        contract_ex_cents: est.net_subtotal_cents, est_margin_cents: est.margin_cents, est_cost_cents: est.contractor_cents + est.materials_cents,
        actual_cost_cents: actualCost, actual_margin_cents: actualMargin,
        margin_pct: est.net_subtotal_cents > 0 ? Math.round((actualMargin / est.net_subtotal_cents) * 1000) / 10 : 0,
        materials_pct: est.net_subtotal_cents > 0 ? Math.round((j.actual.materials_cents / est.net_subtotal_cents) * 1000) / 10 : 0,
        delta_cents: actualMargin - est.margin_cents,
      };
    });
}
const MARGIN_COLUMNS = [
  { key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "closed_on", label: "Signed off" }, { key: "category", label: "Category" }, { key: "size_band", label: "Size band" },
  { key: "contract_ex_cents", label: "Contract (cents, ex GST)" }, { key: "est_margin_cents", label: "Estimated margin (cents)" }, { key: "actual_cost_cents", label: "Actual cost (cents, ex GST)" },
  { key: "actual_margin_cents", label: "Actual margin (cents)" }, { key: "margin_pct", label: "Margin (%)" }, { key: "materials_pct", label: "Materials (% of contract)" }, { key: "delta_cents", label: "Actual − estimated (cents)" },
] as const;

export const grossMargin: MetricDef<MarginRow> = {
  key: "pl.gross_margin_actual", kind: "period", section: "pl", title: "Gross margin, actual",
  definition: "On jobs signed off in the range with a priced scope: the contract ex GST (the engine's net subtotal) less what was actually spent — contractor invoices approved or paid (ex GST), matched supplier invoices, recorded job costs and approved expenses — with the engine's estimated margin beside it. Third-party lines sit outside both, as the engine treats them. One function feeds this and the PC materials card.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "actual_margin_cents" }, columns: MARGIN_COLUMNS, href: "/invoicing",
  select: marginRows,
  note: (rows, value) => rows.length ? `estimated ${aud(rows.reduce((s, r) => s + r.est_margin_cents, 0))} · ${rows.length} job${rows.length === 1 ? "" : "s"} · ${Math.round((value / Math.max(1, rows.reduce((s, r) => s + r.contract_ex_cents, 0))) * 100)}% of contract · ${BASIS_CHIP}` : `no signed-off jobs with a priced scope · ${BASIS_CHIP}`,
};

// ---- net margin on the Settings basis -----------------------------------------------------

export type NetRow = { line: string; cents: number; basis: string };
/** Weeks in a range, fractional — overhead is a weekly Settings figure. */
export const weeksIn = (range: Range) => Math.round((daysBetween(range.from, range.to) / 7) * 100) / 100;

export function netRows(input: MetricInput, range: Range): NetRow[] {
  const s = slice(input); if (!s) return [];
  const gross = marginRows(input, range).reduce((t, r) => t + r.actual_margin_cents, 0);
  const weeks = weeksIn(range);
  const rows: NetRow[] = [{ line: "Gross margin on signed-off jobs", cents: gross, basis: "actual" }];
  if (s.weeklyFixedCents != null) rows.push({ line: `Fixed overhead · ${weeks} weeks × ${aud(s.weeklyFixedCents)}`, cents: -Math.round(s.weeklyFixedCents * weeks), basis: "Settings" });
  // Marketing: months with recorded spend use it; the rest of the range falls back to the weekly Settings figure.
  const months = monthsIn(range);
  let recorded = 0; let recordedMonths = 0;
  for (const m of months) {
    const rowsForMonth = s.spend.filter((x) => x.month.slice(0, 7) === m.ym);
    if (rowsForMonth.length) { recorded += Math.round(rowsForMonth.reduce((t, x) => t + x.spend_cents, 0) * m.share); recordedMonths += 1; }
  }
  const uncoveredWeeks = Math.round(weeks * (1 - months.filter((m) => s.spend.some((x) => x.month.slice(0, 7) === m.ym)).reduce((t, m) => t + m.share, 0) / Math.max(1, months.reduce((t, m) => t + m.share, 0))) * 100) / 100;
  if (recorded) rows.push({ line: `Marketing · recorded for ${recordedMonths} month${recordedMonths === 1 ? "" : "s"}`, cents: -recorded, basis: "marketing_spend" });
  if (s.weeklyMarketingCents != null && uncoveredWeeks > 0.01) rows.push({ line: `Marketing · ${uncoveredWeeks} weeks × ${aud(s.weeklyMarketingCents)}`, cents: -Math.round(s.weeklyMarketingCents * uncoveredWeeks), basis: "Settings" });
  return rows;
}

/** The calendar months a range touches, with the share of each month that lies inside the range. */
export function monthsIn(range: Range): { ym: string; share: number }[] {
  const out: { ym: string; share: number }[] = [];
  let cursor = range.from.slice(0, 7);
  while (cursor <= range.to.slice(0, 7)) {
    const [y, m] = cursor.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = cursor === range.from.slice(0, 7) ? Number(range.from.slice(8, 10)) : 1;
    const end = cursor === range.to.slice(0, 7) ? Number(range.to.slice(8, 10)) : days;
    out.push({ ym: cursor, share: Math.round(((end - start + 1) / days) * 1000) / 1000 });
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  return out;
}

export const netMargin: MetricDef<NetRow> = {
  key: "pl.net_margin_ex", kind: "period", section: "pl", title: "Net margin",
  definition: "Gross margin on signed-off jobs less overhead for the range: fixed overhead = Settings \"Weekly fixed costs\" × weeks; marketing = the marketing_spend rows for months that have them, otherwise Settings \"Weekly marketing\" × the uncovered weeks. Ex GST. Settings basis until MYOB supplies actuals — then the inputs swap and this reads the same.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "cents" }, display: "rows",
  columns: [{ key: "line", label: "Line" }, { key: "cents", label: "Cents (ex GST)" }, { key: "basis", label: "Basis" }], href: "/settings#dashboard",
  select: netRows,
  note: (rows, _v, input) => { const s = slice(input); return s?.weeklyFixedCents == null ? "Weekly fixed costs not set in Settings — overhead not deducted" : rows.some((r) => r.basis === "marketing_spend") ? `${BASIS_CHIP} · marketing from recorded spend where a month has it` : BASIS_CHIP; },
};

// ---- margin by size band, by category ------------------------------------------------------

export type BandRow = { band: string; jobs: number; contract_ex_cents: number; actual_margin_cents: number; margin_pct: number; materials_pct: number };
const groupRows = (rows: MarginRow[], key: (r: MarginRow) => string): BandRow[] => {
  const g = new Map<string, MarginRow[]>();
  for (const r of rows) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
  return [...g.entries()].map(([band, rs]) => {
    const contract = rs.reduce((t, r) => t + r.contract_ex_cents, 0); const margin = rs.reduce((t, r) => t + r.actual_margin_cents, 0);
    const materials = rs.reduce((t, r) => t + (r.materials_pct / 100) * r.contract_ex_cents, 0);
    return { band, jobs: rs.length, contract_ex_cents: contract, actual_margin_cents: margin, margin_pct: contract > 0 ? Math.round((margin / contract) * 1000) / 10 : 0, materials_pct: contract > 0 ? Math.round((materials / contract) * 1000) / 10 : 0 };
  }).sort((a, b) => b.contract_ex_cents - a.contract_ex_cents);
};
const BAND_LABEL: Record<string, string> = { under_10k: "Under $10k", "10_to_20k": "$10k – $20k", over_20k: "Over $20k" };
const BAND_COLUMNS = [{ key: "band", label: "Band" }, { key: "jobs", label: "Jobs" }, { key: "contract_ex_cents", label: "Contract (cents, ex GST)" }, { key: "actual_margin_cents", label: "Actual margin (cents)" }, { key: "margin_pct", label: "Margin (%)" }, { key: "materials_pct", label: "Materials (%)" }] as const;

export const marginBySize: MetricDef<BandRow> = {
  key: "pl.margin_by_size", kind: "period", section: "pl", title: "Margin by job size",
  definition: "Actual gross margin on signed-off jobs in the range, grouped by the estimate's size band (under $10k, $10k–$20k, over $20k), as a share of contract ex GST. The tile is the overall share.",
  unit: "pct", gst: "ex", roles: ROLES, aggregate: { pctOf: { num: "actual_margin_cents", den: "contract_ex_cents" } }, display: "rows", columns: BAND_COLUMNS, href: "/invoicing",
  select: (input, range) => groupRows(marginRows(input, range), (r) => BAND_LABEL[r.size_band] ?? (r.size_band || "No band")),
  note: () => BASIS_CHIP,
};

export const marginByCategory: MetricDef<BandRow> = {
  key: "pl.margin_by_category", kind: "period", section: "pl", title: "Margin and materials by category",
  definition: "Actual gross margin and the materials share of contract on signed-off jobs in the range, grouped by the presentation's category label on the estimate (no presentation = Uncategorised). Ex GST.",
  unit: "pct", gst: "ex", roles: ROLES, aggregate: { pctOf: { num: "actual_margin_cents", den: "contract_ex_cents" } }, display: "rows", columns: BAND_COLUMNS, href: "/invoicing",
  select: (input, range) => groupRows(marginRows(input, range), (r) => r.category),
  note: () => BASIS_CHIP,
};

export const PL_METRICS = [contractsSigned, revenueReceived, grossMargin, netMargin, marginBySize, marginByCategory] as const;
