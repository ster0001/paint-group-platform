/**
 * Session 2 — PC Command. Every tile here is a state count "right now", read
 * off the PC console's OWN input and cards (`lib/workorder/console.ts`,
 * loaded by `loadConsole`) — extended, never duplicated. A tile that has a
 * console card behind it (offers past SLA, silent sites, QA due) lists the
 * console's cards, so /home and /pc cannot disagree (acceptance 2; the
 * tripwire is `pc.test.ts`). The two period figures — materials estimated
 * vs actual on signed-off jobs — share their rows with the P&L (session 5).
 */
import { melbourneDay, type MetricDef, type MetricInput } from "../core";

const aud = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const ROLES = ["owner", "admin", "pc"] as const;
const slice = (input: MetricInput) => input.console ?? null;
const hoursSince = (iso: string, now: Date) => Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3_600_000);
const daysSince = (iso: string, now: Date) => Math.floor(hoursSince(iso, now) / 24);

// ---- rows -------------------------------------------------------------------

export type JobRow = { wo_ref: string; title: string; contractor: string; stage: string; contract_cents: number; start_date: string; end_date: string; days_waiting: number; colours: string; ticks: string };

const jobRow = (w: import("@/lib/workorder/console").ConsoleInput["workOrders"][number], now: Date): JobRow => ({
  wo_ref: w.woRef, title: w.title, contractor: w.contractorName ?? "", stage: w.stage, contract_cents: w.contractValueCents,
  start_date: w.startDate ?? "", end_date: w.endDate ?? "", days_waiting: w.acceptedAt ? daysSince(w.acceptedAt, now) : 0,
  colours: w.coloursConfirmed ? "confirmed" : "TBC", ticks: w.ticksTotal ? `${w.ticksDone}/${w.ticksTotal}` : "",
});

const JOB_COLUMNS = [
  { key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "contractor", label: "Painter" }, { key: "stage", label: "Stage" },
  { key: "contract_cents", label: "Contract (cents, inc GST)" }, { key: "start_date", label: "Start" }, { key: "end_date", label: "End" },
  { key: "days_waiting", label: "Days since accepted" }, { key: "colours", label: "Colours" }, { key: "ticks", label: "Surfaces done" },
] as const;

export type CardRow = { wo_ref: string; title: string; detail: string; painter: string; age_hours: number; severity: string; action: string };
const cardRow = (c: import("@/lib/workorder/console").QueueCard, input: MetricInput): CardRow => {
  const w = slice(input)?.input.workOrders.find((x) => x.id === c.workOrderId);
  return { wo_ref: c.ref, title: c.title, detail: c.detail, painter: w?.contractorName ?? "", age_hours: Math.round(c.ageHours), severity: c.severity, action: c.action.label };
};
const CARD_COLUMNS = [
  { key: "wo_ref", label: "Job" }, { key: "title", label: "What" }, { key: "detail", label: "Detail" }, { key: "painter", label: "Painter" },
  { key: "age_hours", label: "Hours" }, { key: "severity", label: "Severity" }, { key: "action", label: "Next step" },
] as const;

const cardsWithPrefix = (input: MetricInput, prefix: string): CardRow[] =>
  (slice(input)?.cards ?? []).filter((c) => c.key.startsWith(prefix)).map((c) => cardRow(c, input));

const openJobs = (input: MetricInput) => (slice(input)?.input.workOrders ?? []).filter((w) => w.stage !== "closed");

// ---- N tiles ------------------------------------------------------------------

export const jobsToSchedule: MetricDef<JobRow> = {
  key: "pc.jobs_to_schedule", kind: "now", section: "pc_command", title: "Jobs to schedule",
  definition: "Accepted jobs with no accepted booking yet — work orders still at the offered stage, including imported jobs in the Unscheduled folder. Right now, whatever the date filter.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: JOB_COLUMNS, href: "/pc",
  select: (input) => openJobs(input).filter((w) => w.stage === "offered" && w.acceptedAt).map((w) => jobRow(w, input.now)).sort((a, b) => b.days_waiting - a.days_waiting),
  note: (rows) => rows.length ? `${aud(rows.reduce((s, r) => s + r.contract_cents, 0))} · oldest ${rows[0].days_waiting} day${rows[0].days_waiting === 1 ? "" : "s"}` : "",
};

