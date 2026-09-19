/**
 * Session 2 — Contractors. Reads the 0c capture: the all-surfaces-done
 * event, the booking's end date (extensions included), QA attempt numbers,
 * offer timings, expense claims, and worked hours through the ONE blended
 * function `workedTime` — every hours tile shows its entered/schedule
 * coverage, and never a silent average (Tom's ruling, 19 Sep).
 */
import { inRange, melbourneDay, type MetricDef, type MetricInput } from "../core";
import { coverageLine, sourceLabel, workedTime, type WorkedTime } from "../workedTime";

const ROLES = ["owner", "admin", "pc"] as const;
const slice = (input: MetricInput) => input.contractors ?? null;
const painter = (input: MetricInput, id: string | null) => (id ? slice(input)?.contractors.find((c) => c.id === id)?.name ?? "" : "");
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "");

// ---- finished on time -------------------------------------------------------

export type DoneRow = { wo_ref: string; title: string; painter: string; done_on: string; booked_end: string; on_time: boolean; days_late: number };
export const finishedOnTime: MetricDef<DoneRow> = {
  key: "contractors.finished_on_time", kind: "period", section: "contractors", title: "Finished on time",
  definition: "Jobs whose last surface was ticked (all_surfaces_done) on a day in the range, counted on time when that day is on or before the booking's end date — the current end, so an approved extension moves the goalpost. Jobs with no booked end are listed but not counted either way.",
  unit: "count", gst: null, roles: ROLES, aggregate: { countWhere: "on_time" }, href: "/pc",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "painter", label: "Painter" }, { key: "done_on", label: "All surfaces done" }, { key: "booked_end", label: "Booked end" }, { key: "on_time", label: "On time" }, { key: "days_late", label: "Days late" }],
  select: (input, range) => (slice(input)?.done ?? [])
    .filter((d) => inRange(d.done_at, range))
    .map((d) => {
      const doneOn = melbourneDay(d.done_at);
      const late = d.end_date ? Math.max(0, Math.round((Date.parse(`${doneOn}T00:00:00Z`) - Date.parse(`${d.end_date}T00:00:00Z`)) / 86_400_000)) : 0;
      return { wo_ref: d.wo_ref, title: d.title, painter: painter(input, d.contractor_id), done_on: doneOn, booked_end: d.end_date ?? "", on_time: Boolean(d.end_date) && doneOn <= (d.end_date as string), days_late: late };
    }),
  note: (rows, value) => { const n = rows.filter((r) => r.booked_end).length; return n ? `of ${n} · ${pct(value, n)}` : "no finished jobs with a booked end in this range"; },
};

// ---- silent -------------------------------------------------------------------

export type SilentRow = { wo_ref: string; title: string; painter: string; days_quiet: number; since: string };
export const silentContractors: MetricDef<SilentRow> = {
  key: "contractors.silent", kind: "now", section: "contractors", title: "Silent 3+ days",
  definition: "Painters on an in-progress job with no tick, photo or message for at least the Settings number of days (dashboard_silent_contractor_days, default 3) — the console's own quiet-site flags, one per job. Right now.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", href: "/pc",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "painter", label: "Painter" }, { key: "days_quiet", label: "Days quiet" }, { key: "since", label: "Flagged" }],
  select: (input) => {
    const c = input.console; const s = slice(input); if (!c) return [];
    const threshold = s?.silentDays ?? 3;
    const byId = new Map(c.input.workOrders.map((w) => [w.id, w]));
    return c.input.quietSites.filter((q) => q.days >= threshold).map((q) => {
      const w = byId.get(q.workOrderId);
      return { wo_ref: w?.woRef ?? "", title: w?.title ?? "", painter: w?.contractorName ?? "", days_quiet: q.days, since: melbourneDay(q.at) };
    }).filter((r) => r.wo_ref);
  },
  note: (rows) => rows.slice(0, 3).map((r) => r.painter || r.wo_ref).join(" · "),
};

// ---- QA passed first time -------------------------------------------------------

