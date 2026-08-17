import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * /dev/extract/[runId] — the internal debug view for one extraction run.
 *
 * Deliberately ugly and deliberately complete: it shows the rendered page, the
 * text layer that came out of the PDF, and WHY the page was classified the way
 * it was. When a plan reads badly, this is the page that tells you whether the
 * problem was the render, the text, the classification or (later) the model.
 *
 * Staff only, and noindex — it shows a customer's floorplan.
 */

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type Run = {
  id: string;
  status: string;
  model: string | null;
  prompt_version: string | null;
  raw_output: unknown;
  validation_report: {
    page_classification?: {
      page_class?: string;
      confidence?: number;
      reasons?: string[];
      from_text_layer?: boolean;
    };
    rendition?: { width_px?: number; height_px?: number; dpi?: number };
  } | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  estimate_sources: {
    id: string;
    kind: string;
    storage_path: string;
    page_no: number | null;
    mime_type: string | null;
    byte_size: number | null;
    page_class: string | null;
    page_class_confidence: number | null;
    text_layer: string | null;
    estimate_id: string | null;
  } | null;
};

const CLASS_TONE: Record<string, string> = {
  floorplan_interior: "bg-emerald-100 text-emerald-900",
  elevation: "bg-sky-100 text-sky-900",
  site_plan: "bg-indigo-100 text-indigo-900",
  photo: "bg-amber-100 text-amber-900",
  other: "bg-gray-200 text-gray-700",
};

export default async function ExtractDebugPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/dashboard");

  const { data } = await supabase
    .from("extraction_runs")
    .select(
      "id, status, model, prompt_version, raw_output, validation_report, error, created_at, completed_at, " +
      "estimate_sources ( id, kind, storage_path, page_no, mime_type, byte_size, page_class, page_class_confidence, text_layer, estimate_id )",
    )
    .eq("id", runId)
    .maybeSingle();

  const run = data as Run | null;
  if (!run) notFound();

  const source = run.estimate_sources;
  // Private bucket: the image is fetched through a short-lived signed URL, never
  // a public one. A floorplan is the customer's home with the rooms labelled.
  let imageUrl: string | null = null;
  if (source?.storage_path) {
    const { data: signed } = await supabase.storage
      .from("estimate-sources")
      .createSignedUrl(source.storage_path, 300);
    imageUrl = signed?.signedUrl ?? null;
  }

  const cls = run.validation_report?.page_classification;
  const rendition = run.validation_report?.rendition;

  return (
    <main className="mx-auto max-w-5xl p-6 font-mono text-sm">
      <div className="mb-6 rounded-xl bg-ink px-5 py-4 text-white">
        <h1 className="text-lg font-semibold">Extraction run</h1>
        <p className="mt-1 text-xs text-gray-400">
          {run.id} · {run.status}
          {run.model ? ` · ${run.model}` : " · no model call yet (P0)"}
          {run.prompt_version ? ` · prompt ${run.prompt_version}` : ""}
        </p>
      </div>

      {run.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">{run.error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">Page {source?.page_no ?? "?"}</h2>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={`Page ${source?.page_no ?? ""}`} className="w-full rounded-lg border border-gray-300" />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
              No rendition stored for this run.
            </div>
          )}
          <dl className="mt-3 space-y-1 text-xs text-gray-600">
            <div>source kind: <b>{source?.kind}</b></div>
            <div>storage: {source?.storage_path}</div>
            {rendition?.width_px ? (
              <div>rendered: {rendition.width_px}×{rendition.height_px} px @ {rendition.dpi} DPI</div>
            ) : null}
            <div>estimate: {source?.estimate_id ?? <span className="text-amber-700">not attached yet</span>}</div>
          </dl>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Classification</h2>
          <div className="rounded-lg border border-gray-200 p-3">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASS_TONE[cls?.page_class ?? "other"]}`}>
              {cls?.page_class ?? source?.page_class ?? "unclassified"}
            </span>
            <span className="ml-2 text-xs text-gray-500">
              confidence {((cls?.confidence ?? source?.page_class_confidence ?? 0) * 100).toFixed(0)}%
            </span>
            <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">
              {(cls?.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {cls?.from_text_layer === false && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                No text layer — this is a scan or a photo. Dimensions will have to be read from
                the image by the model rather than parsed exactly.
              </p>
            )}
          </div>

          <h2 className="mt-5 mb-2 font-semibold">Text layer</h2>
          {source?.text_layer ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
              {source.text_layer}
            </pre>
          ) : (
            <p className="text-xs text-gray-500">
              None stored. On a vector PDF this holds the exact dimension strings; on a scan it is empty.
            </p>
          )}

          <h2 className="mt-5 mb-2 font-semibold">Raw model output</h2>
          <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
            {run.raw_output ? JSON.stringify(run.raw_output, null, 2) : "— no model call yet (P0 stops at the render) —"}
          </pre>
        </section>
      </div>
    </main>
  );
}
