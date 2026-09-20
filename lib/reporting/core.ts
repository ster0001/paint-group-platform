/**
 * Home dashboard v2 · session 1 — the reporting core.
 *
 * A metric is a pure function over rows the loader fetched. It returns
 * `{ value, compare, rows, definition }` and nothing else computes it: the
 * tile, the drill-through list, the CSV export and the nightly rollup all
 * call the same function, so a tile can never disagree with its list
 * (acceptance 1) or with /invoicing and the PC console (acceptance 2).
 *
 * Two kinds (brief Part C):
 *   P — period: moves with the date filter, compared with the previous
 *       period of the same length.
 *   N — now: a state count "right now"; the filter is ignored and the tile
 *       says so.
 *
 * The role check lives INSIDE `runMetric`, not in the page: a route or an
 * export that reaches a metric the caller's roles do not cover gets
 * `ForbiddenError` (→ 403), whatever screen asked (acceptance 4).
 *
 * The value is never typed by hand: it is `count` of the rows or `sum` of one
 * of their columns, so "tile equals its rows" holds by construction.
 * Money is integer cents; GST basis is a label on the definition.
 */
import { type DashboardRole, type DashboardSection, canSeeSection } from "./roles";

export type MetricKind = "period" | "now";
export type MetricUnit = "count" | "cents" | "pct" | "days" | "hours";
export type GstBasis = "inc" | "ex" | null;

export type Range = { from: string; to: string };   // yyyy-mm-dd, Melbourne calendar days, inclusive

export type MetricDef<Row extends object> = {
  key: string;
  kind: MetricKind;
  section: DashboardSection;
  title: string;
  /** The "i" on the tile. A metric without one fails `registry.test.ts` (acceptance 13). */
  definition: string;
  unit: MetricUnit;
  gst: GstBasis;
  /** Who may compute it. Owner and admin are implied by the section map; listed here for the route gate. */
  roles: ReadonlyArray<DashboardRole>;
  /** How the value is read off the rows — never typed by hand.
   *  count · sum of a column · count of rows where a column is truthy ("8 of 11")
   *  · a ratio of two column sums as a percentage ("hours vs estimate +6.8%"). */
  aggregate: Aggregate<Row>;
  /** One line under the value — "of 11 · 73%", "actual on 4 of 11 jobs" — from the rows. */
  note?: (rows: Row[], value: number, input: MetricInput, range: Range) => string;
  /** The CSV columns, in order. */
  columns: ReadonlyArray<{ key: keyof Row & string; label: string }>;
  /** Where a tile click goes. */
  href?: string;
  /** "rows": the mockup's list card (AOV by category, by salesperson, activity) rather than a stat tile. */
  display?: "tile" | "rows";
  /** Period metrics: the rows that fall in a range. Now metrics: every row (the range is ignored). */
  select: (input: MetricInput, range: Range) => Row[];
};

export type Aggregate<Row extends object> =
  | "count"
  | { sum: keyof Row & string }
  | { countWhere: keyof Row & string }
  | { ratioPct: { num: keyof Row & string; den: keyof Row & string } }
  /** rows where the column is truthy, as a percentage of all rows ("47% of sent") */
  | { shareWhere: keyof Row & string }
  /** sum(num) ÷ sum(den) — an average order value from per-group rows */
  | { divide: { num: keyof Row & string; den: keyof Row & string } }
  /** 100 × sum(num) ÷ sum(den), one decimal — spend as a share of sales */
  | { pctOf: { num: keyof Row & string; den: keyof Row & string } };

/** Everything a metric may read. Loaders fill what a page needs; a metric reads only its own slice. */
export type MetricInput = {
  now: Date;
  estimates: EstimateRow[];
  /** Session 2: the PC console's own input and cards — the same evaluator the /pc page runs. */
  console?: ConsoleSlice | null;
  /** Session 2: the contractor-side rows (0c capture). */
  contractors?: ContractorSlice | null;
  /** Session 3: presentations (categories), staff names, targets, 12 months of history, and who is looking. */
  sales?: SalesSlice | null;
  /** Session 3: wizard sessions and the estimates they became. */
  funnel?: FunnelSlice | null;
  /** Session 3: the CRM timeline, role-scoped by the metric. */
  activity?: ActivitySlice | null;
  /** Session 4: the invoicing dashboard's own rows (app/invoicing/data.ts loadDashboard), plus the period's payments. */
  invoicing?: InvoicingSlice | null;
  /** Session 5: signed-off jobs with estimated vs actual costs, overhead settings, marketing spend, payments — owner/admin. */
  pl?: PlSlice | null;
  /** Session 5: the strip's anomaly threshold (Settings dashboard_anomaly_threshold_pct). */
  thresholds?: { anomalyPct: number } | null;
};