export type QaRow = { wo_ref: string; painter: string; attempt_no: number; result: string; checked_on: string; first_time_pass: boolean };
export const qaPassedFirstTime: MetricDef<QaRow> = {
  key: "contractors.qa_first_time", kind: "period", section: "contractors", title: "QA passed first time",
  definition: "Quality checks logged on a day in the range, counted when the check passed on attempt 1 (no failed check before it on the job). The line under it is the total checks logged and the share.",
  unit: "count", gst: null, roles: ROLES, aggregate: { countWhere: "first_time_pass" }, href: "/pc",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "painter", label: "Painter" }, { key: "attempt_no", label: "Attempt" }, { key: "result", label: "Result" }, { key: "checked_on", label: "Checked" }, { key: "first_time_pass", label: "Passed first time" }],
  select: (input, range) => (slice(input)?.qaChecks ?? [])
    .filter((c) => inRange(c.checked_at, range))
    .map((c) => ({ wo_ref: c.wo_ref, painter: painter(input, c.contractor_id), attempt_no: c.attempt_no, result: c.result, checked_on: melbourneDay(c.checked_at), first_time_pass: c.result === "pass" && c.attempt_no === 1 })),
  note: (rows, value) => rows.length ? `of ${rows.length} · ${pct(value, rows.length)} · ${rows.filter((r) => r.result === "fail").length} rectifications logged` : "no checks logged in this range",
};

// ---- offers accepted within 24h -----------------------------------------------------

export type OfferRow = { wo_ref: string; painter: string; offered_at: string; accepted_at: string; hours_to_accept: number; within_24h: boolean };
export const offersWithin24h: MetricDef<OfferRow> = {
  key: "contractors.offers_within_24h", kind: "period", section: "contractors", title: "Offers accepted within 24h",
  definition: "Booking offers accepted on a day in the range, counted when the painter accepted within 24 hours of the offer going out.",
  unit: "count", gst: null, roles: ROLES, aggregate: { countWhere: "within_24h" }, href: "/pc/schedule",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "painter", label: "Painter" }, { key: "offered_at", label: "Offered" }, { key: "accepted_at", label: "Accepted" }, { key: "hours_to_accept", label: "Hours to accept" }, { key: "within_24h", label: "Within 24h" }],
  select: (input, range) => (slice(input)?.offers ?? [])
    .filter((o) => inRange(o.accepted_at, range))
    .map((o) => { const h = (Date.parse(o.accepted_at) - Date.parse(o.offered_at)) / 3_600_000; return { wo_ref: o.wo_ref, painter: painter(input, o.contractor_id), offered_at: o.offered_at, accepted_at: o.accepted_at, hours_to_accept: Math.round(h * 10) / 10, within_24h: h <= 24 }; }),
  note: (rows, value) => rows.length ? `of ${rows.length} · ${pct(value, rows.length)}` : "no offers accepted in this range",
};

// ---- variations raised -----------------------------------------------------------------

export type VarRow = { wo_ref: string; painter: string; raised_on: string; status: string };
export const variationsRaised: MetricDef<VarRow> = {
  key: "contractors.variations_raised", kind: "period", section: "contractors", title: "Variations raised",
  definition: "Variations raised on a day in the range, any status. The line under it is the rate per job that finished in the same range.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", href: "/pc",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "painter", label: "Painter" }, { key: "raised_on", label: "Raised" }, { key: "status", label: "Status" }],
  select: (input, range) => (slice(input)?.variations ?? []).filter((v) => inRange(v.created_at, range)).map((v) => ({ wo_ref: v.wo_ref, painter: painter(input, v.contractor_id), raised_on: melbourneDay(v.created_at), status: v.status })),
  note: (rows, value, input, range) => { const jobs = (slice(input)?.done ?? []).filter((d) => inRange(d.done_at, range)).length; return jobs ? `${(value / jobs).toFixed(1)} per finished job` : ""; },
};

// ---- expense claims awaiting approval ----------------------------------------------------

