import { redirect } from "next/navigation";
import { money0 as money } from "@/lib/format/money";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { priceEstimateTotals, type BlockInput } from "@/lib/pricing/estimate";
import { provingRow, provingSummary, type ProvingRow, type WizardSnapshot } from "@/lib/wizard/proving";

/**
 * /proving — the Step 9 proving-window dashboard (staff).
 *
 * Every wizard estimate froze its first-guess numbers at submit. This page
 * reprices each one as it stands now and shows how far staff corrected it —
 * per estimate and in aggregate. The gate's exit condition (median staff
 * correction < $150, on a real sample) is read straight off the summary,
 * so "is the wizard accurate enough to switch on?" stops being a feeling.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Proving window · Paint Group", robots: { index: false, follow: false } };

const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${money(Math.abs(cents))}`;

type EstimateRow = {
  id: string; title: string | null; status: string | null; source: string | null;
  builder_state: unknown; created_at: string;
};

export default async function ProvingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/account");

  const [{ data: estimates }, ctx] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, title, status, source, builder_state, created_at")
      .in("source", ["wizard", "trade_wizard", "customer_intake"])
      .order("created_at", { ascending: false })
      .limit(200),
    loadPricingContext(supabase),
  ]);

  const rows: ProvingRow[] = [];
  for (const e of (estimates ?? []) as EstimateRow[]) {
    const state = (e.builder_state ?? {}) as {
      blocks?: unknown[];
      wizard?: { submittedAt?: string; snapshot?: WizardSnapshot };
    };
    const snapshot = state.wizard?.snapshot ?? null;
    const blocks = Array.isArray(state.blocks) ? state.blocks : [];
    const totals = priceEstimateTotals(blocks as BlockInput[], ctx, adjustmentsFrom(state as Record<string, unknown>));
    const row = provingRow(e, snapshot, totals.totalCents, state.wizard?.submittedAt ?? e.created_at);
    if (row) rows.push(row);
  }

  const summary = provingSummary(rows);
  const pending = (estimates ?? []).length - rows.length;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Proving window</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every wizard estimate, its first-guess price versus where staff took it. The gate opens when the
        median correction stays under $150 across a real run of jobs.
      </p>

      {/* ---- the gate scoreboard ------------------------------------------- */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Wizard estimates" value={String(summary.count)} sub={pending > 0 ? `${pending} pre-snapshot` : "all measured"} />
        <Stat
          label="Median correction"
          value={money(summary.medianAbsCorrectionCents)}
          sub="target under $150"
          tone={summary.medianAbsCorrectionCents < 15000 ? "good" : "warn"}
        />
        <Stat label="Within ±10%" value={`${Math.round(summary.withinTenPctShare * 100)}%`} sub="of the original" />
        <Stat
          label="Gate"
          value={summary.gatePasses ? "Holding" : "Not yet"}
          sub={summary.count < 10 ? `needs ${10 - summary.count} more jobs` : summary.gatePasses ? "median under $150" : "median over $150"}
          tone={summary.gatePasses ? "good" : "warn"}
        />
      </div>

      {/* ---- per-estimate table ------------------------------------------- */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Estimate</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2 text-right">Wizard</th>
              <th className="px-3 py-2 text-right">Now</th>
              <th className="px-3 py-2 text-right">Correction</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                No wizard estimates carry a snapshot yet — new ones will appear here as they&rsquo;re submitted.
              </td></tr>
            )}
            {rows.map((r) => {
              const big = r.correctionPct != null && Math.abs(r.correctionPct) > 10;
              return (
                <tr key={r.estimateId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/quote?id=${r.estimateId}`} className="font-medium text-gray-900 hover:underline">{r.title}</Link>
                    <div className="text-xs text-gray-400">{r.source}{r.submittedAt ? ` · ${r.submittedAt.slice(0, 10)}` : ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{r.outcome}</span>
                    {r.walkthroughRequired && <span className="ml-1 text-xs text-amber-600">walkthrough</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{money(r.originalCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{money(r.currentCents)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${big ? "font-semibold text-amber-700" : "text-gray-600"}`}>
                    {signed(r.correctionCents)}
                    {r.correctionPct != null && <span className="ml-1 text-xs text-gray-400">{r.correctionPct >= 0 ? "+" : ""}{r.correctionPct.toFixed(0)}%</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.accuracyPct}%</td>
                  <td className="px-3 py-2">
                    <span className={r.accepted ? "text-emerald-600" : "text-gray-500"}>{r.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        &ldquo;Correction&rdquo; is how much the priced total moved after staff opened the estimate — the
        proving-window signal. A big move (amber) is worth reading: it&rsquo;s where the wizard&rsquo;s guess and the
        real job diverged most.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  const valueClass = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
