import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { priceEstimateTotals, type BlockInput } from "@/lib/pricing/estimate";
import { exclusionFrom, provingRow, provingSummary, splitProving, type ProvingExclusion, type ProvingRow, type WizardSnapshot } from "@/lib/wizard/proving";
import { correctionBreakdown, correctionFrom, type Correction } from "@/lib/wizard/correction";
import CorrectionTags from "./CorrectionTags";
import ExcludeButton from "./ExcludeButton";

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

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
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
  // Phase 3 (6 Sep plan): WHY staff corrected each one, tagged on the row.
  const corrections: Record<string, Correction | null> = {};
  // Tom, 9 Sep: rows he has set aside as not a fair test.
  const exclusions: Record<string, ProvingExclusion | null> = {};
  for (const e of (estimates ?? []) as EstimateRow[]) {
    const state = (e.builder_state ?? {}) as {
      blocks?: unknown[];
      wizard?: { submittedAt?: string; snapshot?: WizardSnapshot; correction?: unknown; provingExcluded?: unknown };
    };
    corrections[e.id] = correctionFrom(state.wizard?.correction);
    exclusions[e.id] = exclusionFrom(state.wizard?.provingExcluded);
    const snapshot = state.wizard?.snapshot ?? null;
    const blocks = Array.isArray(state.blocks) ? state.blocks : [];
    const totals = priceEstimateTotals(blocks as BlockInput[], ctx, adjustmentsFrom(state as Record<string, unknown>));
    const row = provingRow(e, snapshot, totals.totalCents, state.wizard?.submittedAt ?? e.created_at);
    if (row) rows.push(row);
  }

  // The set-aside rows are off every number on this page, not just the table.
  const { kept, excluded } = splitProving(rows, exclusions);
  const summary = provingSummary(kept);
  const pending = (estimates ?? []).length - rows.length;
  const why = correctionBreakdown(kept.map((r) => ({ correction: corrections[r.estimateId] ?? null, correctionCents: r.correctionCents })));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Proving window</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every wizard estimate, its first-guess price versus where staff took it. The gate opens when the
        median correction stays under $150 across a real run of jobs.
      </p>
      {(kept.length > 0 || excluded.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="proving-bulk">
          {kept.length > 0 && (
            <ExcludeButton
              ids={kept.map((r) => r.estimateId)}
              excluded
              bulk
              label={`Remove all ${kept.length} from the window`}
              testId="exclude-all"
            />
          )}
          <span className="text-xs text-gray-400">
            Removing takes a row off this page and out of every number on it. Nothing is deleted — the estimate,
            its history and its first-guess snapshot stay exactly as they are, and you can put it back below.
          </span>
        </div>
      )}

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

      {/* ---- why staff corrected them (Phase 3) ---------------------------- */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="why-corrected">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Why staff corrected them</h2>
          <span className="text-xs text-gray-500">{why.tagged} tagged · {why.untagged} still to tag</span>
        </div>
        {why.reasons.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing tagged yet. Tap “Why did it change?” on a row after you have priced it — ten tagged rows tell us what to fix first.</p>
        ) : (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {why.reasons.map((r) => (
              <li key={r.reason} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-gray-800">{r.label}</span>
                <span className="tabular-nums text-gray-500">{r.count} · median {money(r.medianAbsCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- per-estimate table ------------------------------------------- */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="proving-table">
          <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Estimate</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2 text-right">Wizard</th>
              <th className="px-3 py-2 text-right">Now</th>
              <th className="px-3 py-2 text-right">Correction</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Why it changed</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {kept.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                {excluded.length > 0
                  ? "Every row is set aside — new estimates will appear here as they\u2019re submitted."
                  : "No wizard estimates carry a snapshot yet — new ones will appear here as they\u2019re submitted."}
              </td></tr>
            )}
            {kept.map((r) => {
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
                  <td className="px-3 py-2 align-top" style={{ minWidth: 220 }}>
                    <CorrectionTags estimateId={r.estimateId} initial={corrections[r.estimateId] ?? null} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ExcludeButton ids={[r.estimateId]} excluded label="Remove" testId="exclude-one" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {excluded.length > 0 && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="proving-excluded">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Set aside · {excluded.length}</h2>
            <ExcludeButton ids={excluded.map((r) => r.estimateId)} excluded={false} label="Put them all back" testId="restore-all" />
          </div>
          <p className="mt-1 text-xs text-gray-500">Off the window and out of the numbers above. The estimates themselves are untouched.</p>
          <ul className="mt-3 divide-y divide-gray-200">
            {excluded.map((r) => (
              <li key={r.estimateId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm">
                  <Link href={`/quote?id=${r.estimateId}`} className="text-gray-800 hover:underline">{r.title}</Link>
                  <span className="ml-2 text-xs text-gray-400">
                    {r.submittedAt ? r.submittedAt.slice(0, 10) : r.source}
                    {r.exclusion.reason ? ` · ${r.exclusion.reason}` : ""}
                  </span>
                </span>
                <ExcludeButton ids={[r.estimateId]} excluded={false} label="Put back" testId="restore-one" />
              </li>
            ))}
          </ul>
        </div>
      )}

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
