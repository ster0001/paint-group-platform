import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ESTIMATE_STAGE_LABEL } from "@/lib/crm/estimateStage";
import { loadEstimateStage } from "@/lib/crm/estimateStageLoad";

/**
 * /estimates/stage/[id] — Estimates tab session 2's dev route (staff): one
 * estimate's stage as `estimateStageFor` reads it, with the facts it read.
 * The proof that the pure function runs on real rows before session 4 puts
 * it on the Pipeline cards. Not linked from anywhere yet.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate stage · Paint Group", robots: { index: false, follow: false } };

const when = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export default async function EstimateStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) return <main className="p-6"><h1 className="text-lg font-semibold">That is not an estimate id.</h1></main>;

  const supabase = await createClient();
  const load = await loadEstimateStage(supabase, id.data);
  if (!load.ok) {
    return (
      <main className="p-6" data-testid="stage-error">
        <h1 className="text-lg font-semibold">Couldn&apos;t work out this estimate&apos;s stage.</h1>
        <p className="mt-2 text-sm text-gray-500">{load.error}</p>
      </main>
    );
  }
  const r = load.result;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-xs uppercase tracking-wide text-gray-400">Estimate stage · dev route</p>
      <h1 className="mt-1 text-xl font-semibold">{load.title || "Untitled estimate"}</h1>
      <p className="mt-1 text-sm"><Link className="underline" href={`/quote?id=${id.data}`}>Open the estimate</Link></p>

      <section className="mt-6 rounded-lg border p-4">
        <p className="text-2xl font-semibold" data-testid="estimate-stage" data-stage={r?.stage ?? "none"}>{r ? ESTIMATE_STAGE_LABEL[r.stage] : "No stage"}</p>
        {r && <p className="mt-1 text-sm text-gray-600" data-testid="estimate-stage-because">{r.because} · since {when(r.since)}{r.idle ? " · idle" : ""}</p>}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">What it read</h2>
        <p className="mt-1 text-sm text-gray-600">
          Wizard session: {load.draftId ?? "none"} · {load.facts.events.length} events · {load.facts.chat.length} chat messages
          {load.facts.job ? " · a job" : ""}
        </p>
        <ol className="mt-3 space-y-1 text-sm" data-testid="estimate-stage-events">
          {load.facts.events.map((e, i) => (
            <li key={`${e.type}-${e.occurred_at}-${i}`} className="font-mono text-xs"><span className="text-gray-400">{when(e.occurred_at)}</span> {e.type}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
