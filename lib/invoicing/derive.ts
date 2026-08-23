/**
 * Screen derivations for the §7 invoicing surfaces — every figure the job
 * money view and the /invoicing dashboard show comes from here (or from
 * ledger.ts / the invoice_ledger_staff RPC). Components format; they never
 * compute. All dates are Melbourne calendar-day strings supplied by the
 * caller (lib/workorder/console.ts `melbourneDate`) — this module never
 * reads the clock.
 */

import type { InvoiceStatus } from "./stateMachine";
import { OPEN_STATUSES } from "./stateMachine";
import { isOverdue } from "./ledger";

export type InvoiceKind = "deposit" | "progress" | "final" | "variation" | "standalone";

export type DeriveInvoice = {
  id: string;
  estimateId: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  totalIncCents: number;
  dueOn: string | null;
  issuedOn: string | null;
};

export type DerivePayment = {
  invoiceId: string;
  amountCents: number;
  status: string; // pending | succeeded | failed | refunded
  /** Melbourne calendar day the payment landed (paid_on). */
  paidOn: string | null;
};

const succeededFor = (payments: readonly DerivePayment[], invoiceId: string) =>
  payments.filter((p) => p.invoiceId === invoiceId && p.status === "succeeded");

export function invoicePaidCents(
  invoice: Pick<DeriveInvoice, "id">,
  payments: readonly DerivePayment[],
): number {
  return succeededFor(payments, invoice.id).reduce((a, p) => a + p.amountCents, 0);
}

export function invoiceBalanceCents(
  invoice: DeriveInvoice,
  payments: readonly DerivePayment[],
): number {
  return invoice.totalIncCents - invoicePaidCents(invoice, payments);
}

/** Whole days from `a` to `b` (both yyyy-mm-dd); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function invoiceIsOverdue(
  invoice: DeriveInvoice,
  payments: readonly DerivePayment[],
  todayIso: string,
): boolean {
  return isOverdue(
    {
      status: invoice.status,
      dueOn: invoice.dueOn,
      totalIncCents: invoice.totalIncCents,
      paidCents: invoicePaidCents(invoice, payments),
    },
    todayIso,
  );
}

/** "6 days overdue" / "due in 4 days" — the number half; copy lives in the UI. */
export function ageInfo(
  invoice: DeriveInvoice,
  payments: readonly DerivePayment[],
  todayIso: string,
): { overdueDays: number } | { dueInDays: number } | null {
  if (!invoice.dueOn || !OPEN_STATUSES.includes(invoice.status)) return null;
  if (invoiceIsOverdue(invoice, payments, todayIso)) {
    return { overdueDays: daysBetween(invoice.dueOn, todayIso) };
  }
  return { dueInDays: daysBetween(todayIso, invoice.dueOn) };
}

// ---------------------------------------------------------------------------
// Dashboard pulse tiles (§7.2)
// ---------------------------------------------------------------------------

export type DashboardTiles = {
  outstandingCents: number;
  outstandingCount: number;
  outstandingJobs: number;
  overdueCents: number;
  overdueCount: number;
  overdueOldestDays: number;
  dueThisWeekCents: number;
  dueThisWeekCount: number;
  collectedFortnightCents: number;
  /** Daily collected cents, oldest→today, 14 entries — the sparkline. */
  collectedSpark: number[];
};

export function dashboardTiles(
  invoices: readonly DeriveInvoice[],
  payments: readonly DerivePayment[],
  todayIso: string,
): DashboardTiles {
  let outstandingCents = 0, outstandingCount = 0;
  let overdueCents = 0, overdueCount = 0, overdueOldestDays = 0;
  let dueThisWeekCents = 0, dueThisWeekCount = 0;
  const jobs = new Set<string>();

  for (const inv of invoices) {
    if (!OPEN_STATUSES.includes(inv.status)) continue;
    const balance = invoiceBalanceCents(inv, payments);
    if (balance <= 0) continue;
    outstandingCents += balance;
    outstandingCount += 1;
    jobs.add(inv.estimateId);
    if (invoiceIsOverdue(inv, payments, todayIso)) {
      overdueCents += balance;
      overdueCount += 1;
      overdueOldestDays = Math.max(overdueOldestDays, daysBetween(inv.dueOn!, todayIso));
    } else if (inv.dueOn && daysBetween(todayIso, inv.dueOn) <= 7) {
      dueThisWeekCents += balance;
      dueThisWeekCount += 1;
    }
  }

  const spark = new Array<number>(14).fill(0);
  let collectedFortnightCents = 0;
  for (const p of payments) {
    if (p.status !== "succeeded" || !p.paidOn) continue;
    const ago = daysBetween(p.paidOn, todayIso);
    if (ago < 0 || ago > 13) continue;
    collectedFortnightCents += p.amountCents;
    spark[13 - ago] += p.amountCents;
  }

  return {
    outstandingCents, outstandingCount, outstandingJobs: jobs.size,
    overdueCents, overdueCount, overdueOldestDays,
    dueThisWeekCents, dueThisWeekCount,
    collectedFortnightCents, collectedSpark: spark,
  };
}

