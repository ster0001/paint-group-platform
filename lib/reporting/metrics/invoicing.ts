/**
 * Session 4 — Invoicing (owner, admin, finance). Every "right now" figure is
 * computed over the SAME rows the /invoicing dashboard reads, with the same
 * functions (`invoiceBalanceCents`, `invoiceIsOverdue`, `OPEN_STATUSES`,
 * `payablesTiles`), so Home and /invoicing show identical values at the
 * same instant (acceptance 2; `invoicing.test.ts` is the tripwire against
 * `dashboardTiles`). Period figures read the payments that landed in the
 * range. Money is cents inc GST — the customer-facing basis of an invoice.
 */
import { OPEN_STATUSES } from "@/lib/invoicing/stateMachine";
import { daysBetween, invoiceBalanceCents, invoiceIsOverdue, payablesTiles } from "@/lib/invoicing/derive";
import { inRange, type MetricDef, type MetricInput } from "../core";

const ROLES = ["owner", "admin", "finance"] as const;
const aud = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const slice = (input: MetricInput) => input.invoicing ?? null;

export type OpenInvoiceRow = { number: string; customer: string; address: string; kind: string; status: string; issued_on: string; due_on: string; total_cents: number; balance_cents: number; days_overdue: number; overdue: boolean };
const OPEN_COLUMNS = [
  { key: "number", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "address", label: "Address" }, { key: "kind", label: "Kind" }, { key: "status", label: "Status" },
  { key: "issued_on", label: "Issued" }, { key: "due_on", label: "Due" }, { key: "total_cents", label: "Total (cents, inc GST)" }, { key: "balance_cents", label: "Balance (cents, inc GST)" }, { key: "days_overdue", label: "Days overdue" },
] as const;

/** Open invoices with money still owed — the /invoicing "outstanding" set, row by row. */
export function openRows(input: MetricInput): OpenInvoiceRow[] {
  const s = slice(input); if (!s) return [];
  const out: OpenInvoiceRow[] = [];
  for (const inv of s.invoices) {
    if (!OPEN_STATUSES.includes(inv.status)) continue;
    const balance = invoiceBalanceCents(inv, s.payments);
    if (balance <= 0) continue;
    const overdue = invoiceIsOverdue(inv, s.payments, s.today);
    const info = s.invoiceInfo[inv.id] ?? { number: "", customer: "", address: "", start_date: null };
    out.push({ number: info.number, customer: info.customer, address: info.address, kind: inv.kind, status: inv.status, issued_on: inv.issuedOn ?? "", due_on: inv.dueOn ?? "",
      total_cents: inv.totalIncCents, balance_cents: balance, days_overdue: overdue && inv.dueOn ? daysBetween(inv.dueOn, s.today) : 0, overdue });
  }
  return out.sort((a, b) => b.days_overdue - a.days_overdue || b.balance_cents - a.balance_cents);
}

export const outstanding: MetricDef<OpenInvoiceRow> = {
  key: "inv.outstanding_cents", kind: "now", section: "invoicing", title: "Outstanding",
  definition: "Money still owed on issued, sent, viewed or partially paid invoices — the balance after succeeded payments — the same figure as the Outstanding tile on /invoicing, from the same rows. Right now.",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "balance_cents" }, columns: OPEN_COLUMNS, href: "/invoicing",
  select: (input) => openRows(input),
  note: (rows) => rows.length ? `${rows.length} invoice${rows.length === 1 ? "" : "s"} · ${new Set(rows.map((r) => r.customer)).size} customers` : "",
};

export const overdue: MetricDef<OpenInvoiceRow> = {
  key: "inv.overdue_cents", kind: "now", section: "invoicing", title: "Overdue",
  definition: "The outstanding balance on invoices past their due date — the /invoicing Overdue tile. The line under it ages that money by the Settings edges (1–7, 8–30, 31+ days by default).",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "balance_cents" }, columns: OPEN_COLUMNS, href: "/invoicing",
  select: (input) => openRows(input).filter((r) => r.overdue),
  note: (rows, _v, input) => {
    if (!rows.length) return "nothing overdue";
    const [e1, e2] = slice(input)?.ageingEdges ?? [7, 30];
    const b = [0, 0, 0];
    for (const r of rows) b[r.days_overdue <= e1 ? 0 : r.days_overdue <= e2 ? 1 : 2] += r.balance_cents;
    return `1–${e1} ${aud(b[0])} · ${e1 + 1}–${e2} ${aud(b[1])} · ${e2 + 1}+ ${aud(b[2])} · oldest ${rows[0].days_overdue} days`;
  },
};

