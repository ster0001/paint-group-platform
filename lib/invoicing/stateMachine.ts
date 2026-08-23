/**
 * The invoice state machine (§3.2) — the TypeScript mirror of the canonical
 * seed in `public.invoice_transitions`
 * (supabase/migrations/20261112000000_invoicing_core.sql §5).
 *
 * The database enforces this matrix in a BEFORE UPDATE trigger for EVERY
 * writer, RPCs included; this mirror exists so screens can offer only legal
 * actions without a round trip. stateMachine.test.ts diffs the two lists the
 * way stages.test.ts pins the WO matrix — edit BOTH or the test fails.
 *
 * `overdue` is deliberately not a status: it is DERIVED (due date passed and
 * balance still owing) in ledger.ts, never stored — no second source of
 * truth to drift. Draft deletion is a DELETE, not a transition.
 */

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "void",
  "written_off",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses with money still collectable — payable, and overdue-eligible. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = [
  "issued",
  "sent",
  "viewed",
  "partially_paid",
];

export const INVOICE_TRANSITIONS: ReadonlyArray<readonly [InvoiceStatus, InvoiceStatus]> = [
  ["draft", "issued"],
  ["issued", "sent"],
  ["sent", "viewed"],
  ["issued", "partially_paid"],
  ["sent", "partially_paid"],
  ["viewed", "partially_paid"],
  ["issued", "paid"],
  ["sent", "paid"],
  ["viewed", "paid"],
  ["partially_paid", "paid"],
  ["issued", "void"],
  ["sent", "void"],
  ["viewed", "void"],
  ["partially_paid", "void"],
  ["issued", "written_off"],
  ["sent", "written_off"],
  ["viewed", "written_off"],
  ["partially_paid", "written_off"],
  // Deliberately absent: paid → void (a paid invoice is corrected by credit
  // note, §6.8); anything → draft; draft → anything but issued.
];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** Drafts are the only deletable money objects (§3.2). */
export function canDelete(status: InvoiceStatus): boolean {
  return status === "draft";
}