export type ClosedJobRow = {
  work_order_id: string; wo_ref: string; title: string; closed_on: string; estimate_id: string | null;
  category: string; size_band: string; account_id: string | null; lead_source: string | null;
  /** The engine on the estimate behind the job, ex GST. Null when the estimate has no priced scope. */
  est: { net_subtotal_cents: number; contractor_cents: number; materials_cents: number; third_party_cents: number; margin_cents: number } | null;
  /** What was actually spent, ex GST: contractor invoices (approved or paid), supplier invoices, job costs, approved expenses. */
  actual: { contractor_cents: number; materials_cents: number; job_costs_cents: number; expenses_cents: number };
};

export type PlSlice = {
  closedJobs: ClosedJobRow[];
  /** Settings, ex GST, per week: "Weekly fixed costs", "Weekly marketing". Null when not set. */
  weeklyFixedCents: number | null;
  weeklyMarketingCents: number | null;
  /** marketing_spend rows over the last 13 months (month yyyy-mm-01). */
  spend: { month: string; channel: string; spend_cents: number }[];
  /** Succeeded payments landed in the window, inc GST. */
  payments: { paid_on: string; amount_cents: number }[];
  /** Accounts (accepted in the window) that had an accepted estimate BEFORE the one in the window. */
  repeatAccounts: string[];
  /** Twelve months of accepted totals by month (inc GST) — shared with the target card. */
  history: { month: string; sales_cents: number; accepted: number }[];
};

export type InvoicingSlice = {
  /** The same rows /invoicing draws its pulse tiles from — one read, shared. */
  invoices: import("@/lib/invoicing/derive").DeriveInvoice[];
  payments: import("@/lib/invoicing/derive").DerivePayment[];
  contractorInvoices: (import("@/lib/invoicing/derive").DeriveContractorInvoice & { id: string; number: string | null; contractor: string; wo_ref: string; submitted_at: string | null })[];
  /** Display fields per invoice id: number, customer, address, the job's booked start. */
  invoiceInfo: Record<string, { number: string; customer: string; address: string; start_date: string | null }>;
  /** Succeeded payments landing (paid_on) in the window, with their invoice's number and kind — the period tiles. */
  paymentsInWindow: { paid_on: string; amount_cents: number; method: string; invoice_id: string; number: string; customer: string; kind: string; issued_on: string | null }[];
  /** Settings: the two ageing edges (1–7 / 8–30 / 31+ by default). */
  ageingEdges: [number, number];
  /** Melbourne today, yyyy-mm-dd — the instant the /invoicing tiles are also computed for. */
  today: string;
};

export type SalesSlice = {
  presentations: { id: string; category_label: string }[];
  staff: { id: string; name: string }[];
  /** sales_targets rows the viewer may see (owner/admin — RLS); month is yyyy-mm-01. */
  targets: { month: string; target_cents: number }[];
  /** Accepted estimates over the last 12 months, for the chart: month yyyy-mm, cents inc GST. */
  history: { month: string; sales_cents: number; accepted: number }[];
  viewerUserId: string | null;
  /** "mine" (a sales login's default) or "team". */
  who: "mine" | "team";
};

export type FunnelSlice = {
  drafts: { id: string; started_at: string; email: string | null; estimate_id: string | null; converted_at: string | null; last_seen_at: string | null; lead_source: string | null }[];
  /** The estimates the drafts became, whatever their date. */
  estimates: FunnelEstimate[];
};
export type FunnelEstimate = { id: string; status: string; sent_at: string | null; viewed_at: string | null; accepted_at: string | null; declined_at: string | null; lead_source: string | null };

export type ActivityEvent = { id: string; type: string; payload: Record<string, unknown> | null; occurred_at: string; source: string; account_id: string | null; account_name: string | null };
export type ActivitySlice = {
  events: ActivityEvent[];
  /** The viewer's roles decide which event families the feed shows. */
  roles: ReadonlyArray<DashboardRole>;
  /** Optional filters from the page: an event family and free text over customer / detail. */
  family: string | null;
  q: string | null;
};

