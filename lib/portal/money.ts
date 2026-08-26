import { invoiceIsOverdue, invoicePaidCents, type DeriveInvoice, type DerivePayment, type InvoiceKind } from "@/lib/invoicing/derive";
import { gstFromIncCents } from "@/lib/invoicing/gst";

/**
 * 3a-3 · The customer Money view-model. Pure over stored cents — every
 * figure here is aggregation of server-written amounts (the invoicing
 * phase's rows); nothing is priced or invented. Overdue/paid logic reuses
 * lib/invoicing/derive so the customer view and the staff dashboard can
 * never disagree (the one-source rule).
 *
 * What a customer sees: ISSUED invoices only. Drafts are the office's
 * business; void and written-off rows are corrections, not statements.
 * Job status and payment status stay separate — nothing here reads WO
 * stages except the not-yet-invoiced remainder line's wording.
 */

export type MoneyInvoiceRow = {
  id: string;
  token: string | null;
  number: string | null;
  kindLabel: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalIncCents: number;
  gstCents: number;
  balanceCents: number;
  chip: { cls: "emerald" | "amber" | "clay" | "cyan" | "mut"; label: string };
  receipts: Array<{ paymentId: string; number: string; paidOn: string | null; amountCents: number }>;
};

export type MoneyJob = {
  estimateId: string;
  title: string;
  projectTotalIncCents: number | null; // the accepted contract, when accepted
  projectGstCents: number | null;
  chip: { cls: "emerald" | "clay"; label: string } | null;
  rows: MoneyInvoiceRow[];
  /** Accepted total minus everything issued — the mockup's "Balance on
   * completion · Not due yet" row. */
  remainderCents: number | null;
};

export type MoneyEstimate = {
  id: string;
  title: string | null;
  status: string;
  accepted_total_cents: number | null;
};

export type MoneyInvoice = {
  id: string;
  estimate_id: string;
  kind: InvoiceKind;
  status: string;
  number: string | null;
  token: string | null;
  issued_on: string | null;
  due_on: string | null;
  total_inc_cents: number;
  gst_cents: number;
};

export type MoneyPayment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  status: string;
  paid_on: string | null;
  receipt_number: string | null;
};

const CUSTOMER_VISIBLE = new Set(["issued", "sent", "viewed", "partially_paid", "paid"]);

const KIND_LABELS: Record<InvoiceKind, string> = {
  deposit: "Deposit",
  progress: "Payment request",
  final: "Balance on completion",
  variation: "Variation",
  standalone: "Invoice",
};

/** "29 Aug" from a yyyy-mm-dd — plain-words dates for customers. */
export function fmtDay(ymd: string | null): string | null {
  if (!ymd) return null;
  const [, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!m || !d || m < 1 || m > 12) return null;
  return `${d} ${months[m - 1]}`;
}

export function moneyFmt(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

function toDerive(inv: MoneyInvoice): DeriveInvoice {
  return {
    id: inv.id,
    estimateId: inv.estimate_id,
    kind: inv.kind,
    status: inv.status as DeriveInvoice["status"],
    totalIncCents: inv.total_inc_cents,
    dueOn: inv.due_on,
    issuedOn: inv.issued_on,
  };
}

function toDerivePayments(payments: readonly MoneyPayment[]): DerivePayment[] {
  return payments.map((p) => ({
    invoiceId: p.invoice_id,
    amountCents: p.amount_cents,
    status: p.status,
    paidOn: p.paid_on,
  }));
}

export function buildMoneyView(
  estimates: readonly MoneyEstimate[],
  invoices: readonly MoneyInvoice[],
  payments: readonly MoneyPayment[],
  todayYmd: string,
): MoneyJob[] {
  const dPayments = toDerivePayments(payments);
  const jobs: MoneyJob[] = [];

  for (const est of estimates) {
    const jobInvoices = invoices.filter(
      (i) => i.estimate_id === est.id && CUSTOMER_VISIBLE.has(i.status),
    );
    const accepted = est.status === "accepted" && est.accepted_total_cents != null;
    if (jobInvoices.length === 0 && !accepted) continue;

    let anyOverdue = false;
    const rows: MoneyInvoiceRow[] = jobInvoices
      .sort((a, b) => (a.issued_on ?? "").localeCompare(b.issued_on ?? ""))
      .map((inv) => {
        const d = toDerive(inv);
        const paid = invoicePaidCents(d, dPayments);
        const balance = inv.total_inc_cents - paid;
        const overdue = invoiceIsOverdue(d, dPayments, todayYmd);
        if (overdue) anyOverdue = true;

        let chip: MoneyInvoiceRow["chip"];
        if (inv.status === "paid") {
          const lastPaid = payments
            .filter((p) => p.invoice_id === inv.id && p.status === "succeeded")
            .map((p) => p.paid_on)
            .sort()
            .pop();
          chip = { cls: "emerald", label: lastPaid ? `Paid ${fmtDay(lastPaid)}` : "Paid" };
        } else if (overdue) {
          chip = { cls: "clay", label: "Overdue" };
        } else if (inv.status === "partially_paid") {
          chip = { cls: "amber", label: "Partly paid" };
        } else {
          chip = { cls: "amber", label: inv.due_on ? `Due ${fmtDay(inv.due_on)}` : "Due" };
        }

        return {
          id: inv.id,
          token: inv.token,
          number: inv.number,
          kindLabel: KIND_LABELS[inv.kind] ?? "Invoice",
          issuedOn: inv.issued_on,
          dueOn: inv.due_on,
          totalIncCents: inv.total_inc_cents,
          gstCents: inv.gst_cents,
          balanceCents: balance,
          chip,
          receipts: payments
            .filter((p) => p.invoice_id === inv.id && p.status === "succeeded" && p.receipt_number)
            .map((p) => ({
              paymentId: p.id,
              number: p.receipt_number!,
              paidOn: p.paid_on,
              amountCents: p.amount_cents,
            })),
        };
      });

    const issuedTotal = jobInvoices.reduce((a, i) => a + i.total_inc_cents, 0);
    const remainder = accepted ? Math.max(0, (est.accepted_total_cents ?? 0) - issuedTotal) : 0;

    jobs.push({
      estimateId: est.id,
      title: est.title?.trim() || "Your project",
      projectTotalIncCents: accepted ? est.accepted_total_cents : null,
      projectGstCents: accepted ? gstFromIncCents(est.accepted_total_cents!) : null,
      chip: rows.length === 0 ? null : anyOverdue ? { cls: "clay", label: "Overdue" } : { cls: "emerald", label: "On track" },
      rows,
      remainderCents: remainder > 0 ? remainder : null,
    });
  }

  // Jobs with live money first, newest activity first within.
  return jobs.sort((a, b) => (b.rows.length - a.rows.length));
}