export type CiRow = { number: string; contractor: string; wo_ref: string; status: string; submitted_on: string; due_on: string; total_cents: number };
const CI_COLUMNS = [{ key: "number", label: "Invoice" }, { key: "contractor", label: "Painter" }, { key: "wo_ref", label: "Job" }, { key: "status", label: "Status" }, { key: "submitted_on", label: "Submitted" }, { key: "due_on", label: "Due" }, { key: "total_cents", label: "Total (cents, inc GST)" }] as const;
const ciRows = (input: MetricInput, statuses: string[]): CiRow[] =>
  (slice(input)?.contractorInvoices ?? []).filter((c) => statuses.includes(c.status))
    .map((c) => ({ number: c.number ?? "", contractor: c.contractor, wo_ref: c.wo_ref, status: c.status, submitted_on: (c.submitted_at ?? "").slice(0, 10), due_on: c.dueOn ?? "", total_cents: c.totalIncCents }));

export const contractorsToPay: MetricDef<CiRow> = {
  key: "inv.contractors_to_pay_cents", kind: "now", section: "invoicing", title: "Contractor invoices to pay",
  definition: "Approved contractor invoices not yet paid — the /invoicing Payables \"approved\" total. The line under it is what is still to approve (submitted, undecided).",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "total_cents" }, columns: CI_COLUMNS, href: "/invoicing#payables",
  select: (input) => ciRows(input, ["approved"]),
  note: (rows, _v, input) => { const t = payablesTiles(slice(input)?.contractorInvoices ?? [], slice(input)?.today ?? ""); return `${t.toApproveCount} to approve · ${aud(t.toApproveCents)}${rows.length ? ` · ${t.toPayWeekCount} due this week` : ""}`; },
};

export const unsentInvoices: MetricDef<OpenInvoiceRow> = {
  key: "inv.unsent_cents", kind: "now", section: "invoicing", title: "Unsent invoices",
  definition: "Draft invoices — raised but never issued — by stage: deposit drafts made at acceptance, progress requests, finals at sign-off. Their totals, inc GST. Right now.",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "total_cents" }, columns: OPEN_COLUMNS, href: "/invoicing",
  select: (input) => {
    const s = slice(input); if (!s) return [];
    return s.invoices.filter((inv) => inv.status === "draft").map((inv) => {
      const info = s.invoiceInfo[inv.id] ?? { number: "", customer: "", address: "", start_date: null };
      return { number: info.number || "draft", customer: info.customer, address: info.address, kind: inv.kind, status: inv.status, issued_on: "", due_on: "", total_cents: inv.totalIncCents, balance_cents: inv.totalIncCents, days_overdue: 0, overdue: false };
    });
  },
  note: (rows) => { const by = (k: string) => rows.filter((r) => r.kind === k).length; return rows.length ? `${by("deposit")} deposits · ${by("progress")} progress · ${by("final")} finals` : ""; },
};

export const depositsUnpaidSoon: MetricDef<OpenInvoiceRow & { start_date: string; days_to_start: number }> = {
  key: "inv.deposits_unpaid_soon", kind: "now", section: "invoicing", title: "Deposits unpaid, job within 7 days",
  definition: "Open deposit invoices with a balance whose job's booked start is within the next seven days (today included) or already past — money that should have landed before the painters do. Right now.",
  unit: "count", gst: null, roles: ROLES, aggregate: "count",
  columns: [...OPEN_COLUMNS, { key: "start_date", label: "Job starts" }, { key: "days_to_start", label: "Days to start" }], href: "/invoicing",
  select: (input) => {
    const s = slice(input); if (!s) return [];
    const byNumber = new Map(Object.entries(s.invoiceInfo).map(([id, i]) => [i.number, { id, ...i }]));
    return openRows(input).filter((r) => r.kind === "deposit").flatMap((r) => {
      const info = byNumber.get(r.number); const start = info?.start_date;
      if (!start) return [];
      const days = daysBetween(s.today, start);
      return days <= 7 ? [{ ...r, start_date: start, days_to_start: days }] : [];
    }).sort((a, b) => a.days_to_start - b.days_to_start);
  },
  note: (rows) => rows.length ? `${aud(rows.reduce((s, r) => s + r.balance_cents, 0))} · nearest start in ${Math.max(0, rows[0].days_to_start)} day${rows[0].days_to_start === 1 ? "" : "s"}` : "",
};