export type ExpenseRow = { wo_ref: string; painter: string; category: string; amount_cents: number; submitted_on: string };
export const expensesPending: MetricDef<ExpenseRow> = {
  key: "contractors.expenses_pending", kind: "now", section: "contractors", title: "Expense claims awaiting approval",
  definition: "Contractor expense claims submitted and not yet approved, rejected or paid. Right now.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", href: "/invoicing",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "painter", label: "Painter" }, { key: "category", label: "Category" }, { key: "amount_cents", label: "Amount (cents, inc GST)" }, { key: "submitted_on", label: "Submitted" }],
  select: (input) => (slice(input)?.pendingExpenses ?? []).map((e) => ({ wo_ref: e.wo_ref, painter: painter(input, e.contractor_id), category: e.category, amount_cents: e.amount_cents, submitted_on: melbourneDay(e.created_at) })),
  note: (rows) => rows.length ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(rows.reduce((s, r) => s + r.amount_cents, 0) / 100) : "",
};

// ---- days and hours, blended ---------------------------------------------------------------

export type HoursRow = { wo_ref: string; title: string; painter: string; done_on: string; days: number; hours: number; estimate_hours: number; source: string; delta_pct: number };
const hoursRows = (input: MetricInput, range: { from: string; to: string }): HoursRow[] => {
  const s = slice(input); if (!s) return [];
  return s.done.filter((d) => inRange(d.done_at, range)).map((d) => {
    const c = s.contractors.find((x) => x.id === d.contractor_id);
    const t: WorkedTime = workedTime({
      entered: d.entered, booking: { startDate: d.start_date, endDate: d.end_date }, finishedOn: melbourneDay(d.done_at),
      estimateHours: d.hours_allowance, dayHours: s.dayHours, worksSaturday: c?.works_saturday, worksSunday: c?.works_sunday,
    });
    const est = d.hours_allowance ?? 0;
    return { wo_ref: d.wo_ref, title: d.title, painter: painter(input, d.contractor_id), done_on: melbourneDay(d.done_at), days: t.days, hours: t.hours, estimate_hours: est,
      source: sourceLabel(t.source), delta_pct: est > 0 ? Math.round(((t.hours - est) / est) * 1000) / 10 : 0 };
  }).filter((r) => r.estimate_hours > 0);
};
export const hoursVsEstimate: MetricDef<HoursRow> = {
  key: "contractors.hours_vs_estimate", kind: "period", section: "contractors", title: "Hours vs estimate",
  definition: "Hours worked against the booking's hours allowance, over jobs finished in the range: (sum of worked hours − sum of allowance) ÷ sum of allowance. Hours come from workedTime(): the painter's own entry where they are opted in, otherwise booked days × the standard day length, stopping at the last tick and capped by the allowance when finished early. The source is on every row and the coverage on the tile; the two are never silently averaged.",
  unit: "pct", gst: null, roles: ROLES, aggregate: { ratioPct: { num: "hours", den: "estimate_hours" } }, href: "/pc",
  columns: [{ key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "painter", label: "Painter" }, { key: "done_on", label: "Finished" }, { key: "days", label: "Days" }, { key: "hours", label: "Hours" }, { key: "estimate_hours", label: "Allowance (hours)" }, { key: "source", label: "Source" }, { key: "delta_pct", label: "vs allowance (%)" }],
  select: hoursRows,
  note: (rows) => coverageLine(rows.map((r) => ({ days: r.days, hours: r.hours, source: r.source === "Entered by the painter" ? "entered" : "schedule" }))),
};

export const daysOnSite: MetricDef<HoursRow> = {
  key: "contractors.days_on_site", kind: "period", section: "contractors", title: "Days on site",
  definition: "Days worked over jobs finished in the range, from workedTime(): the painter's entry where opted in, otherwise the booked days (the painter's working week respected) up to the last tick. Coverage shown; sources never silently averaged.",
  unit: "days", gst: null, roles: ROLES, aggregate: { sum: "days" }, href: "/pc",
  columns: hoursVsEstimate.columns, select: hoursRows,
  note: (rows) => coverageLine(rows.map((r) => ({ days: r.days, hours: r.hours, source: r.source === "Entered by the painter" ? "entered" : "schedule" }))),
};

export const CONTRACTOR_METRICS = [
  finishedOnTime, silentContractors, qaPassedFirstTime, offersWithin24h, variationsRaised, expensesPending, hoursVsEstimate, daysOnSite,
] as const;
