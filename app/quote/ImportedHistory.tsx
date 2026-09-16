import Link from "next/link";

/**
 * Airtable history (16 Sep 2026, acceptance 7): an estimate brought across
 * from Airtable has no scope here — no rate card, no areas, no lines — so the
 * builder has nothing to open and must never re-price it. The office sees the
 * record as a card: what it was, what it came to, when, and the PaintScout
 * quote it lives in. Read-only by construction.
 */
export type ImportedHistoryRow = {
  id: string;
  title: string | null;
  status: string;
  total_cents: number | null;
  subtotal_cents: number | null;
  level_of_finish: number | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  account_id: string | null;
  external_ref: Record<string, unknown> | null;
};

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Lapsed" };

export default function ImportedHistory({ row, backTo }: { row: ImportedHistoryRow; backTo: string }) {
  const ref = row.external_ref ?? {};
  const quoteUrl = str(ref.quote_url);
  const workOrderUrl = str(ref.work_order_url);
  const lowConfidence = str(ref.date_confidence) === "low";
  const assumed = ref.level_of_finish_assumed === true;
  return (
    <main className="mx-auto max-w-2xl p-6" data-testid="imported-history">
      <Link href={backTo} className="text-sm text-gray-500 hover:underline">← Back</Link>
      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="imported-banner">
        <b>Imported from Airtable.</b> This is a record of an estimate made before the platform. It has no scope here and cannot be edited or re-priced
        {quoteUrl ? (
          <> — the actual quote is in <a href={quoteUrl} target="_blank" rel="noreferrer" className="underline" data-testid="paintscout-quote-link">PaintScout ↗</a>.</>
        ) : (
          <>. Airtable held no PaintScout link for it.</>
        )}
      </div>
      <h1 className="mt-5 text-xl font-semibold">{row.title || "Imported estimate"}</h1>
      <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-gray-500">Status</dt><dd data-testid="imported-status">{STATUS[row.status] ?? row.status}</dd>
        <dt className="text-gray-500">Total inc. GST</dt><dd className="font-medium" data-testid="imported-total">{money(row.total_cents)}</dd>
        <dt className="text-gray-500">Subtotal ex. GST</dt><dd>{money(row.subtotal_cents)}</dd>
        <dt className="text-gray-500">Level of finish</dt><dd>{row.level_of_finish ? `Level ${row.level_of_finish}${assumed ? " (assumed — Airtable did not say)" : ""}` : "—"}</dd>
        <dt className="text-gray-500">Quote number</dt><dd>{str(ref.quote_number) || "—"}</dd>
        <dt className="text-gray-500">Sent</dt><dd>{when(row.sent_at)}{lowConfidence ? " (date approximate)" : ""}</dd>
        {row.accepted_at && <><dt className="text-gray-500">Accepted</dt><dd>{when(row.accepted_at)}</dd></>}
        {row.declined_at && <><dt className="text-gray-500">Declined</dt><dd>{when(row.declined_at)}</dd></>}
        {str(ref.quote_type) && <><dt className="text-gray-500">Airtable quote type</dt><dd>{str(ref.quote_type)}</dd></>}
        {str(ref.airtable_status) && <><dt className="text-gray-500">Airtable status</dt><dd>{str(ref.airtable_status)}{str(ref.project_status) ? ` · ${str(ref.project_status)}` : ""}</dd></>}
        {workOrderUrl && <><dt className="text-gray-500">Work order</dt><dd><a href={workOrderUrl} target="_blank" rel="noreferrer" className="text-cyan-700 underline">PaintScout work order ↗</a></dd></>}
      </dl>
      {row.account_id && (
        <p className="mt-6 text-sm">
          <Link href={`/crm/customers/${row.account_id}`} className="text-cyan-700 hover:underline" data-testid="imported-customer-link">Open the customer record →</Link>
        </p>
      )}
    </main>
  );
}
