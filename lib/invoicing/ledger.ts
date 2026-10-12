/**
 * The job money ledger (§3) — THE single computation of adjusted_contract.
 *
 *   adjusted_contract = accepted snapshot total (at acceptance, immutable)
 *                     + Σ customer-approved variations
 *                     − Σ approved credit/descope variations
 *   invoiced = Σ issued invoices (excl. draft + void), net of credit notes
 *   paid     = Σ succeeded payments (surcharge is NOT job revenue and is
 *              carried in its own column, so it never enters amountCents)
 *   balance  = adjusted_contract − paid
 *
 * The runtime authority inside transactions is the SQL twin
 * `public.invoice_ledger` (20261112000000_invoicing_core.sql §8) — the
 * schema contract test pins the two to the same rule. NOTHING else in the
 * codebase may compute any of these figures; screens call this module (or
 * the `invoice_ledger_staff` RPC) and format at the display edge.
 *
 * Variation prices ride as the customer approved them on /v/[token] — the
 * approved figure is never re-priced (GST treatment of that figure is an
 * open ⚑ in the PR body).
 */

import type { InvoiceStatus } from "./stateMachine";
import { melbourneInstant } from "@/lib/time/businessHours";
import { OPEN_STATUSES } from "./stateMachine";

/** wo_variations statuses that count toward the adjusted contract. */
export const APPROVED_VARIATION_STATUSES = [
  "customer_approved",
  "contractor_accepted",
] as const;

export type LedgerVariation = {
  status: string;
  /** The figure the customer approved, in cents; null while unpriced. */
  priceCents: number | null;
  /** Approved credit/descope — subtracts instead of adding. */
  credit?: boolean;
};

export type LedgerInvoice = {
  status: InvoiceStatus;
  totalIncCents: number;
};

export type LedgerPayment = {
  status: string; // pending | succeeded | failed | refunded
  amountCents: number;
};

/** Signed sum of the approved variations. Declined, cancelled, raised and
 *  merely-priced variations never touch the ledger. */
export function variationsCents(variations: readonly LedgerVariation[]): number {
  return variations.reduce((sum, v) => {
    if (v.priceCents == null) return sum;
    if (!APPROVED_VARIATION_STATUSES.includes(v.status as (typeof APPROVED_VARIATION_STATUSES)[number])) {
      return sum;
    }
    return sum + (v.credit ? -v.priceCents : v.priceCents);
  }, 0);
}

/** THE adjusted-contract rule. The estimate is never edited after
 *  acceptance; approved variations are append-only deltas. */
export function adjustedContractCents(
  acceptedTotalCents: number,
  variations: readonly LedgerVariation[],
): number {
  return acceptedTotalCents + variationsCents(variations);
}

/** Issued+ invoices only — drafts and voids never count as invoiced. */
export function invoicedCents(
  invoices: readonly LedgerInvoice[],
  creditNoteTotalsIncCents: readonly number[] = [],
): number {
  const gross = invoices.reduce(
    (sum, i) => (i.status === "draft" || i.status === "void" ? sum : sum + i.totalIncCents),
    0,
  );
  return gross - creditNoteTotalsIncCents.reduce((a, b) => a + b, 0);
}

/** Succeeded payments only; refunded/failed/pending never count. */
export function paidCents(payments: readonly LedgerPayment[]): number {
  return payments.reduce((sum, p) => (p.status === "succeeded" ? sum + p.amountCents : sum), 0);
}

export type LedgerInput = {
  acceptedTotalCents: number;
  variations: readonly LedgerVariation[];
  invoices: readonly LedgerInvoice[];
  creditNoteTotalsIncCents?: readonly number[];
  payments: readonly LedgerPayment[];
};

export type Ledger = {
  acceptedTotalCents: number;
  variationsCents: number;
  adjustedContractCents: number;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
};

export function ledger(input: LedgerInput): Ledger {
  const vars = variationsCents(input.variations);
  const adjusted = input.acceptedTotalCents + vars;
  const paid = paidCents(input.payments);
  return {
    acceptedTotalCents: input.acceptedTotalCents,
    variationsCents: vars,
    adjustedContractCents: adjusted,
    invoicedCents: invoicedCents(input.invoices, input.creditNoteTotalsIncCents ?? []),
    paidCents: paid,
    balanceCents: adjusted - paid,
  };
}

/**
 * The instant an invoice falls overdue: MIDDAY Melbourne on the day AFTER its
 * due date (Tom, 12 Oct 2026). Due Tuesday → overdue from Wednesday 12:00.
 * The chase ladder's first rung (+1 day from the due date's midday) fires at
 * this same instant, so the reminder and the red badge can never disagree.
 * Measured with the zone, never a written-down offset (+10 / +11).
 */
export function overdueFrom(dueOn: string): Date {
  const [y, m, d] = dueOn.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return melbourneInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 12);
}

/**
 * `overdue` is DERIVED, never stored (§3.2). An invoice is overdue when it is
 * open, still carries a balance, and `now` has reached `overdueFrom(dueOn)`.
 *
 * `now` is the CALLER's clock — this module never reads it. This is the ONE
 * overdue rule: the screens, the CRM work queue, the portal and the chase
 * sweep (lib/automations/sweeps/moneySignoff.ts) all call it.
 */
export function isOverdue(
  invoice: { status: InvoiceStatus; dueOn: string | null; totalIncCents: number; paidCents: number },
  now: Date,
): boolean {
  if (!OPEN_STATUSES.includes(invoice.status)) return false;
  if (!invoice.dueOn) return false;
  if (invoice.totalIncCents - invoice.paidCents <= 0) return false;
  return now.getTime() >= overdueFrom(invoice.dueOn).getTime();
}
