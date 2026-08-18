import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasApiKey, MODEL } from "@/lib/extract/model";
import { ELEVATION_PROMPT_VERSION, readFloorplanFootprint, type TypicalWidthRow } from "@/lib/extract/elevation";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/:runId/footprint — RULE 2 of Tom's width ruling
 * (19 Aug 2026): when no photo reference gives an elevation its width, the
 * floorplan's printed room dimensions are summed along each side (standard
 * widths for unlisted rooms, from room_type_defaults). The result is stored
 * as its OWN run on the same page, shaped like a site-plan reading, so the
 * wizard submit consumes it through the same envelope path — and everything
 * priced from it carries the width_from_plan flag for a human check.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const paramsSchema = z.object({ runId: z.string().uuid() });

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  const { runId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });

  if (!hasApiKey()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server.", code: "no_api_key" }, { status: 503 });
  }

  const { data: run } = await supabase
    .from("extraction_runs")
    .select("id, estimate_sources ( id, storage_path, page_class )")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  const source = (run as unknown as { estimate_sources: { id: string; storage_path: string; page_class: string | null } | null }).estimate_sources;
  if (!source) return NextResponse.json({ error: "That run has no page attached." }, { status: 422 });

  const file = await supabase.storage.from("estimate-sources").download(source.storage_path);
  if (file.error || !file.data) {
    return NextResponse.json({ error: "The stored page couldn't be read back." }, { status: 502 });
  }

  const { data: typicalRows } = await supabase
    .from("room_type_defaults")
    .select("room_type, typical_width_m")
    .eq("version", 3);

  const result = await readFloorplanFootprint(new Uint8Array(await file.data.arrayBuffer()), {
    typicals: (typicalRows ?? []) as TypicalWidthRow[],
  });
  if (!result.ok) {
    reportError(result.message, { where: "extract.footprint", extra: { runId } });
    return NextResponse.json({ error: result.message }, { status: 502 });
  }

  const measured = result.read.edges.filter((e) => e.lengthM != null && e.basis !== "none").length;

  // Its own run on the same page: the reading is a different product of the
  // same source, and the submit route routes stored readings by their shape.
  const { data: created, error } = await supabase
    .from("extraction_runs")
    .insert({
      estimate_source_id: source.id,
      status: "needs_review",
      model: MODEL,
      prompt_version: ELEVATION_PROMPT_VERSION,
      raw_output: result.read,
      confidence_summary: { edges: result.read.edges.length, measured, footprint_of: runId },
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) {
    reportError(error, { where: "extract.footprint.insert", extra: { runId } });
    return NextResponse.json({ error: `Couldn't store the footprint reading: ${error?.message}` }, { status: 500 });
  }

  return NextResponse.json({
    footprintRunId: created.id,
    edges: result.read.edges.length,
    measured,
    storeys: result.read.storeys,
    costCents: result.costCents,
  });
}
