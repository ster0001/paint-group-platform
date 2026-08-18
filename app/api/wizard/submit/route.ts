import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildDraft, type DraftArea, type DraftResult } from "@/lib/extract/draft";
import { extractionSchema } from "@/lib/extract/schema";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import type { DefectRate } from "@/lib/capture/commit";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { applyWizardAnswers } from "@/lib/wizard/merge";
import { ceilingHeightFrom, wizardStateSchema } from "@/lib/wizard/state";
import { markStarterProvenance, starterExtraction, starterRoomList, type TypicalSizeRow } from "@/lib/wizard/starter";
import { editorPayload } from "@/lib/wizard/view";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/wizard/submit — W2: wizard completion + extraction result merge
 * into a generated estimate.
 *
 * The same boundary as the apply route, held harder: the body is ANSWERS
 * only (the zod-validated wizard state). The tree is rebuilt here from the
 * STORED extraction readings (or the starter list), merged with the answers
 * by lib/wizard/merge, and priced by lib/pricing — a client cannot post a
 * room, a quantity or a price of its own choosing.
 *
 * Internal mode (Step 7): staff-gated, returns point price + margin.
 * The customer layer (Step 8) adds the email gate, range bands and
 * guardrails on top of this same route's plumbing.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ state: wizardStateSchema });

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid input.", path: issue?.path ?? [] },
      { status: 400 },
    );
  }
  const state = parsed.data.state;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });

  const [{ data: rulesRows }, { data: aliasRows }, { data: defectRows }, { data: typicalRows }] = await Promise.all([
    supabase.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
    supabase.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
    supabase.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
    supabase.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
  ]);
  const rules = (rulesRows ?? []) as ScopeRule[];
  const aliases = (aliasRows ?? []) as Alias[];
  const defectRates = (defectRows ?? []) as DefectRate[];
  const typicals = (typicalRows ?? []) as TypicalSizeRow[];

  const height = ceilingHeightFrom(state.details.ceilingHeight);
  const warnings: string[] = [];
  const areas: DraftArea[] = [];
  const skipped: DraftResult["skipped"] = [];
  const deferred: DraftResult["deferred"] = [];
  let assumedCount = 0;
  let nextId = 1;
  const sourceIds: string[] = [];
  const appliedRunIds: string[] = [];
  let planSourcePath: string | null = null;
  /** Defect observations that actually reached the stored readings — the
   * server's own evidence, never the client's photo count. */
  let observedDefects = 0;

  const wantsInterior = state.jobType !== "exterior";

  if (!wantsInterior) {
    // Exterior-only: the envelope is measured from its own sources (E1 rule),
    // and the drafting routes for it are still to be wired. The estimate is
    // created empty with the site-check deferral carrying the work forward.
  } else if (state.noPlan || state.planRunIds.length === 0) {
    // ---- no-plan path: the starter list from the quick basics --------------
    if (!state.basics) {
      return NextResponse.json({ error: "The quick basics are needed when there is no floorplan." }, { status: 400 });
    }
    const list = starterRoomList(state.basics);
    const x = starterExtraction(list, typicals, {
      heightM: height.assumed ? null : height.heightM,
      bedrooms: state.basics.bedrooms,
    });
    const draft = buildDraft(x, rules, aliases, { startId: nextId, defectRates });
    markStarterProvenance(draft.areas);
    areas.push(...draft.areas);
    skipped.push(...draft.skipped);
    deferred.push(...draft.deferred);
    assumedCount += draft.assumedCount;
  } else {
    // ---- plan path: rebuild from the stored readings, one run per page -----
    const { data: runs } = await supabase
      .from("extraction_runs")
      .select("id, status, raw_output, estimate_sources ( id, storage_path, estimate_id )")
      .in("id", state.planRunIds);

    for (const runId of state.planRunIds) {
      const run = (runs ?? []).find((r) => r.id === runId);
      if (!run) { warnings.push("One uploaded page could not be found and was skipped."); continue; }
      if (run.status === "applied") { warnings.push("One page was already applied to another estimate and was skipped."); continue; }

      const source = (run as unknown as {
        estimate_sources: { id: string; storage_path: string; estimate_id: string | null } | null;
      }).estimate_sources;
      // A source already pinned to another estimate is never claimed — its
      // file belongs to that estimate (and is deleted with it).
      if (source?.estimate_id) {
        warnings.push("One page belongs to another estimate and was skipped.");
        continue;
      }

      if (!run.raw_output) { warnings.push("One page had not finished reading and was skipped."); continue; }
      const reading = extractionSchema.safeParse(run.raw_output);
      if (!reading.success) { warnings.push("One page's reading was unusable and was skipped."); continue; }

      if (source) {
        sourceIds.push(source.id);
        if (!planSourcePath) planSourcePath = source.storage_path;
      }

      // The stated height overrides the reading for every room (Tom's rule:
      // asked once, applied everywhere). "Not sure" keeps whatever the plan
      // printed — usually nothing, which assumes 2.4 m and tags H.
      const withHeight = height.assumed
        ? reading.data
        : { ...reading.data, ceiling_height_m: height.heightM };

      observedDefects += reading.data.defect_observations?.length ?? 0;

      const draft = buildDraft(withHeight, rules, aliases, {
        startId: nextId, sourceId: source?.id ?? null, defectRates,
      });
      areas.push(...draft.areas);
      skipped.push(...draft.skipped);
      deferred.push(...draft.deferred);
      assumedCount += draft.assumedCount;
      appliedRunIds.push(run.id);
      nextId = Math.max(nextId, ...areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)])) + 1;
    }

    if (areas.length === 0 && state.jobType !== "exterior") {
      return NextResponse.json(
        { error: "Nothing could be generated from the uploaded plan.", skipped, warnings },
        { status: 422 },
      );
    }
  }

  nextId = areas.length
    ? Math.max(...areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)])) + 1
    : 1;

  // The damage-photo count is a client claim; the readings are the evidence.
  // If the photos never made it into the defect reader (upload failed, or the
  // no-plan path had no run to attach them to), the merge must raise the
  // "damage to price" deferral rather than trust the count.
  const effectiveState = state.details.damageTier >= 2 && state.details.damagePhotoCount > 0 && observedDefects === 0
    ? { ...state, details: { ...state.details, damagePhotoCount: 0 } }
    : state;
  if (effectiveState !== state) {
    warnings.push("The damage photos didn't reach the defect reader — the damage is flagged for review instead.");
  }

  // ---- the wizard's answers, applied over the drafted tree -----------------
  const merged = applyWizardAnswers({ areas, skipped, assumedCount, deferred }, effectiveState, () => nextId++);

  if (merged.areas.length === 0 && wantsInterior) {
    return NextResponse.json(
      { error: "Every room was skipped — nothing is left to price.", skipped: merged.skipped, warnings },
      { status: 422 },
    );
  }

  const builderState: Record<string, unknown> = {
    blocks: merged.areas,
    aiDeferred: merged.deferred,
    // The full answers ride along: the editor's add-room re-applies them, and
    // the Step 8 customer layer will need them for the range bands.
    wizard: { version: 1, state, submittedAt: new Date().toISOString() },
  };

  const title = state.title.trim() || "Wizard estimate";
  let sourceTag = "wizard";
  let insert = await supabase
    .from("estimates")
    .insert({ title, status: "draft", builder_state: builderState, source: sourceTag })
    .select("id")
    .single();
  if (insert.error && /source/.test(insert.error.message)) {
    // Migration 20260915 (source check) hasn't run yet — degrade gracefully.
    sourceTag = state.noPlan ? "manual" : "ai_floorplan";
    warnings.push("Saved with the old source tag — run migration 20260915000000_wizard_source.sql to enable source=wizard.");
    insert = await supabase
      .from("estimates")
      .insert({ title, status: "draft", builder_state: builderState, source: sourceTag })
      .select("id")
      .single();
  }
  if (insert.error || !insert.data) {
    reportError(insert.error, { where: "wizard.submit.insert" });
    return NextResponse.json({ error: `Couldn't create the estimate: ${insert.error?.message}` }, { status: 500 });
  }
  const estimateId = insert.data.id as string;

  // Facade photo sources (kind=elevation) link to the estimate for E2 —
  // only ones not already pinned to another estimate.
  let facadeSourceIds: string[] = [];
  if (state.facadeRunIds.length) {
    const { data: facadeRuns } = await supabase
      .from("extraction_runs")
      .select("id, estimate_sources ( id, estimate_id )")
      .in("id", state.facadeRunIds);
    facadeSourceIds = (facadeRuns ?? [])
      .map((r) => (r as unknown as { estimate_sources: { id: string; estimate_id: string | null } | null }).estimate_sources)
      .filter((s): s is { id: string; estimate_id: string | null } => Boolean(s) && !s!.estimate_id)
      .map((s) => s.id);
  }

  // One key per storey the draft actually has, so capture's storey switcher
  // can reach every floor. One height across them (Tom's one-height rule) —
  // and only when the height was STATED; an assumed 2.4 stays an assumption
  // on the nodes, settled by the editor's confirm chip.
  const storeyKeys = [...new Set(merged.areas.map((a) => a.storey || "ground"))];
  const storeyHeights = height.assumed || storeyKeys.length === 0
    ? null
    : Object.fromEntries(storeyKeys.map((s) => [s, height.heightM]));

  await Promise.all([
    appliedRunIds.length
      ? supabase.from("extraction_runs").update({ status: "applied" }).in("id", appliedRunIds)
      : Promise.resolve(),
    sourceIds.length || facadeSourceIds.length
      // Belt and braces: the ownership check above plus is-null here, so a
      // concurrent claim can't repoint another estimate's plan.
      ? supabase.from("estimate_sources").update({ estimate_id: estimateId })
          .in("id", [...sourceIds, ...facadeSourceIds]).is("estimate_id", null)
      : Promise.resolve(),
    // Best-effort until migration 20260913/14 has run everywhere.
    storeyHeights
      ? supabase.from("estimates").update({ storey_heights: storeyHeights }).eq("id", estimateId)
          .then(() => undefined, () => undefined)
      : Promise.resolve(),
  ]);

  // ---- price it, score it, hand the editor its whole view ------------------
  const ctx = await loadPricingContext(supabase);
  const payload = editorPayload(merged.areas, ctx, adjustmentsFrom(builderState), merged.deferred);

  // The pinned plan, through a short-lived signed URL (private bucket).
  let planUrl: string | null = null;
  if (planSourcePath) {
    const { data: signed } = await supabase.storage.from("estimate-sources").createSignedUrl(planSourcePath, 3600);
    planUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    estimateId,
    source: sourceTag,
    openAt: `/quote?id=${estimateId}`,
    planUrl,
    skipped: merged.skipped,
    warnings,
    ...payload,
  });
}
