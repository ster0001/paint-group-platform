/**
 * A failed read on a money screen must never be rendered as a fact.
 *
 * 16 Sep 2026: the deploy that added `chase_hold_reason` to INVOICE_SELECT went
 * out before migration 20270151 was run on production. Postgres rejected every
 * invoice select, the error was discarded (`const { data: invoices }`), and the
 * whole of Invoicing rendered its ordinary empty state — $0 tiles and "Nothing
 * here" over a full ledger. Screens hand these to the reader instead, so the
 * reason lands on the page.
 *
 * Two shapes of lie, and the payments one is the worse of them:
 *
 *   invoices  — a rejected read shows an EMPTY LEDGER. Alarming, and at least
 *               odd enough to be questioned.
 *   payments  — a rejected read shows PAID INVOICES AS UNPAID. The invoices are
 *               all present and the balances are all wrong, which reads as
 *               ordinary and gets believed. Nobody chases an empty screen; they
 *               do chase a customer who has already paid.
 */

export type ReadFailure = {
  /** The one-line claim, bold on screen: what is wrong with what you're seeing. */
  headline: string;
  /** Why, and what to do about it. */
  detail: string;
};

/** The cause, in staff English. */
function why(error: { message?: string; code?: string }): string {
  const missingColumn = error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
  return missingColumn
    ? "The database is behind the app — this screen reads a column production doesn't have yet. Run the newest migration on production, then reload."
    : error.message || "The read was refused and no reason was given.";
}

/** The invoice list itself could not be read: the ledger is not empty, it is unread. */
export function loadFailure(error: { message?: string; code?: string } | null): ReadFailure | null {
  if (!error) return null;
  return {
    headline: "The invoices could not be loaded — this is not an empty ledger.",
    detail: `${why(error)} Nothing has been lost: the figures below are blank because the read failed, not because the invoices are gone.`,
  };
}

/**
 * The PAYMENTS read failed while the invoices arrived. Every invoice will show
 * its full total outstanding — paid ones included — and the aged buckets and
 * "overdue" labels are computed off the same rows, so they are wrong too. This
 * must be louder than the empty-ledger case, not quieter.
 */
export function paymentsFailure(error: { message?: string; code?: string } | null): ReadFailure | null {
  if (!error) return null;
  return {
    headline: "Payments could not be loaded — treat every amount on this screen as wrong.",
    detail: `${why(error)} Until it loads, invoices that have been PAID will show as unpaid or overdue. Do not chase anyone off this screen.`,
  };
}

/** The first failure that has something to say, in order of how badly it misleads. */
export function firstFailure(...failures: (ReadFailure | null)[]): ReadFailure | null {
  return failures.find((f) => f !== null) ?? null;
}