export const jobsInProgress: MetricDef<JobRow> = {
  key: "pc.in_progress", kind: "now", section: "pc_command", title: "In progress",
  definition: "Work orders at the in-progress stage (surfaces being ticked) or at completion prep. \"Wrapping up\" counts the ones at completion prep or with nine in ten surfaces done.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: JOB_COLUMNS, href: "/pc",
  select: (input) => openJobs(input).filter((w) => w.stage === "in_progress" || w.stage === "completion_prep").map((w) => jobRow(w, input.now)),
  note: (rows) => { const n = rows.filter((r) => r.stage === "completion_prep" || (r.ticks && Number(r.ticks.split("/")[0]) / Math.max(1, Number(r.ticks.split("/")[1])) >= 0.9)).length; return n ? `${n} wrapping up` : ""; },
};

export const qualityCheck: MetricDef<JobRow> = {
  key: "pc.quality_check", kind: "now", section: "pc_command", title: "Quality check",
  definition: "Work orders at the quality-check stage. The line under the number is the console's own count of checks due or overdue (its \"Quality check to do\" and \"Mid-job quality check due\" cards).",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: JOB_COLUMNS, href: "/pc",
  select: (input) => openJobs(input).filter((w) => w.stage === "qa").map((w) => jobRow(w, input.now)),
  note: (_rows, _v, input) => { const n = qaDueCount(input); return n ? `${n} check${n === 1 ? "" : "s"} due` : ""; },
};

export type VariationRow = { wo_ref: string; title: string; status: string; state: string; category: string; comment: string; price_cents: number; raised_on: string; hours_waiting: number };
export const variationsOpen: MetricDef<VariationRow> = {
  key: "pc.variations_open", kind: "now", section: "pc_command", title: "Variations open",
  definition: "Variations the console is holding: raised and not yet priced (\"to price\"), or priced and waiting on the customer (\"with customer\"). Approved and signed ones are not open.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", href: "/pc",
  columns: [
    { key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "state", label: "Waiting on" }, { key: "status", label: "Status" },
    { key: "category", label: "Category" }, { key: "comment", label: "Comment" }, { key: "price_cents", label: "Price (cents, inc GST)" }, { key: "raised_on", label: "Raised" }, { key: "hours_waiting", label: "Hours" },
  ],
  select: (input) => {
    const s = slice(input); if (!s) return [];
    const byId = new Map(s.input.workOrders.map((w) => [w.id, w]));
    return s.input.variations
      .filter((v) => v.status === "raised" || v.status === "priced")
      .map((v) => {
        const w = byId.get(v.workOrderId);
        return { wo_ref: w?.woRef ?? "", title: w?.title ?? "", status: v.status, state: v.status === "raised" ? "to price" : "with customer",
          category: v.category ?? "", comment: v.comment ?? "", price_cents: v.priceCents ?? 0, raised_on: melbourneDay(v.createdAt),
          hours_waiting: Math.round(hoursSince(v.pricedAt ?? v.createdAt, input.now)) };
      });
  },
  note: (rows) => rows.length ? `${rows.filter((r) => r.state === "to price").length} to price · ${rows.filter((r) => r.state === "with customer").length} with customer` : "",
};

