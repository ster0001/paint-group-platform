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
import { fyEnd, fyOf, fyShortLabel, fyStart, isWholeFy } from "./financialYear";

export type MetricKind = "period" | "now";
export type MetricUnit = "count" | "cents" | "pct" | "days" | "hours";
export type GstBasis = "inc" | "ex" | null;

export type Range = {
  from: string; to: string;   // yyyy-mm-dd, Melbourne calendar days, inclusive
  /**
   * The period this one is compared with, when the preset knows better than
   * the same-length rule: a week against the same weekdays of the week before,
   * a quarter or year against the same day-count of the one before.
   * `previousRange` honours it; absent, the month rule applies.
   */
  compare?: { from: string; to: string };
};

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
  payments: { paid_on: string; amount_cents: number; invoice_id?: string | null }[];
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
  /** Supplier (materials) invoices with no job yet — the Payables "Materials to match" rows (lib/invoicing/materialsToMatch). */
  materialsToMatch?: import("@/lib/invoicing/materialsToMatch").MaterialToMatch[];
};

export type SalesSlice = {
  presentations: { id: string; category_label: string }[];
  staff: { id: string; name: string }[];
  /** sales_targets rows the viewer may see (owner/admin — RLS); month is yyyy-mm-01. */
  targets: { month: string; target_cents: number }[];
  /** Accepted estimates over the last 12 months, for the chart: month yyyy-mm, cents inc GST. */
  history: { month: string; sales_cents: number; accepted: number }[];
  /** The rows behind `history`, with ids, so the dashboard exclusions (20270184) can be applied after the load. */
  historyRows?: { id: string; accepted_at: string; accepted_total_cents: number | null; total_cents: number }[];
  /** 20270186: months recorded from PaintScout (yyyy-mm-01), which replace the platform's rows for that month. */
  recorded?: { month: string; sales_cents: number; accepted: number | null; source: string }[];
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
  /** True when the window held more events than the feed reads (the newest 5,000) — the tile says "5,000+", never a quiet undercount. */
  truncated?: boolean;
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
  if (range.compare) return { from: range.compare.from, to: range.compare.to };
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

export const RANGE_PRESETS = ["week", "month", "quarter", "year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const PRESET_LABEL: Record<RangePreset, string> = {
  week: "Week", month: "Month", quarter: "Quarter", year: "Financial year", custom: "Custom",
};
/** The session-1 chip names, still in old links and specs; each maps to the preset that means the same thing. */
const LEGACY_PRESET: Record<string, RangePreset> = { this_month: "month", last_30: "month", ytd: "year" };
export const isRangePreset = (s: string): s is RangePreset => (RANGE_PRESETS as readonly string[]).includes(s);
/** A preset name from a URL or a cookie — a current name, a legacy name, or null. Never a guess. */
export function parsePreset(raw: string | null | undefined): RangePreset | null {
  if (!raw) return null;
  return isRangePreset(raw) ? raw : LEGACY_PRESET[raw] ?? null;
}

const quarterStart = (y: number, m: number) => isoOf(new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1)));
const quarterEnd = (y: number, m: number) => isoOf(new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3 + 3, 0)));
/** Monday of the week the day falls in (Melbourne calendar, Monday-first). */
export const weekStart = (day: string): string => addDays(day, -((utc(day).getUTCDay() + 6) % 7));

/**
 * The same stretch of the previous quarter or year: whole against whole,
 * a partial against the same day-count from the previous one's first day,
 * clamped to its length (a leap day never pushes it over).
 */
function samePartOfPrevious(range: { from: string; to: string }, prevFrom: string, prevTo: string): { from: string; to: string } {
  const len = daysBetween(range.from, range.to);
  const prevLen = daysBetween(prevFrom, prevTo);
  return { from: prevFrom, to: addDays(prevFrom, Math.min(len, prevLen) - 1) };
}

/** Resolve the header's chips to Melbourne calendar days, ending today. */
export function resolveRange(preset: RangePreset, now: Date, custom?: Partial<{ from: string; to: string }>): Range {
  const today = melbourneDay(now);
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "week": {
      const from = weekStart(today);
      return { from, to: today, compare: { from: addDays(from, -7), to: addDays(today, -7) } };
    }
    case "month":   return { from: `${today.slice(0, 7)}-01`, to: today };
    case "quarter": {
      const from = quarterStart(y, m);
      const prevEnd = addDays(from, -1);
      const [py, pm] = prevEnd.split("-").map(Number);
      return { from, to: today, compare: samePartOfPrevious({ from, to: today }, quarterStart(py, pm), prevEnd) };
    }
    case "year": {
      // The financial year, 1 July → today (Tom, 20 Sep 2026), against the same stretch of the FY before.
      const fy = fyOf(today);
      const from = fyStart(fy);
      return { from, to: today, compare: samePartOfPrevious({ from, to: today }, fyStart(fy - 1), fyEnd(fy - 1)) };
    }
    case "custom": {
      const from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : `${today.slice(0, 7)}-01`;
      const to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : today;
      const r = from <= to ? { from, to } : { from: to, to: from };
      // A custom range that is exactly a whole financial year, calendar year or quarter compares with the whole previous one.
      const [fy, fm] = r.from.split("-").map(Number);
      if (isWholeFy(r.from, r.to)) return { ...r, compare: { from: fyStart(fyOf(r.from) - 1), to: fyEnd(fyOf(r.from) - 1) } };
      if (r.from === `${fy}-01-01` && r.to === `${fy}-12-31`) return { ...r, compare: { from: `${fy - 1}-01-01`, to: `${fy - 1}-12-31` } };
      if (r.from === quarterStart(fy, fm) && r.to === quarterEnd(fy, fm)) {
        const prevEnd = addDays(r.from, -1); const [py, pm] = prevEnd.split("-").map(Number);
        return { ...r, compare: { from: quarterStart(py, pm), to: prevEnd } };
      }
      return r;
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

const monShort = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" });
const dayMonShort = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
/**
 * The few characters a tile has for "vs …": a whole month is "Aug", a whole
 * quarter "Q2", a whole year "2025", the same weekdays last week "7–13 Sep",
 * anything else "24 Aug – 6 Sep". Never assumes the period is a month.
 */
export function rangeShortLabel(r: { from: string; to: string } | null): string {
  if (!r) return "";
  const a = utc(r.from); const b = utc(r.to);
  const [fy, fm] = r.from.split("-").map(Number);
  if (isWholeFy(r.from, r.to)) return fyShortLabel(fyOf(r.from));
  if (r.from === `${fy}-01-01` && r.to === `${fy}-12-31`) return String(fy);
  if (r.from === quarterStart(fy, fm) && r.to === quarterEnd(fy, fm)) return `Q${Math.floor((fm - 1) / 3) + 1} ${String(fy).slice(2)}`;
  const wholeMonth = a.getUTCDate() === 1 && r.to === isoOf(new Date(Date.UTC(fy, fm, 0)));
  if (wholeMonth) return monShort.format(a);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return r.from === r.to ? dayMonShort.format(a) : `${a.getUTCDate()}–${dayMonShort.format(b)}`;
  return `${dayMonShort.format(a)} – ${dayMonShort.format(b)}`;
}

/** "▲ 6% vs Aug" — the arrow the tile shows. Null when there is nothing to compare with. */
export function compareDelta(value: number, compare: number | null): { pct: number; dir: "up" | "down" | "flat" } | null {
  if (compare == null) return null;
  if (compare === 0) return value === 0 ? { pct: 0, dir: "flat" } : null;
  const pct = Math.round(((value - compare) / Math.abs(compare)) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
