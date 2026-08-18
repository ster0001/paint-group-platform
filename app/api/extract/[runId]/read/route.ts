import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFloorplanPage, hasApiKey, MODEL } from "@/lib/extract/model";
import { ELEVATION_PROMPT_VERSION, readElevationPhoto, readSitePlan, type UnitRow } from "@/lib/extract/elevation";
import { validateExtraction } from "@/lib/extract/validate";
import { buildDraft } from "@/lib/extract/draft";
import { PROMPT_VERSION } from "@/lib/extract/schema";
import { SCOPE_VERSION, type ScopeRule, type Alias } from "@/lib/extract/scope";
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
  // Staff, or a Step 8 customer-wizard visitor reading THEIR OWN page.
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server, so plans can't be read yet.", code: "no_api_key" },
      { status: 503 },
    );
  }

  const { data: run } = await db
    .from("extraction_runs")
    .select("id, status, created_by, estimate_sources ( id, storage_path, page_class )")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (actor.kind === "customer" && (run as { created_by?: string | null }).created_by !== actor.user.id) {
    // Not theirs. 404, not 403 - existence is not confirmed to guessers.
    return NextResponse.json({ error: "No such run." }, { status: 404 });
  }

  const source = (run as unknown as { estimate_sources: { id: string; storage_path: string; page_class: string | null } | null }).estimate_sources;
  if (!source) return NextResponse.json({ error: "That run has no page attached." }, { status: 422 });

  await db.from("extraction_runs").update({ status: "running" }).eq("id", runId);

  const file = await db.storage.from("estimate-sources").download(source.storage_path);
  if (file.error || !file.data) {
    await db.from("extraction_runs").update({ status: "failed", error: "page image missing" }).eq("id", runId);
    return NextResponse.json({ error: "The stored page couldn't be read back." }, { status: 502 });
  }
  const bytes = new Uint8Array(await file.data.arrayBuffer());

  // ---- E2 fork: elevations and site plans get their own readers ------------
  // (previously an elevation photo fell through to the floorplan prompt,
  // found no rooms, and failed as "nothing to measure from").
  if (source.page_class === "elevation") {
    const { data: unitRows } = await db
      .from("measurement_units")
      .select("unit_key, label, size_mm, tolerance_pct")
      .order("version", { ascending: false });
    const result = await readElevationPhoto(bytes, { units: (unitRows ?? []) as UnitRow[] });
    if (!result.ok) {
      reportError(result.message, { where: "extract.read.elevation", extra: { runId } });
      await db.from("extraction_runs")
        .update({ status: "failed", error: result.message, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return NextResponse.json({ error: result.message }, { status: 502 });
    }
    const measured = result.read.cladding.filter((c) => c.heightM != null && c.heightBasis !== "none").length;
    await db.from("extraction_runs").update({
      status: "needs_review",
      model: MODEL,
      prompt_version: ELEVATION_PROMPT_VERSION,
      raw_output: result.read,
      confidence_summary: { elevation: result.read.elevation, segments: result.read.cladding.length, measured },
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      error: null,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({
      runId, kind: "elevation",
      elevation: result.read.elevation,
      segments: result.read.cladding.length,
      measured,
      costCents: result.costCents,
    });
  }

  if (source.page_class === "site_plan") {
    const result = await readSitePlan(bytes);
    if (!result.ok) {
      reportError(result.message, { where: "extract.read.siteplan", extra: { runId } });
      await db.from("extraction_runs")
        .update({ status: "failed", error: result.message, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return NextResponse.json({ error: result.message }, { status: 502 });
    }
    const measuredEdges = result.read.edges.filter((e) => e.lengthM != null && e.basis !== "none").length;
    await db.from("extraction_runs").update({
      status: "needs_review",
      model: MODEL,
      prompt_version: ELEVATION_PROMPT_VERSION,
      raw_output: result.read,
      confidence_summary: { edges: result.read.edges.length, measured: measuredEdges },
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      error: null,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({
      runId, kind: "site_plan",
      edges: result.read.edges.length,
      measured: measuredEdges,
      costCents: result.costCents,
    });
  }

  const result = await readFloorplanPage(bytes, {
    pageContext: source.page_class ? `classified as ${source.page_class}` : undefined,
  });

  if (!result.ok) {
    reportError(result.message, { where: "extract.read", extra: { runId, code: result.code } });
    await db.from("extraction_runs")
      .update({ status: "failed", error: result.message, completed_at: new Date().toISOString() })
      .eq("id", runId);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
  }

  // ---- stage 3: validation (no AI) -----------------------------------------
  const report = validateExtraction(result.extraction);

  // ---- stage 4: scope mapping (no AI, rules from Settings) ------------------
  const [{ data: rules }, { data: aliases }] = await Promise.all([
    db.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
    db.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
  ]);

  const draft = buildDraft(
    result.extraction,
    (rules as ScopeRule[] | null) ?? [],
    (aliases as Alias[] | null) ?? [],
    { sourceId: source.id },
  );

  await db.from("extraction_runs").update({
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
    deferred: draft.deferred,
    assumedValues: draft.assumedCount,
    flags: report.flags,
    costCents: result.costCents,
    /** null unless the plan itself printed one — the estimator confirms it. */
    ceilingHeightM: result.extraction.ceiling_height_m,
  });
}