export type ConsoleSlice = {
  input: import("@/lib/workorder/console").ConsoleInput;
  cards: import("@/lib/workorder/console").QueueCard[];
  /** crm_account_facts where the customer wrote in after the last person replied (0b). */
  awaitingReply: AwaitingReplyRow[];
  /** Signed-off jobs in the window with their materials budget (engine) and supplier invoices. */
  materials: MaterialsJobRow[];
};

export type AwaitingReplyRow = { account_id: string; name: string; last_inbound_at: string; last_staff_reply_at: string | null };
export type MaterialsJobRow = { work_order_id: string; wo_ref: string; title: string; closed_on: string; budget_cents: number | null; invoiced_ex_cents: number };

export type ContractorSlice = {
  contractors: { id: string; name: string; works_saturday: boolean; works_sunday: boolean }[];
  /** Jobs whose last surface was ticked (wo_events 'all_surfaces_done') — the completion facts. */
  done: { work_order_id: string; wo_ref: string; title: string; contractor_id: string | null; done_at: string; end_date: string | null; start_date: string | null; hours_allowance: number | null; entered: { days: number; hours: number } | null }[];
  qaChecks: { work_order_id: string; wo_ref: string; contractor_id: string | null; attempt_no: number; result: string; checked_at: string }[];
  offers: { work_order_id: string; wo_ref: string; contractor_id: string; offered_at: string; accepted_at: string }[];
  variations: { work_order_id: string; wo_ref: string; contractor_id: string | null; created_at: string; status: string }[];
  pendingExpenses: { id: string; work_order_id: string; wo_ref: string; contractor_id: string; amount_cents: number; created_at: string; category: string }[];
  silentDays: number;
  dayHours: number;
};

export type EstimateRow = {
  id: string;
  title: string | null;
  status: string;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  total_cents: number;
  accepted_total_cents: number | null;
  sent_by_user_id: string | null;
  lead_source: string | null;
  presentation_id: string | null;
  account_id: string | null;
  created_at: string;
};

export type MetricResult<Row extends object = Record<string, unknown>> = {
  key: string;
  kind: MetricKind;
  title: string;
  definition: string;
  unit: MetricUnit;
  gst: GstBasis;
  value: number;
  /** Period only: the same measure over the previous period of equal length. Null for `now`. */
  compare: number | null;
  range: Range | null;
  compareRange: Range | null;
  rows: Row[];
  note: string | null;
  href?: string;
};

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(key: string) { super(`metric ${key} is not available to this login`); }
}

const num = (r: object, key: string): number => {
  const v = (r as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

export function aggregateRows<Row extends object>(rows: Row[], aggregate: Aggregate<Row>): number {
  if (aggregate === "count") return rows.length;
  if ("sum" in aggregate) return rows.reduce((s, r) => s + num(r, aggregate.sum), 0);
  if ("countWhere" in aggregate) return rows.filter((r) => Boolean((r as Record<string, unknown>)[aggregate.countWhere])).length;
  if ("shareWhere" in aggregate) return rows.length ? Math.round((rows.filter((r) => Boolean((r as Record<string, unknown>)[aggregate.shareWhere])).length / rows.length) * 1000) / 10 : 0;
  if ("divide" in aggregate) { const d = rows.reduce((s, r) => s + num(r, aggregate.divide.den), 0); return d > 0 ? Math.round(rows.reduce((s, r) => s + num(r, aggregate.divide.num), 0) / d) : 0; }
  if ("pctOf" in aggregate) { const d = rows.reduce((s, r) => s + num(r, aggregate.pctOf.den), 0); return d > 0 ? Math.round((rows.reduce((s, r) => s + num(r, aggregate.pctOf.num), 0) / d) * 1000) / 10 : 0; }
  const numSum = rows.reduce((s, r) => s + num(r, aggregate.ratioPct.num), 0);
  const denSum = rows.reduce((s, r) => s + num(r, aggregate.ratioPct.den), 0);
  return denSum > 0 ? Math.round(((numSum - denSum) / denSum) * 1000) / 10 : 0;
}

/** The one gate every caller goes through. */
export function runMetric<Row extends object>(
  def: MetricDef<Row>, input: MetricInput, range: Range, roles: ReadonlyArray<DashboardRole>,
): MetricResult<Row> {
  if (!def.roles.some((r) => roles.includes(r)) || !canSeeSection(roles, def.section)) throw new ForbiddenError(def.key);
  if (def.kind === "now") {
    const rows = def.select(input, range);
    const value = aggregateRows(rows, def.aggregate);
    return { key: def.key, kind: "now", title: def.title, definition: def.definition, unit: def.unit, gst: def.gst,
      value, compare: null, range: null, compareRange: null, rows, note: def.note?.(rows, value, input, range) || null, href: def.href };
  }
  const rows = def.select(input, range);
  const prev = previousRange(range);
  const compareRows = def.select(input, prev);
  const value = aggregateRows(rows, def.aggregate);
  return { key: def.key, kind: "period", title: def.title, definition: def.definition, unit: def.unit, gst: def.gst,
    value, compare: aggregateRows(compareRows, def.aggregate),
    range, compareRange: prev, rows, note: def.note?.(rows, value, input, range) || null, href: def.href };
}

// ---- Melbourne calendar days ------------------------------------------------

const DAY_MS = 86_400_000;
const melbourneDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });

