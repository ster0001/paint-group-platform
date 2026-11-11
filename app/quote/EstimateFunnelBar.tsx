import type { SupabaseClient } from "@supabase/supabase-js";
import { BrandPill } from "@/app/components/BrandPill";
import { loadEstimateStage } from "@/lib/crm/estimateStageLoad";
import { ESTIMATE_STAGE_LABEL } from "@/lib/crm/estimateStage";
import { stageStrip, wizardPath } from "@/lib/estimate/estimateBar";
import { stageAge } from "@/lib/estimate/pipeline";
import { formatEstimateNumber } from "@/lib/estimate/number";

/**
 * Estimates tab session 6 (brief §4.6): the bar above an estimate — which
 * shopfront, the number, where it came from, how often the customer opened
 * it (R12) and came back (R13), the stage strip with the current stage and
 * its age (`estimateStageFor`, never stored), and the wizard path in one line.
 * Staff only: /quote is a staff route.
 */
const stepName = (k: string) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const secs = (s: number) => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

export default async function EstimateFunnelBar({ supabase, estimateId, number, brand, source }: {
  supabase: SupabaseClient; estimateId: string; number: number | null; brand: string | null; source: string | null;
}) {
  const now = new Date();
  const [stage, views, draft] = await Promise.all([
    loadEstimateStage(supabase, estimateId, now),
    supabase.from("estimate_views").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId),
    supabase.from("wizard_drafts").select("visits").eq("estimate_id", estimateId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const viewCount = views.error ? null : views.count ?? 0;
  const cameBack = draft.error ? 0 : Math.max(0, ((draft.data as { visits?: number } | null)?.visits ?? 1) - 1);
  const fromWizard = source === "customer_intake" || Boolean(draft.data);
  const result = stage.ok ? stage.result : null;
  const strip = stageStrip(result?.stage ?? null);
  const path = stage.ok ? wizardPath(stage.facts.events) : [];
  return (
    <div className="mx-auto max-w-6xl px-6 pt-4" data-testid="estimate-funnel-bar" data-stage={result?.stage ?? "none"}>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <BrandPill brand={brand} always />
          {number != null && <span className="font-mono text-xs text-gray-500">#{formatEstimateNumber(number)}</span>}
          <span className="text-xs text-gray-500" data-testid="estimate-bar-source">{fromWizard ? "From the wizard" : "Built by staff"}</span>
          {viewCount != null && viewCount > 0 && <span className="rounded-full border border-cyan-300 px-2 py-0.5 text-[11px] font-semibold text-cyan-800" data-testid="estimate-bar-viewed">Viewed {viewCount}×</span>}
          {cameBack > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800" data-testid="estimate-bar-came-back">Came back ×{cameBack}</span>}
          {result && (
            <span className="ml-auto text-xs text-gray-600" data-testid="estimate-bar-stage">
              <b>{ESTIMATE_STAGE_LABEL[result.stage]}</b> · {stageAge(result.since, now)}{result.idle ? " · idle" : ""} — {result.because}
            </span>
          )}
          {!stage.ok && <span className="ml-auto text-xs text-red-700" data-testid="estimate-bar-error">Stage could not be worked out: {stage.error}</span>}
        </div>
        <ol className="mt-2 flex gap-1 overflow-x-auto pb-1 text-[11px]" aria-label="Stages" data-testid="estimate-stage-strip">
          {strip.map((s) => (
            <li key={s.stage} data-state={s.state} data-stage={s.stage}
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 ${s.state === "current" ? "bg-gray-900 font-semibold text-white" : s.state === "done" ? "bg-gray-100 text-gray-600" : "text-gray-400"}`}
              aria-current={s.state === "current" ? "step" : undefined}>
              {s.label}
            </li>
          ))}
        </ol>
        {path.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-gray-500" data-testid="estimate-wizard-path" title={path.map((p) => `${stepName(p.step)} ${p.seconds == null ? "—" : secs(p.seconds)}`).join(" → ")}>
            Wizard:{" "}
            {path.map((p, i) => (
              <span key={p.step}>
                {i > 0 && " → "}
                <span className={p.slow ? "font-semibold text-gray-800" : ""} data-slow={p.slow ? "1" : "0"}>{stepName(p.step)} {p.seconds == null ? "—" : secs(p.seconds)}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
