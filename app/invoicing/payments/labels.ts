/**
 * The Payments page's words — display edge only. Every figure arrives on a
 * `JobMoneyRow` from lib/invoicing/jobMoney.ts; this file turns it into the
 * mockup's phrases ("Deposit 50% $7,865.40 not sent", "3 days overdue").
 * It formats and chooses wording; it never adds up money.
 */
import type { Lane } from "@/lib/workorder/stages";
import type { JobMoneyRow, Slot, SlotKey, SlotLead, SlotState } from "@/lib/invoicing/jobMoney";
import type { InvoiceKind } from "@/lib/invoicing/derive";
import { fmt2 } from "../format";
import type { ActionSpec, PayTarget } from "./ActionsClient";

export const money = fmt2;

/** The mockup's lane names — the same seven lanes as /pc/flow (`laneFor`), shorter titles. */
export const STAGE_NAME: Record<Lane, string> = {
  offered: "Offer", booking_confirmed: "Booking confirmed", pre_start: "Pre-start",
  in_progress: "In progress", qa: "Quality check", walkthrough: "Walkthrough", closed: "Closed",
};

export const SLOT_NAME: Record<SlotKey, string> = { deposit: "Deposit", progress: "Progress", final: "Final" };
export const SLOT_LETTER: Record<SlotKey, string> = { deposit: "D", progress: "P", final: "F" };
export const KIND_NAME: Record<InvoiceKind, string> = {
  deposit: "Deposit", progress: "Progress", final: "Final", variation: "Variation", standalone: "Invoice",
};

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "Thu 15 Oct" — a yyyy-mm-dd is already a Melbourne day, so it is formatted in UTC (no zone shift). */
export function shortDate(ymd: string | null): string {
  if (!ymd) return "";
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${ymd}T00:00:00Z`)).replace(",", "");
}

/** "Monday 12 October", today in Melbourne. */
export function longToday(now: Date): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne" })
    .format(now).replace(",", "");
}

/** When the job starts, as the deposit chase reads it. */
export function startText(r: JobMoneyRow): string {
  if (r.underWay) return "Job already under way";
  const d = r.startsInDays;
  if (r.lane === "pre_start") return d === null ? "Starts within a week" : d <= 0 ? "Due to start now" : d === 1 ? "Starts tomorrow" : `Starts in ${d} days`;
  if (r.lane === "booking_confirmed") return "Start is more than a week out";
  return "";
}

/** "last messaged today" / "yesterday" / "3 days ago" (§4.4). */
export function lastMessagedText(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? "messaged today" : days === 1 ? "last messaged yesterday" : `last messaged ${days} days ago`;
}

/** "due today" / "due yesterday" / "due Thu 15 Oct" / "3 days overdue" / "not sent". */
export function dueText(lead: SlotLead): string {
  if (lead.state === "over" && lead.overdueDays !== null) return `${plural(lead.overdueDays, "day")} overdue`;
  if (!lead.sent) return "not sent";
  if (lead.dueInDays === 0) return "due today";
  if (lead.dueInDays === -1) return "due yesterday";
  return lead.dueOn ? `due ${shortDate(lead.dueOn)}` : "sent";
}

/** The amount block on a card: [figure, state class, the line under it]. */
export function oweOf(r: JobMoneyRow): { amount: string; state: SlotState | ""; label: string } {
  const n = r.next;
  if (n?.lead) {
    const lead = n.lead;
    const label = lead.state === "over" || lead.sent ? dueText(lead) : `${KIND_NAME[lead.kind].toLowerCase()} not sent`;
    return { amount: money(lead.balanceCents), state: lead.state, label };
  }
  if (n?.state === "noinv") return { amount: "No invoice", state: "uninv", label: "deposit not raised" };
  if (n?.state === "uninv") return { amount: money(r.uninvoicedCents), state: "uninv", label: "not invoiced" };
  return { amount: "", state: "", label: "" };
}

export type PillView = { state: SlotState; before: string; amount: string | null; after: string; editable: boolean };

/** One payment-stage pill; null when the slot is not used. */
export function pillOf(r: JobMoneyRow, key: SlotKey): PillView | null {
  const s: Slot = r.slots[key];
  switch (s.state) {
    case "none": return null;
    case "paid": return { state: "paid", before: `${SLOT_NAME[key]} paid`, amount: null, after: "", editable: false };
    case "later": return { state: "later", before: "Final", amount: money(s.amountCents ?? 0), after: "at sign-off", editable: false };
    case "uninv": return { state: "uninv", before: "Not invoiced", amount: money(s.amountCents ?? 0), after: "", editable: false };
    case "noinv": return { state: "noinv", before: "No deposit invoice raised", amount: null, after: "", editable: false };
  }
  const lead = s.lead;
  if (!lead) return null;
  const pct = key === "deposit" && lead.pctOfContract !== null ? ` ${lead.pctOfContract}%` : "";
  return {
    state: s.state, before: `${KIND_NAME[lead.kind]}${pct}`, amount: money(lead.balanceCents), after: dueText(lead),
    editable: key === "deposit" && lead.kind === "deposit" && !lead.sent,
  };
}

/** The extra pill when the final is paid but part of the contract is on no invoice. */
export function stillToInvoicePill(r: JobMoneyRow): PillView | null {
  if (r.slots.final.state !== "paid" || r.uninvoicedCents <= 0) return null;
  const closed = r.lane === "closed";
  return { state: closed ? "uninv" : "later", before: closed ? "Not invoiced" : "Still to invoice", amount: money(r.uninvoicedCents), after: "", editable: false };
}

/** What a board card says under its lights. */
export function whatText(r: JobMoneyRow): string {
  if (r.section === "paid_in_full") return "Paid in full";
  const o = oweOf(r);
  if (!o.label) return "Nothing due yet";
  const text = o.label.charAt(0).toUpperCase() + o.label.slice(1);
  return r.health === "need" || r.health === "noinv" ? `${text}, ${startText(r).toLowerCase()}` : text;
}

/** The rail's accessible name. */
export function railLabel(r: JobMoneyRow): string {
  const say: Record<SlotState, string> = {
    paid: "paid", over: "overdue", need: "needed now", noinv: "no invoice", sent: "sent", draft: "not sent",
    later: "later", uninv: "not invoiced", none: "none",
  };
  return `Job stage ${STAGE_NAME[r.lane]}. Deposit ${say[r.slots.deposit.state]}. Final ${say[r.slots.final.state]}.`;
}

/** What a row's buttons act on (Step 3) — chosen here, on the server, from the row alone. */
export function actionSpec(r: JobMoneyRow, jobHref: string): ActionSpec {
  const order: SlotKey[] = ["deposit", "progress", "final"];
  const leads = order.map((k) => ({ k, lead: r.slots[k].lead })).filter((x): x is { k: SlotKey; lead: SlotLead } => x.lead !== null);
  const payable: PayTarget[] = leads.map(({ lead }) => ({
    invoiceId: lead.invoiceId, balanceCents: lead.balanceCents, draft: !lead.sent,
    label: `${KIND_NAME[lead.kind]} invoice, ${money(lead.balanceCents)} owing${lead.sent ? "" : " (not sent)"}`,
  }));
  const dep = r.slots.deposit.lead;
  const n = r.next;
  const primary: ActionSpec["primary"] =
    !n ? { kind: "open" }
    : n.state === "noinv" ? { kind: "create_deposit" }
    : n.state === "uninv" ? { kind: "create_final", uninvoicedCents: r.uninvoicedCents }
    : !n.lead ? { kind: "open" }
    : n.lead.sent ? { kind: "pay", invoiceId: n.lead.invoiceId, balanceCents: n.lead.balanceCents }
    : { kind: "send", invoiceId: n.lead.invoiceId, kindName: KIND_NAME[n.lead.kind], balanceCents: n.lead.balanceCents,
        suggestedDueOn: n.lead.suggestedDueOn, isDeposit: n.slot === "deposit" };
  const customer = r.customer || "Customer on the work order";
  return {
    estimateId: r.estimateId, address: r.address, customer,
    first: (r.customer ?? "").trim().split(/\s+/)[0] || "the customer",
    jobHref, contractCents: r.contractCents, startDate: r.startDate, startText: startText(r),
    primary, payable,
    depositDraft: dep && dep.kind === "deposit" && !dep.sent ? { invoiceId: dep.invoiceId, totalCents: dep.balanceCents } : null,
    messageInvoiceId: n?.lead?.invoiceId ?? leads[0]?.lead.invoiceId ?? null,
  };
}

/**
 * The jobs the provider's pickers offer (Pick a job, Record as a cost, Assign, Snap a receipt): every job
 * with a work order, open ones first — supplier invoices routinely arrive after a job is finished and
 * paid (the old picker kept closed jobs too; 8d: a found job missing from the list lost its preselection).
 */
export const pickerJobs = (rows: readonly JobMoneyRow[]) =>
  [...rows.filter((r) => r.workOrderId && r.section !== "paid_in_full"), ...rows.filter((r) => r.workOrderId && r.section === "paid_in_full")].map((r) => ({
    estimateId: r.estimateId, workOrderId: r.workOrderId!, address: r.address, customer: r.customer, laneName: STAGE_NAME[r.lane],
  }));
