import type { PendingInScope } from "@/lib/revision/invoiceDoc";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The customer's line on the revision invoice — printed on the PDF the office
 * sends a customer who asked to see the costs (Tom, 2 Nov 2026), and shown on
 * the INVOICE tab under the staff note so the preview reads as the file does.
 * Says plainly that pending changes are counted, and names the ones folded
 * into the room prices (they have no line of their own).
 */
export default function RevisionInvoiceNote({ pendingCount, pendingInScope }: {
  pendingCount: number;
  pendingInScope: PendingInScope[];
}) {
  return (
    <div className="status-note overdue" data-testid="revision-invoice-note">
      Costs to date, for your information — not a request for payment.
      {pendingCount > 0 && (
        <>
          {` It includes ${pendingCount} change${pendingCount === 1 ? "" : "s"} still awaiting your approval; the totals count ${pendingCount === 1 ? "it" : "them"} as if approved.`}
          {pendingInScope.length > 0 && (
            <ul className="pending-list" data-testid="pending-in-scope">
              {pendingInScope.map((p, i) => (
                <li key={i}>{p.title} — {p.credit ? "−" : "+"}{money(p.incCents)} inc GST (in the prices above)</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