// ---------------------------------------------------------------------------
// Aged receivables (§7.2) — current / 1–7 / 8–14 / 15–30 / 30+
// ---------------------------------------------------------------------------

export function agedBucketsCents(
  invoices: readonly DeriveInvoice[],
  payments: readonly DerivePayment[],
  todayIso: string,
): [number, number, number, number, number] {
  const buckets: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const inv of invoices) {
    if (!OPEN_STATUSES.includes(inv.status)) continue;
    const balance = invoiceBalanceCents(inv, payments);
    if (balance <= 0) continue;
    const days = invoiceIsOverdue(inv, payments, todayIso)
      ? daysBetween(inv.dueOn!, todayIso)
      : 0;
    const idx = days <= 0 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 3 : 4;
    buckets[idx] += balance;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Payment stage rail (§7.1) + the per-row stage dots (§7.2)
// ---------------------------------------------------------------------------

export type StageState = "paid" | "awaiting" | "draft" | "overdue" | "upcoming";

export type PaymentStage = {
  key: "deposit" | "progress" | "final" | "paid_in_full";
  state: StageState;
  amountCents: number | null;
};

function groupState(
  group: readonly DeriveInvoice[],
  payments: readonly DerivePayment[],
  todayIso: string,
): { state: StageState; amountCents: number | null } {
  const live = group.filter((i) => i.status !== "void" && i.status !== "written_off");
  if (live.length === 0) return { state: "upcoming", amountCents: null };
  const total = live.reduce((a, i) => a + i.totalIncCents, 0);
  if (live.some((i) => invoiceIsOverdue(i, payments, todayIso))) {
    return { state: "overdue", amountCents: total };
  }
  if (live.some((i) => OPEN_STATUSES.includes(i.status))) {
    return { state: "awaiting", amountCents: total };
  }
  if (live.every((i) => i.status === "paid")) return { state: "paid", amountCents: total };
  return { state: "draft", amountCents: total };
}

export function paymentStages(
  invoices: readonly DeriveInvoice[],
  payments: readonly DerivePayment[],
  balanceCents: number,
  todayIso: string,
): PaymentStage[] {
  const of = (kinds: InvoiceKind[]) => invoices.filter((i) => kinds.includes(i.kind));
  const deposit = groupState(of(["deposit"]), payments, todayIso);
  const progress = groupState(of(["progress", "variation", "standalone"]), payments, todayIso);
  const final = groupState(of(["final"]), payments, todayIso);
  const anythingLive = invoices.some((i) => i.status !== "void");
  const paidInFull = balanceCents <= 0 && anythingLive;
  return [
    { key: "deposit", ...deposit },
    { key: "progress", ...progress },
    { key: "final", ...final },
    {
      key: "paid_in_full",
      state: paidInFull ? "paid" : "upcoming",
      amountCents: null,
    },
  ];
}

/** The dashboard row's three dots: deposit / progress / final. */
export function stageDots(
  invoices: readonly DeriveInvoice[],
  payments: readonly DerivePayment[],
  todayIso: string,
): ("paid" | "open" | "none")[] {
  const stages = paymentStages(invoices, payments, 1, todayIso).slice(0, 3);
  return stages.map((s) =>
    s.state === "paid" ? "paid" : s.state === "upcoming" ? "none" : "open",
  );
}

// ---------------------------------------------------------------------------
// Request-payment preview (§7.1 sheet) — mirror of the SQL in
// invoice_request_payment: round(adjusted × pct / 100). The DRAFT itself is
// still computed by the server; this exists so the sheet can show the figure
// without a round trip, from lib/invoicing and nowhere else.
// ---------------------------------------------------------------------------

export function requestPreviewCents(adjustedContractCents: number, pct: number): number {
  return Math.round((adjustedContractCents * pct) / 100);
}
