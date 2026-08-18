import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildDraft } from "@/lib/extract/draft";
import { extractionSchema } from "@/lib/extract/schema";
import { SCOPE_VERSION, type ScopeRule, type Alias } from "@/lib/extract/scope";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/:runId/apply
 *
 * Creates the estimate and its area/surface tree from a completed run.
 *
 * THE NON-NEGOTIABLE, from the brief: this accepts geometry and scope only. No
 * price, no hour and no quantity crosses the wire, and none is written here.
 * The tree goes into estimates.builder_state exactly as a hand-built one does,
 * and lib/pricing prices it when the builder opens — the same code path, with
 * no idea a model was involved.
 *
 * The draft is rebuilt HERE from the stored reading rather than accepted from
 * the browser, so a client cannot post a tree of its own choosing.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  /** Attach to an estimate that already exists instead of making one. */
  estimateId: z.string().uuid().optional(),
  /**
   * REQUIRED (Tom's rule): the ceiling height, confirmed by the estimator, and
   * applied to every room in the draft. It multiplies every wall in the job, so
   * it is asked for once and never assumed silently. A photo may propose it;
   * a human still confirms it.
   */
  ceilingHeightM: z.number().min(2).max(6),
});

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  }

  let body: unknown = {};
  try { body = await request.json(); } catch { /* an empty body is fine */ }
  const parsedBody = bodySchema.safeParse(body ?? {});
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });

  const { data: run } = await supabase
    .from("extraction_runs")
    .select("id, status, raw_output, estimate_sources ( id, estimate_id )")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (run.status === "applied") {
    return NextResponse.json({ error: "This reading has already been applied.", code: "already_applied" }, { status: 409 });
  }
  if (!run.raw_output) {
    return NextResponse.json({ error: "That run hasn't been read yet.", code: "not_read" }, { status: 409 });
  }

  const reading = extractionSchema.safeParse(run.raw_output);
  if (!reading.success) {
    return NextResponse.json({ error: "The stored reading is not in a usable shape." }, { status: 422 });
  }

  const [{ data: rules }, { data: aliases }, { data: defectRates }] = await Promise.all([
    supabase.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
    supabase.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
    supabase.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
  ]);

  const source = (run as unknown as { estimate_sources: { id: string; estimate_id: string | null } | null }).estimate_sources;
  // The confirmed height replaces whatever the reading assumed, for every room.
  const readingWithHeight = { ...reading.data, ceiling_height_m: parsedBody.data.ceilingHeightM };

  // A plan often arrives as SEPARATE files — one image per storey — and each
  // file is its own run. Applying into an estimate that already has areas
  // APPENDS rather than replaces, so ground floor + first floor become one
  // job, and a plan applied into a hand-started estimate cannot wipe the hand
  // work. New node ids start above every id already in the tree.
  const targetForAppend = parsedBody.data.estimateId ?? source?.estimate_id ?? null;
  let existingBlocks: Array<{ id: number; surfaces?: Array<{ id: number }> }> = [];
  if (targetForAppend) {
    const { data: existing } = await supabase
      .from("estimates").select("builder_state").eq("id", targetForAppend).maybeSingle();
    const bs = existing?.builder_state as { blocks?: typeof existingBlocks } | null;
    existingBlocks = Array.isArray(bs?.blocks) ? bs.blocks : [];
  }
  const startId = existingBlocks.length
    ? Math.max(...existingBlocks.flatMap((b) => [b.id, ...(b.surfaces ?? []).map((x) => x.id)])) + 1
    : 1;

  const draft = buildDraft(
    readingWithHeight,
    (rules as ScopeRule[] | null) ?? [],
    (aliases as Alias[] | null) ?? [],
    { sourceId: source?.id ?? null, startId, defectRates: (defectRates as import("@/lib/capture/commit").DefectRate[] | null) ?? [] },
  );

  if (draft.areas.length === 0) {
    return NextResponse.json(
      { error: "Nothing could be generated from this plan — every room was skipped.", skipped: draft.skipped },
      { status: 422 },
    );
  }

  // The builder's own state shape. Only the fields the AI legitimately fills
  // are set; everything else keeps the builder's defaults, so an AI-started
  // estimate and a hand-started one are the same object.
  // Only `blocks` — the builder recomputes its own id counter from the ids it
  // finds (QuoteBuilder line 241), and `source` lives on the estimates row, not
  // in here. Every other key is left absent so the builder applies its own
  // defaults, exactly as it does for a hand-started estimate.
  const builderState = { blocks: [...existingBlocks, ...draft.areas] };

  const estimateId = parsedBody.data.estimateId ?? source?.estimate_id ?? null;

  let targetId = estimateId;
  if (targetId) {
    const { error } = await supabase.from("estimates").update({ builder_state: builderState }).eq("id", targetId);
    if (error) {
      reportError(error, { where: "extract.apply.update", extra: { runId } });
      return NextResponse.json({ error: `Couldn't update that estimate: ${error.message}` }, { status: 500 });
    }
  } else {
    const { data: created, error } = await supabase
      .from("estimates")
      .insert({
        title: parsedBody.data.title ?? "Drafted from a floorplan",
        status: "draft",
        builder_state: builderState,
        source: "ai_floorplan",
      })
      .select("id")
      .single();
    if (error || !created) {
      reportError(error, { where: "extract.apply.insert", extra: { runId } });
      return NextResponse.json({ error: `Couldn't create the estimate: ${error?.message}` }, { status: 500 });
    }
    targetId = created.id;
  }

  await Promise.all([
    supabase.from("extraction_runs").update({ status: "applied" }).eq("id", runId),
    source ? supabase.from("estimate_sources").update({ estimate_id: targetId }).eq("id", source.id) : Promise.resolve(),
    // Step 3's one-height model: the single confirmed ceiling height becomes
    // the "ground" storey entry. Best-effort - before migration 20260913 the
    // column doesn't exist and this update fails quietly, which is fine.
    supabase.from("estimates").update({ storey_heights: { ground: parsedBody.data.ceilingHeightM } }).eq("id", targetId).then(() => undefined, () => undefined),
  ]);

  return NextResponse.json({
    estimateId: targetId,
    appended: existingBlocks.length > 0,
    areas: draft.areas.length,
    totalAreas: existingBlocks.length + draft.areas.length,
    surfaces: draft.areas.reduce((n, a) => n + a.surfaces.length, 0),
    assumedValues: draft.assumedCount,
    skipped: draft.skipped,
    deferred: draft.deferred,
    ceilingHeightM: parsedBody.data.ceilingHeightM,
    openAt: `/quote?id=${targetId}`,
  });
}