/** The Melbourne calendar day an instant falls on — never `toISOString().slice(0, 10)`. */
export function melbourneDay(at: Date | string): string {
  return melbourneDayFmt.format(typeof at === "string" ? new Date(at) : at);
}

export function inRange(at: string | null | undefined, range: Range): boolean {
  if (!at) return false;
  const d = melbourneDay(at);
  return d >= range.from && d <= range.to;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);   // on a UTC-midnight date this IS the calendar day
export const addDays = (iso: string, n: number): string => isoOf(new Date(utc(iso).getTime() + n * DAY_MS));
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS) + 1;

/**
 * The previous period of the same length, ending the day before `from`.
 * A whole calendar month compares with the whole previous month; a partial
 * month ("1–19 Sep") compares with the same day-count of the previous month
 * ("1–19 Aug"), as the mockup shows.
 */
export function previousRange(range: Range): Range {
  const fromDay = utc(range.from);
  const isMonthStart = fromDay.getUTCDate() === 1;
  if (isMonthStart) {
    const prevStart = new Date(Date.UTC(fromDay.getUTCFullYear(), fromDay.getUTCMonth() - 1, 1));
    const wholeMonth = range.to === isoOf(new Date(Date.UTC(fromDay.getUTCFullYear(), fromDay.getUTCMonth() + 1, 0)));
    if (wholeMonth) {
      return { from: isoOf(prevStart), to: isoOf(new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth() + 1, 0))) };
    }
    const len = daysBetween(range.from, range.to);
    const prevMonthDays = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth() + 1, 0)).getUTCDate();
    return { from: isoOf(prevStart), to: addDays(isoOf(prevStart), Math.min(len, prevMonthDays) - 1) };
  }
  const len = daysBetween(range.from, range.to);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

export const RANGE_PRESETS = ["this_month", "last_30", "quarter", "ytd", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const PRESET_LABEL: Record<RangePreset, string> = {
  this_month: "This month", last_30: "Last 30 days", quarter: "Quarter", ytd: "Year to date", custom: "Custom",
};

/** Resolve the header's chips to Melbourne calendar days, ending today. */
export function resolveRange(preset: RangePreset, now: Date, custom?: Partial<Range>): Range {
  const today = melbourneDay(now);
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "this_month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30":    return { from: addDays(today, -29), to: today };
    case "quarter": {
      const qStart = new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1));
      return { from: isoOf(qStart), to: today };
    }
    case "ytd":        return { from: `${y}-01-01`, to: today };
    case "custom": {
      const from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : `${today.slice(0, 7)}-01`;
      const to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

const dayLabel = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" });

/** "1 – 19 September 2026" */
export function rangeLabel(r: Range): string {
  const a = utc(r.from); const b = utc(r.to);
  if (r.from === r.to) return dayLabel.format(a);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()} – ${dayLabel.format(b)}`;
  }
  return `${dayShort.format(a)} – ${dayLabel.format(b)}`;
}

/** "▲ 6% vs Aug" — the arrow the tile shows. Null when there is nothing to compare with. */
export function compareDelta(value: number, compare: number | null): { pct: number; dir: "up" | "down" | "flat" } | null {
  if (compare == null) return null;
  if (compare === 0) return value === 0 ? { pct: 0, dir: "flat" } : null;
  const pct = Math.round(((value - compare) / Math.abs(compare)) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