export type AwaitingRow = { name: string; waiting_hours: number; wrote_at: string; last_reply_at: string };
export const customersAwaitingReply: MetricDef<AwaitingRow> = {
  key: "pc.awaiting_reply", kind: "now", section: "pc_command", title: "Customers awaiting reply",
  definition: "Customers whose last message in is later than the last message a PERSON sent them (crm_account_facts.last_inbound_at > last_staff_reply_at). An automated chase does not count as a reply.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", href: "/crm",
  columns: [{ key: "name", label: "Customer" }, { key: "waiting_hours", label: "Waiting (hours)" }, { key: "wrote_at", label: "They wrote" }, { key: "last_reply_at", label: "Last reply" }],
  select: (input) => (slice(input)?.awaitingReply ?? [])
    .map((r) => ({ name: r.name, waiting_hours: Math.round(hoursSince(r.last_inbound_at, input.now) * 10) / 10, wrote_at: r.last_inbound_at, last_reply_at: r.last_staff_reply_at ?? "" }))
    .sort((a, b) => b.waiting_hours - a.waiting_hours),
  note: (rows) => rows.length ? `longest ${rows[0].waiting_hours >= 48 ? `${Math.floor(rows[0].waiting_hours / 24)} days` : `${Math.floor(rows[0].waiting_hours)}h ${Math.round((rows[0].waiting_hours % 1) * 60)}m`}` : "",
};

export const awaitingSignoff: MetricDef<JobRow> = {
  key: "pc.awaiting_signoff", kind: "now", section: "pc_command", title: "Awaiting sign-off",
  definition: "Work orders at the walkthrough stage — finished, evidence pack out, waiting for the customer's walkthrough and signature.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: JOB_COLUMNS, href: "/pc",
  select: (input) => openJobs(input).filter((w) => w.stage === "walkthrough").map((w) => jobRow(w, input.now)),
  note: (rows, _v, input) => { const booked = new Set(input.console?.input.walkthroughBooked ?? []); const n = (input.console?.input.workOrders ?? []).filter((w) => w.stage === "walkthrough" && booked.has(w.id)).length; return rows.length ? `${n} walkthrough${n === 1 ? "" : "s"} booked` : ""; },
};

export const offersPastSla: MetricDef<CardRow> = {
  key: "pc.offers_past_sla", kind: "now", section: "pc_command", title: "Offers past SLA",
  definition: "The console's own \"offer past SLA\" cards: a job still at the offered stage whose newest offer is unanswered past its 24-hour window, or was declined or expired. One per job.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: CARD_COLUMNS, href: "/pc",
  select: (input) => cardsWithPrefix(input, "offer-sla:"),
  note: (rows) => rows.slice(0, 2).map((r) => `${r.painter || "—"} · ${r.wo_ref}`).join(", "),
};

