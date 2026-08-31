/**
 * Trade portal v2 · Session 6 — the portfolio Money view-model (§5.6).
 * Pure over the invoicing rows: every number here is a sum of invoice and
 * payment cents — nothing recomputed, nothing client-side (the ledger law).
 * The CSV and the statement render from THIS shape, so "match to the cent"
 * is structural, and the unit tests pin it.
 */
import { invoiceBalanceCents, invoiceIsOverdue, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import type { MoneyInvoice, MoneyPayment } from "./money";

const VISIBLE = new Set(["issued", "sent", "viewed", "partially_paid", "paid"]);

export type TradeMoneyRow = {
  invoiceId: string;
  number: string | null;
  kind: string;
  status: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalIncCents: number;
  gstCents: number;
  paidCents: number;
  balanceCents: number;
  overdue: boolean;
  token: string | null;
};

export type TradeMoneyGroup = {
  propertyId: string | null;
  address: string;
  refLine: string | null;
  rows: TradeMoneyRow[];
  outstandingCents: number;
};

export type TradeMoneyView = {
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  groups: TradeMoneyGroup[];
};

export function buildTradeMoney(input: {
  properties: Array<{ id: string; address: string | null; suburb: string | null }>;
  references: Array<{ property_id: string; label: string; value: string; sort: number }>;
  estimates: Array<{ id: string; property_id: string | null }>;
  invoices: MoneyInvoice[];
  payments: MoneyPayment[];
  todayYmd: string;
}): TradeMoneyView {
  const dPayments: DerivePayment[] = input.payments.map((p) => ({
    invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on,
  }));
  const propertyOfEstimate = new Map(input.estimates.map((e) => [e.id, e.property_id]));
  const addressOf = new Map(input.properties.map((p) => [
    p.id, [p.address, p.suburb].filter(Boolean).join(", ") || "Property",
  ]));
  const refLineOf = new Map<string, string>();
  for (const p of input.properties) {
    const refs = input.references.filter((r) => r.property_id === p.id).sort((a, b) => a.sort - b.sort);
    if (refs.length) refLineOf.set(p.id, refs.map((r) => `${r.label} · ${r.value}`).join("  ·  "));
  }

  const rowsByProperty = new Map<string | null, TradeMoneyRow[]>();
  let outstandingCents = 0, outstandingCount = 0, overdueCents = 0, overdueCount = 0;

  for (const inv of input.invoices) {
    if (!VISIBLE.has(inv.status)) continue;
    const d: DeriveInvoice = {
      id: inv.id, estimateId: inv.estimate_id, kind: inv.kind,
      status: inv.status as DeriveInvoice["status"],
      totalIncCents: inv.total_inc_cents, dueOn: inv.due_on, issuedOn: inv.issued_on,
    };
    const balanceCents = invoiceBalanceCents(d, dPayments);
    const overdue = invoiceIsOverdue(d, dPayments, input.todayYmd);
    const row: TradeMoneyRow = {
      invoiceId: inv.id, number: inv.number, kind: inv.kind, status: inv.status,
      issuedOn: inv.issued_on, dueOn: inv.due_on,
      totalIncCents: inv.total_inc_cents, gstCents: inv.gst_cents,
      paidCents: inv.total_inc_cents - balanceCents, balanceCents, overdue, token: inv.token,
    };
    if (balanceCents > 0) { outstandingCents += balanceCents; outstandingCount += 1; }
    if (overdue) { overdueCents += balanceCents; overdueCount += 1; }
    const pid = propertyOfEstimate.get(inv.estimate_id) ?? null;
    const arr = rowsByProperty.get(pid) ?? [];
    arr.push(row);
    rowsByProperty.set(pid, arr);
  }

  const groups: TradeMoneyGroup[] = [...rowsByProperty.entries()].map(([propertyId, rows]) => ({
    propertyId,
    address: propertyId ? addressOf.get(propertyId) ?? "Property" : "Other work",
    refLine: propertyId ? refLineOf.get(propertyId) ?? null : null,
    rows: rows.sort((a, b) => (b.issuedOn ?? "").localeCompare(a.issuedOn ?? "")),
    outstandingCents: rows.reduce((n, r) => n + r.balanceCents, 0),
  }));
  // Overdue-carrying groups first, then by amount outstanding.
  groups.sort((a, b) =>
    Number(b.rows.some((r) => r.overdue)) - Number(a.rows.some((r) => r.overdue))
    || b.outstandingCents - a.outstandingCents);

  return { outstandingCents, outstandingCount, overdueCents, overdueCount, groups };
}

const csvCell = (s: string | number | null): string => {
  const v = s == null ? "" : String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const dollars = (cents: number): string => (cents / 100).toFixed(2);

/** §5.6's columns exactly: property, references, invoice no., issued, due,
 * amount inc GST, GST, paid, status. Money as plain dollars for the
 * spreadsheet — the cents live unrounded in the view. */
export function tradeMoneyCsv(view: TradeMoneyView): string {
  const lines = ["Property,References,Invoice no.,Issued,Due,Amount inc GST,GST,Paid,Status"];
  for (const g of view.groups) {
    for (const r of g.rows) {
      lines.push([
        csvCell(g.address), csvCell(g.refLine ?? ""), csvCell(r.number ?? ""),
        csvCell(r.issuedOn ?? ""), csvCell(r.dueOn ?? ""),
        dollars(r.totalIncCents), dollars(r.gstCents), dollars(r.paidCents),
        csvCell(r.overdue ? "overdue" : r.balanceCents === 0 ? "paid" : r.status),
      ].join(","));
    }
  }
  return lines.join("\n") + "\n";
}
