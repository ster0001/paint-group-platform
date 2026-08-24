import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import { invoiceBalanceCents, invoiceIsOverdue } from "@/lib/invoicing/derive";
import { loadDashboard, toDerive, toDerivePayments } from "@/app/invoicing/data";

export const dynamic = "force-dynamic";

/**
 * The INVOICING tab (Tom, 24 Aug follow-up #2) — the estimates-tab layout
 * over jobs with invoices. One row per job; the ADDRESS opens the revision
 * builder (the one door for changing an invoice), the status of every invoice
 * sits on the row, and the filters cut to what's active. The ledger dashboard
 * lives next door under Payments.
 */

const FILTERS = ["active", "all", "draft", "awaiting", "overdue", "paid"] as const;
type Filter = (typeof FILTERS)[number];

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CHIP: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  issued: "bg-sky-100 text-sky-700",
  sent: "bg-sky-100 text-sky-700",
  viewed: "bg-cyan-100 text-cyan-700",
  partially_paid: "bg-cyan-100 text-cyan-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-gray-200 text-gray-500",
  written_off: "bg-gray-200 text-gray-500",
  overdue: "bg-rose-100 text-rose-700",
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(f ?? "") ? (f as Filter) : "active";

  const supabase = await createClient();
  const today = melbourneDate(new Date());
  const { invoices, payments } = await loadDashboard(supabase);
  const derive = toDerive(invoices);
  const dPays = toDerivePayments(payments);

  type JobRow = {
    estimateId: string;
    address: string;
    invoices: { id: string; label: string; status: string; overdue: boolean; balanceCents: number }[];
    balanceCents: number;
    hasActive: boolean;
  };
  const byJob = new Map<string, JobRow>();
  for (const r of invoices) {
    const d = derive.find((x) => x.id === r.id)!;
    const overdue = invoiceIsOverdue(d, dPays, today);
    const balance = invoiceBalanceCents(d, dPays);
    const open = !["paid", "void", "written_off"].includes(r.status);
    const job = byJob.get(r.estimate_id) ?? {
      estimateId: r.estimate_id,
      address: r.estimates?.job_address || r.estimates?.title || "Untitled job",
      invoices: [], balanceCents: 0, hasActive: false,
    };
    job.invoices.push({
      id: r.id,
      label: `${r.number ?? "Draft"} · ${r.kind}`,
      status: overdue ? "overdue" : r.status,
      overdue,
      balanceCents: balance,
    });
    if (open) { job.balanceCents += Math.max(0, balance); job.hasActive = true; }
    byJob.set(r.estimate_id, job);
  }

  const matches = (job: JobRow): boolean => {
    switch (filter) {
      case "all": return true;
      case "active": return job.hasActive;
      case "draft": return job.invoices.some((i) => i.status === "draft");
      case "awaiting": return job.invoices.some((i) => ["issued", "sent", "viewed", "partially_paid"].includes(i.status));
      case "overdue": return job.invoices.some((i) => i.overdue);
      case "paid": return job.invoices.length > 0 && job.invoices.every((i) => ["paid", "void", "written_off"].includes(i.status));
    }
  };
  const rows = [...byJob.values()].filter(matches)
    .sort((a, b) => b.balanceCents - a.balanceCents);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Invoicing</h1>
        <Link href="/invoicing" className="text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline">
          Payments dashboard →
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {FILTERS.map((k) => (
          <Link
            key={k}
            href={k === "active" ? "/invoices" : `/invoices?f=${k}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              filter === k ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {k}
          </Link>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm" data-testid="invoices-table">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Invoices</th>
                <th className="px-4 py-3 text-right">Open balance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr key={job.estimateId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50" data-testid={`job-${job.estimateId}`}>
                  <td className="px-4 py-3">
                    {/* The address IS the door to the revision builder. */}
                    <Link
                      href={`/quote?id=${job.estimateId}&mode=revision`}
                      className="font-medium text-gray-900 hover:underline"
                      data-testid={`revise-${job.estimateId}`}
                    >
                      {job.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {job.invoices.map((i) => (
                        <span key={i.id} className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[i.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {i.label} · {i.status.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px]">
                    {job.balanceCents > 0 ? money(job.balanceCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/invoicing/job/${job.estimateId}`} className="text-xs font-medium text-gray-500 hover:text-gray-900 hover:underline">
                      Money view →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          No {filter === "all" ? "" : `${filter} `}invoices — a deposit drafts itself when an estimate is accepted.
        </div>
      )}
    </div>
  );
}
