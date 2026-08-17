import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readFloorplanPage, hasApiKey } from "@/lib/extract/model";
import { validateExtraction } from "@/lib/extract/validate";
import { buildDraft } from "@/lib/extract/draft";
import { PROMPT_VERSION } from "@/lib/extract/schema";
import type { ScopeRule, Alias } from "@/lib/extract/scope";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/:runId/read
 *
 * Stage 2 (the model call) followed immediately by stages 3 and 4, which are
 * deterministic. The run row ends up holding the raw reading, the validation
 * report and a preview of the draft tree — but NOTHING is written to an
 * estimate here. Applying is a separate, deliberate call.
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
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server, so plans can't be read yet.", code: "no_api_key" },
      { status: 503 },
    );
  }

  const { data: run } = await supabase
    .from("extraction_runs")
    .select("id, status, estimate_sources ( id, storage_path, page_class )")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });

  const source = (run as unknown as { estimate_sources: { id: string; storage_path: string; page_class: string | null } | null }).estimate_sources;
  if (!source) return NextResponse.json({ error: "That run has no page attached." }, { status: 422 });

  await supabase.from("extraction_runs").update({ status: "running" }).eq("id", runId);

  const file = await supabase.storage.from("estimate-sources").download(source.storage_path);
  if (file.error || !file.data) {
    await supabase.from("extraction_runs").update({ status: "failed", error: "page image missing" }).eq("id", runId);
    return NextResponse.json({ error: "The stored page couldn't be read back." }, { status: 502 });
  }
  const bytes = new Uint8Array(await file.data.arrayBuffer());

  const result = await readFloorplanPage(bytes, {
    pageContext: source.page_class ? `classified as ${source.page_class}` : undefined,
  });

  if (!result.ok) {
    reportError(result.message, { where: "extract.read", extra: { runId, code: result.code } });
    await supabase.from("extraction_runs")
      .update({ status: "failed", error: result.message, completed_at: new Date().toISOString() })
      .eq("id", runId);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
  }

  // ---- stage 3: validation (no AI) -----------------------------------------
  const report = validateExtraction(result.extraction);

  // ---- stage 4: scope mapping (no AI, rules from Settings) ------------------
  const [{ data: rules }, { data: aliases }] = await Promise.all([
    supabase.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", 1),
    supabase.from("room_name_aliases").select("alias, room_type").eq("version", 1),
  ]);

  const draft = buildDraft(
    result.extraction,
    (rules as ScopeRule[] | null) ?? [],
    (aliases as Alias[] | null) ?? [],
    { sourceId: source.id },
  );

  await supabase.from("extraction_runs").update({
    status: report.usable ? "needs_review" : "failed",
    model: result.model,
    prompt_version: PROMPT_VERSION,
    raw_output: result.extraction,
    validation_report: { ...report, draft_preview: { areas: draft.areas.length, skipped: draft.skipped } },
    confidence_summary: {
      rooms: report.roomCount,
      dimensioned: report.dimensionedRooms,
      assumed_values: draft.assumedCount,
    },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    cost_cents: result.costCents,
    error: report.usable ? null : "the plan has nothing to measure from",
    completed_at: new Date().toISOString(),
  }).eq("id", runId);

  return NextResponse.json({
    runId,
    usable: report.usable,
    rooms: report.roomCount,
    dimensioned: report.dimensionedRooms,
    undimensioned: report.undimensionedRooms,
    areas: draft.areas.length,
    skipped: draft.skipped,
    assumedValues: draft.assumedCount,
    flags: report.flags,
    costCents: result.costCents,
  });
}
