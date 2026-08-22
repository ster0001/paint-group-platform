import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The invoices the workflow has been writing all along, finally readable.
 *
 * Audit S1 (docs/audit-2026-08-23.md): accepting an estimate inserts a deposit
 * invoice, signing off inserts a final stub — 37 rows existed and this page
 * said "coming next". Read-only ON PURPOSE: what to charge and when to chase
 * are decisions for an invoicing phase with payments in it; this makes the
 * money visible so it stops silently piling up, and nothing more.
 *
 * The two kinds are told apart by what the loop wrote: acceptance writes the
 * deposit amount, sign-off writes an explicit 0 to be priced later. An
 * unpriced final is WORK TO DO, so it is flagged, not hidden.
 */

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFmt = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_CHIP: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-emerald-700",
  void: "bg-gray-100 text-gray-400 line-through",
};

type Row = {
  id: string;
  status: string;
  amount_cents: number;
  issued_on: string | null;
  due_on: string | null;
  created_at: string;
  estimate_id: string | null;
  estimates: { title: string | null; accepted_name: string | null; total_cents: number | null } | null;
};

export default async function InvoicesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, status, amount_cents, issued_on, due_on, created_at, estimate_id, estimates(title, accepted_name, total_cents)")
    .order("created_at", { ascending: false });

  const rows = ((data as unknown as Row[] | null) ?? []);
  const outstanding = rows.filter((r) => r.status !== "paid" && r.status !== "void");
  const outstandingCents = outstanding.reduce((n, r) => n + r.amount_cents, 0);
  const unpriced = rows.filter((r) => r.amount_cents === 0 && r.status !== "void").length;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-sm text-gray-500">
          {money(outstandingCents)} not yet paid
          {unpriced > 0 && <span className="ml-2 text-amber-600">· {unpriced} final invoice{unpriced === 1 ? "" : "s"} still to price</span>}
        </p>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Written by the workflow — a deposit when the customer accepts, a final at sign-off.
        Read-only for now; sending and payments come with the invoicing phase.
      </p>

      {error && (
        <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&rsquo;t load invoices — {error.message}
        </p>
      )}

      {!error && rows.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
          Nothing yet. A deposit invoice appears the moment a customer accepts an estimate.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm" data-testid="invoices-table">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = r.estimates?.total_cents ?? 0;
                const isDeposit = r.amount_cents > 0;
                const pct = isDeposit && total > 0 ? Math.round((r.amount_cents / total) * 100) : null;
                return (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0" data-testid={`invoice-${r.id}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{dateFmt(r.issued_on)}</td>
                    <td className="px-4 py-3">
                      {r.estimate_id ? (
                        <Link className="font-medium text-gray-900 hover:underline"
                          href={`/quote?id=${r.estimate_id}&from=${encodeURIComponent("/invoices")}`}>
                          {r.estimates?.title || "Untitled estimate"}
                        </Link>
                      ) : (
                        <span className="text-gray-400">No estimate on file</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.estimates?.accepted_name || "—"}</td>
                    <td className="px-4 py-3">
                      {isDeposit
                        ? <span className="text-gray-700">Deposit{pct != null ? ` · ${pct}%` : ""}</span>
                        : <span className="text-amber-700">Final — to be priced</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {isDeposit ? money(r.amount_cents) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CHIP[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
