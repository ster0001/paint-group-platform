/**
 * Contractor-invoice states, mirrored from the database (Step 5).
 *
 * The truth lives in migration 20261119's contractor_invoices_guard trigger —
 * a BEFORE UPDATE/DELETE guard every writer passes through, RPCs included.
 * This module is the read-side mirror so screens and tests can ask the same
 * question without a round trip; ciStateMachine.test.ts greps the migration so
 * the two lists cannot drift.
 *
 * draft → submitted → approved → paid, one direction, no skips — except the
 * ⚑9 RCTI shortcut draft → approved (the platform issues on the contractor's
 * behalf; the guard allows it only when the row carries rcti = true).
 */

export const CI_STATUSES = ["draft", "submitted", "approved", "paid"] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export const CI_TRANSITIONS: ReadonlyArray<readonly [CiStatus, CiStatus]> = [
  ["draft", "submitted"],
  ["submitted", "approved"],
  ["approved", "paid"],
  ["draft", "approved"], // RCTI only — the guard checks the row's flag
];

export function ciCanTransition(from: CiStatus, to: CiStatus, rcti = false): boolean {
  if (from === "draft" && to === "approved") return rcti;
  return CI_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** Only drafts delete — a submitted contractor invoice is a document. */
export function ciCanDelete(status: CiStatus): boolean {
  return status === "draft";
}

/** The document heading is a legal statement, pinned at submission. */
export function ciDocumentHeading(gstRegisteredAtSubmit: boolean | null): string {
  return gstRegisteredAtSubmit ? "TAX INVOICE" : "INVOICE";
}
