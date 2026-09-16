/**
 * A failed invoice read must never render as "no invoices" — on a money screen
 * an empty list reads as data loss.
 *
 * 16 Sep 2026: the deploy that added `chase_hold_reason` to INVOICE_SELECT went
 * out before migration 20270151 was run on production. Postgres rejected every
 * invoice select, the error was discarded (`const { data: invoices }`), and the
 * whole of Invoicing rendered its ordinary empty state — $0 tiles and "Nothing
 * here" over a full ledger. Screens hand this to the reader instead, so the
 * reason lands on the page.
 */
export function loadFailure(error: { message?: string; code?: string } | null): string | null {
  if (!error) return null;
  const missingColumn = error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
  return missingColumn
    ? "The database is behind the app — this screen reads a column production doesn't have yet. Run the newest migration on production, then reload."
    : error.message || "The invoices could not be read just now.";
}