export type ReceivedRow = { paid_on: string; number: string; customer: string; kind: string; method: string; amount_cents: number };
export const received: MetricDef<ReceivedRow> = {
  key: "inv.received_cents", kind: "period", section: "invoicing", title: "Received",
  definition: "Customer payments that succeeded on a day in the range (payments.paid_on), inc GST — recognised when the money landed, not when invoiced. Refunds are negative payments. Compared with the previous period. The line under it splits by method: card, bank transfer, cash.",
  unit: "cents", gst: "inc", roles: ROLES, aggregate: { sum: "amount_cents" },
  columns: [{ key: "paid_on", label: "Paid" }, { key: "number", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "kind", label: "Kind" }, { key: "method", label: "Method" }, { key: "amount_cents", label: "Amount (cents, inc GST)" }], href: "/invoicing",
  select: (input, range) => (slice(input)?.paymentsInWindow ?? []).filter((p) => p.paid_on >= range.from && p.paid_on <= range.to)
    .map((p) => ({ paid_on: p.paid_on, number: p.number, customer: p.customer, kind: p.kind, method: p.method, amount_cents: p.amount_cents })).sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
  note: (rows) => {
    if (!rows.length) return "nothing received in this range";
    const by = new Map<string, number>(); for (const r of rows) by.set(r.method, (by.get(r.method) ?? 0) + r.amount_cents);
    const label: Record<string, string> = { stripe_card: "card", bank_transfer: "bank", cash: "cash", other: "other" };
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${label[m] ?? m} ${aud(c)}`).join(" · ");
  },
};

export type DaysToPayRow = { number: string; customer: string; issued_on: string; paid_on: string; days: number; one: number; amount_cents: number };
export const daysToPayFinal: MetricDef<DaysToPayRow> = {
  key: "inv.days_to_pay_final", kind: "period", section: "invoicing", title: "Average days to pay a final",
  definition: "For final invoices whose last payment landed on a day in the range: days from the issue date to that payment, averaged. Only finals that were fully paid in the range count; a part payment does not close the clock.",
  unit: "days", gst: null, roles: ROLES, aggregate: { divide: { num: "days", den: "one" } },
  columns: [{ key: "number", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "issued_on", label: "Issued" }, { key: "paid_on", label: "Paid in full" }, { key: "days", label: "Days" }, { key: "amount_cents", label: "Total (cents, inc GST)" }], href: "/invoicing",
  select: (input, range) => {
    const s = slice(input); if (!s) return [];
    const finals = s.invoices.filter((inv) => inv.kind === "final" && inv.status === "paid" && inv.issuedOn);
    return finals.flatMap((inv) => {
      const paid = s.payments.filter((p) => p.invoiceId === inv.id && p.status === "succeeded" && p.paidOn).map((p) => p.paidOn as string).sort();
      const last = paid[paid.length - 1];
      if (!last || !inRange(`${last}T12:00:00Z`, range)) return [];
      const info = s.invoiceInfo[inv.id];
      return [{ number: info?.number ?? "", customer: info?.customer ?? "", issued_on: inv.issuedOn as string, paid_on: last, days: daysBetween(inv.issuedOn as string, last), one: 1, amount_cents: inv.totalIncCents }];
    }).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  },
  note: (rows) => rows.length ? `${rows.length} final${rows.length === 1 ? "" : "s"} paid in full` : "no finals paid in full in this range",
};

export const INVOICING_METRICS = [received, outstanding, overdue, contractorsToPay, unsentInvoices, depositsUnpaidSoon, daysToPayFinal] as const;