export const startingThisWeek: MetricDef<JobRow> = {
  key: "pc.starting_this_week", kind: "now", section: "pc_command", title: "Starting this week",
  definition: "Jobs whose booked start date falls in the next seven days (today included) and that have not started. \"Colours TBC\" counts the ones with a colour still to confirm.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count", columns: JOB_COLUMNS, href: "/pc",
  select: (input) => {
    const today = melbourneDay(input.now);
    const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
    const to = end.toISOString().slice(0, 10);
    return openJobs(input)
      .filter((w) => w.startDate && w.startDate >= today && w.startDate <= to && (w.stage === "offered" || w.stage === "pre_start"))
      .map((w) => jobRow(w, input.now)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  },
  note: (rows) => { const tbc = rows.filter((r) => r.colours === "TBC").length; return rows.length ? `${tbc ? `${tbc} colours TBC · ` : ""}${new Set(rows.map((r) => r.contractor).filter(Boolean)).size} painters` : ""; },
};

// ---- the two cards ------------------------------------------------------------

export type MaterialsRow = { wo_ref: string; title: string; closed_on: string; budget_cents: number; invoiced_ex_cents: number; delta_cents: number };
const materialsRows = (input: MetricInput, range: { from: string; to: string }): MaterialsRow[] =>
  (slice(input)?.materials ?? [])
    .filter((m) => m.budget_cents != null && m.closed_on >= range.from && m.closed_on <= range.to)
    .map((m) => ({ wo_ref: m.wo_ref, title: m.title, closed_on: m.closed_on, budget_cents: m.budget_cents ?? 0, invoiced_ex_cents: m.invoiced_ex_cents, delta_cents: m.invoiced_ex_cents - (m.budget_cents ?? 0) }));
const MATERIALS_COLUMNS = [
  { key: "wo_ref", label: "Job" }, { key: "title", label: "Address" }, { key: "closed_on", label: "Signed off" },
  { key: "budget_cents", label: "Estimated (cents, ex GST)" }, { key: "invoiced_ex_cents", label: "Invoiced (cents, ex GST)" }, { key: "delta_cents", label: "Over / under (cents)" },
] as const;

export const materialsEstimated: MetricDef<MaterialsRow> = {
  key: "pc.materials_estimated_cents", kind: "period", section: "pc_command", title: "Materials estimated",
  definition: "The pricing engine's materials cost, ex GST, on the estimate behind every job signed off in the range — the same figure the job page's Materials card calls the budget. Jobs with no priced scope are left out, not counted as zero.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "budget_cents" }, columns: MATERIALS_COLUMNS, href: "/pc",
  select: materialsRows,
  note: (rows) => rows.length ? `${rows.length} signed-off job${rows.length === 1 ? "" : "s"} with a priced scope` : "no signed-off jobs with a priced scope in this range",
};

export const materialsActual: MetricDef<MaterialsRow> = {
  key: "pc.materials_actual_cents", kind: "period", section: "pc_command", title: "Materials actual",
  definition: "Supplier invoices matched to those same signed-off jobs (material_costs), ex GST. Unmatched supplier invoices are counted in the P&L but never allocated to a job here.",
  unit: "cents", gst: "ex", roles: ROLES, aggregate: { sum: "invoiced_ex_cents" }, columns: MATERIALS_COLUMNS, href: "/pc",
  select: materialsRows,
  note: (rows, value) => { const b = rows.reduce((s, r) => s + r.budget_cents, 0); return b > 0 ? `${value > b ? "over" : "under"} estimate by ${aud(Math.abs(value - b))} · ${Math.round((value / b) * 100)}% of budget` : ""; },
};

export const bookedWorkAhead: MetricDef<JobRow> = {
  key: "pc.booked_ahead_cents", kind: "now", section: "pc_command", title: "Booked work ahead",
  definition: "Contract value, inc GST, of accepted jobs not yet started (offered or pre-start) whose booked start date is today or later — work on the books not yet begun. The line under it is how many weeks out the last booked day falls.",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "contract_cents" }, columns: JOB_COLUMNS, href: "/pc/schedule",
  select: (input) => { const today = melbourneDay(input.now); return openJobs(input).filter((w) => w.startDate && w.startDate >= today && (w.stage === "offered" || w.stage === "pre_start")).map((w) => jobRow(w, input.now)).sort((a, b) => a.start_date.localeCompare(b.start_date)); },
  note: (rows, _v, input) => { if (!rows.length) return ""; const last = rows.reduce((m, r) => (r.end_date || r.start_date) > m ? (r.end_date || r.start_date) : m, ""); const weeks = Math.max(0, Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${melbourneDay(input.now)}T00:00:00Z`)) / (7 * 86_400_000) * 10) / 10); return `${rows.length} job${rows.length === 1 ? "" : "s"} · ${weeks} week${weeks === 1 ? "" : "s"} out`; },
};

/** Used by the page to say "N checks due" under Quality check, from the console's own cards. */
export function qaDueCount(input: MetricInput): number {
  return cardsWithPrefix(input, "qa-due:").length;
}

export const PC_METRICS = [
  jobsToSchedule, jobsInProgress, qualityCheck, variationsOpen, customersAwaitingReply, awaitingSignoff, offersPastSla, startingThisWeek,
  materialsEstimated, materialsActual, bookedWorkAhead,
] as const;
