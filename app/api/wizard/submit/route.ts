import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraft, type DraftArea, type DraftResult } from "@/lib/extract/draft";
import { elevationReadSchema, mergeSitePlanWidths, sitePlanReadSchema, type SitePlanRead } from "@/lib/extract/elevation";
import { computeEnvelope, envelopeToAreaNodes, type ElevationRead } from "@/lib/extract/exterior";
import { extractionSchema } from "@/lib/extract/schema";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import type { DefectRate } from "@/lib/capture/commit";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { applyWizardAnswers, filterSurfacesByTicks } from "@/lib/wizard/merge";
import { ceilingHeightFrom, wizardStateSchema, type WizardSurfaceKey } from "@/lib/wizard/state";
import { backfillTypicalSizes, exteriorExtrasNodes, markStarterProvenance, starterExteriorNodes, starterExtraction, starterRoomList, type TypicalSizeRow } from "@/lib/wizard/starter";
import { applyFenceLength } from "@/lib/wizard/scope-editor";
import { customerPayload, editorPayload } from "@/lib/wizard/view";
import {
  GUARDRAIL_MESSAGES, answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
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
  // Identity FIRST — never parse or process a body for a caller we'd refuse.
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });

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

  // Staff submit either mode (internal, or a customer-mode preview). An
  // anonymous customer submits ONLY customer mode, through the service
  // client — they hold no table access of their own.
  if (actor.kind === "customer" && state.mode !== "customer") {
    return NextResponse.json({ error: "Staff only." }, { status: 403 });
  }
  const user = actor.user;
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  // ---- rate limiting (real customers only, before any expensive work) ------
  const ipHash = createHash("sha256")
    .update(`${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}::${process.env.WIZARD_IP_SALT ?? "pg-wizard"}`)
    .digest("hex").slice(0, 32);
  const email = state.customer?.email.trim().toLowerCase() ?? "";
  if (actor.kind === "customer") {
    const { data: limitRow } = await db.from("settings").select("value").eq("key", "wizard_limits").maybeSingle();
    const limits = (limitRow?.value ?? {}) as { maxEstimatesPerVisitor?: number; holdMessage?: string };
    const max = typeof limits.maxEstimatesPerVisitor === "number" ? limits.maxEstimatesPerVisitor : 2;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await db.from("wizard_leads")
      .select("id", { count: "exact", head: true })
      .or(`email.eq.${email},ip_hash.eq.${ipHash}`)
      .neq("outcome", "rate_limited")
      .gte("created_at", since);
    if ((count ?? 0) >= max) {
      await db.from("wizard_leads").insert({
        user_id: user.id, email, ip_hash: ipHash,
        suburb: state.customer?.suburb ?? null, postcode: state.customer?.postcode ?? null,
        job_type: state.jobType, outcome: "rate_limited", reasons: ["rate_limited"],
      }).then((r) => { if (r.error) reportError(r.error, { where: "wizard.leads.rateLimited", bestEffort: true }); });
      return NextResponse.json({
        outcome: "rate_limited",
        message: limits.holdMessage ?? "Looks like you're busy — talk to us and we'll set you up properly.",
      }, { status: 429 });
    }
  }

  const [{ data: rulesRows }, { data: aliasRows }, { data: defectRows }, { data: typicalRows }] = await Promise.all([
    db.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
    db.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
    db.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
    db.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
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
  /** E2: elevation/site-plan readings gathered from facade runs and from
   * plan pages the classifier routed to the exterior readers. */
  const elevationReads: ElevationRead[] = [];
  let sitePlanRead: SitePlanRead | null = null;
  let facadeSourceId: string | null = null;
  let facadeSourcePath: string | null = null;

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
    const { data: runs } = await db
      .from("extraction_runs")
      .select("id, status, created_by, raw_output, estimate_sources ( id, storage_path, estimate_id )")
      .in("id", state.planRunIds);

    for (const runId of state.planRunIds) {
      const run = (runs ?? []).find((r) => r.id === runId);
      if (!run) { warnings.push("One uploaded page could not be found and was skipped."); continue; }
      // OWNERSHIP: the service client bypasses RLS, so a customer's runs must
      // be checked against the actor here - same rule as the read route. A
      // guessed or leaked run UUID must never surface someone else's plan.
      if (actor.kind === "customer" && (run as { created_by?: string | null }).created_by !== user.id) {
        warnings.push("One uploaded page could not be found and was skipped.");
        continue;
      }
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
      if (!reading.success) {
        // Not a floorplan reading — the classifier may have routed this page
        // to the E2 exterior readers instead. Their output feeds the envelope.
        const sp = sitePlanReadSchema.safeParse(run.raw_output);
        if (sp.success) {
          if (!sitePlanRead || sp.data.confidence > sitePlanRead.confidence) sitePlanRead = sp.data;
          if (source) sourceIds.push(source.id);
          appliedRunIds.push(run.id);
          continue;
        }
        const el = elevationReadSchema.safeParse(run.raw_output);
        if (el.success) {
          elevationReads.push(el.data);
          if (source) sourceIds.push(source.id);
          appliedRunIds.push(run.id);
          continue;
        }
        warnings.push("One page's reading was unusable and was skipped.");
        continue;
      }

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
    // Plan-read rooms are often undimensioned (WC, bathroom, laundry): pre-size
    // them from their typicals, flagged to confirm (features #4 + #5).
    backfillTypicalSizes(areas, typicals);
  }

  // ---- facade photos: elevation readings for the envelope (E2) -------------
  const facadeSourceIds: string[] = [];
  if (state.facadeRunIds.length) {
    const { data: facadeRuns } = await db
      .from("extraction_runs")
      .select("id, status, created_by, raw_output, estimate_sources ( id, storage_path, estimate_id )")
      .in("id", state.facadeRunIds);
    for (const run of facadeRuns ?? []) {
      // Same ownership rule as the plan runs above.
      if (actor.kind === "customer" && (run as { created_by?: string | null }).created_by !== user.id) {
        warnings.push("One facade photo could not be found and was skipped.");
        continue;
      }
      const source = (run as unknown as {
        estimate_sources: { id: string; storage_path: string; estimate_id: string | null } | null;
      }).estimate_sources;
      if (source?.estimate_id) { warnings.push("One facade photo belongs to another estimate and was skipped."); continue; }
      if (source) {
        facadeSourceIds.push(source.id);
        if (!facadeSourceId) { facadeSourceId = source.id; facadeSourcePath = source.storage_path; }
      }
      const parsedEl = run.raw_output ? elevationReadSchema.safeParse(run.raw_output) : { success: false as const };
      if (parsedEl.success) {
        elevationReads.push(parsedEl.data);
        appliedRunIds.push(run.id as string);
      } else if (state.jobType !== "interior") {
        warnings.push("One facade photo hasn't been read yet — its wall stays a site measurement.");
      }
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

  // ---- E2: the exterior envelope, measured from its own sources ------------
  // Elevation photos (+ site-plan edge widths) -> computeEnvelope. What
  // measures becomes priced Exterior nodes; what doesn't stays deferred and
  // the job carries requires_site_check — never derived from interior rooms.
  const wantsExterior = state.jobType !== "interior";
  const tickedSurfaces = new Set<WizardSurfaceKey>(effectiveState.surfaces);
  let envelope: ReturnType<typeof computeEnvelope> | null = null;
  if (wantsExterior && (elevationReads.length > 0 || sitePlanRead)) {
    envelope = computeEnvelope(mergeSitePlanWidths(elevationReads, sitePlanRead));
    // A2: the page-2 ticks govern the envelope's lines too — an unticked
    // substrate (gutters not being done) never becomes a priced line.
    const envNodes = filterSurfacesByTicks(
      envelopeToAreaNodes(envelope, () => nextId++, facadeSourceId),
      tickedSurfaces,
    );
    if (envNodes.length) {
      merged.areas.push(...envNodes);
      // Specific deferrals replace the blanket "exterior envelope" one.
      merged.deferred = merged.deferred.filter((d) => d.what !== "exterior envelope");
    }
    for (const el of envelope.elevations) {
      for (const d of el.deferred) {
        merged.deferred.push({
          room: `Exterior - ${el.name}`, areaId: null, what: d.what, count: 1, needs: d.needs,
          ...(/width measurement required/i.test(d.needs) ? { kind: "exterior_width" } : {}),
        });
      }
    }
    // Segment-level site-check entries are covered above; the whole-house
    // verdict is a structured field, not a string prefix to sniff.
    if (envelope.wholeHouseCheck) {
      merged.deferred.push({ room: "Exterior", areaId: null, what: "site check", count: 1, needs: envelope.wholeHouseCheck });
    }
  }

  // Feature #2: an exterior/both job that measured NO exterior surfaces (no
  // facade photos, or a floorplan with no cladding read) still needs the
  // exterior scaffold — otherwise the estimator sees interior only. Lay out
  // the four elevations, unmeasured and flagged, to fill in.
  const hasExteriorNodes = merged.areas.some((a) => a.type === "Exterior");
  if (wantsExterior && !hasExteriorNodes) {
    const scaffold = starterExteriorNodes(() => nextId++, tickedSurfaces);
    merged.areas.push(...scaffold.areas);
    merged.deferred = merged.deferred.filter((d) => d.what !== "exterior envelope");
    merged.deferred.push(...scaffold.deferred);
  }

  // A2: ticked whole-job extras (deck, fence, pergola…) are never measured by
  // an elevation read — they always arrive as $0 placeholders to measure.
  if (wantsExterior) {
    const extras = exteriorExtrasNodes(() => nextId++, tickedSurfaces);
    merged.areas.push(...extras.areas);
    merged.deferred.push(...extras.deferred);
  }

  // R2: apply the exterior ANSWERS to the elevation nodes. Storeys give every
  // side its height; unmeasured sides take typical lengths (12 m front/back,
  // 14 m sides — the confirm-loop editor's L×H question settles them, tagged
  // assumed until then). Condition and access become review deferrals; a
  // stated fence length prices the fence line.
  if (wantsExterior && state.exterior) {
    const ext = state.exterior;
    const sideH = ext.storeys === "double" ? 5.2 : 2.6;
    for (const a of merged.areas) {
      if (a.type !== "Exterior" || a.areaType !== "surface") continue;
      if (!(Number(a.H) > 0)) {
        a.H = sideH;
        if (!a.assumedFields.includes("H")) a.assumedFields = [...a.assumedFields, "H"];
      }
      if (!(Number(a.L) > 0)) {
        a.L = /front|rear|back/i.test(a.name) ? 12 : 14;
        if (!a.assumedFields.includes("L")) a.assumedFields = [...a.assumedFields, "L"];
      }
    }
    if (ext.condition === "weathered") {
      merged.deferred.push({
        room: "Exterior", areaId: null, what: "weathered paintwork", count: 1,
        needs: "extra preparation allowed for — confirm the prep scope at review",
      });
    }
    if (ext.condition === "peeling") {
      merged.deferred.push({
        room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1,
        needs: "needs eyes on it before a fixed price — prep scope and (pre-1970) a lead-safe check on the visit",
      });
    }
    for (const acc of ext.access) {
      merged.deferred.push({
        room: "Exterior", areaId: null,
        what: acc === "steep" ? "steep block" : acc === "tight" ? "tight side access" : "double-height entry",
        count: 1, needs: "access affects setup time — allow for it at review",
      });
    }
    if (ext.extras.fence) {
      if (ext.extras.fenceMetres != null) {
        const priced = applyFenceLength(merged.areas as unknown as Parameters<typeof applyFenceLength>[0], ext.extras.fenceMetres);
        if (priced.ok) {
          merged.areas = priced.blocks as unknown as typeof merged.areas;
          merged.deferred = merged.deferred.filter((d) => !/fence/i.test(d.what));
        }
      } else {
        merged.deferred.push({
          room: "Exterior", areaId: null, what: "fence length", count: 1,
          needs: "customer isn't sure of the fence length — measure it on site",
        });
      }
    }
  }

  const builderState: Record<string, unknown> = {
    blocks: merged.areas,
    aiDeferred: merged.deferred,
    // A1: a picked Places address flows straight onto the estimate document
    // (the builder's Job Address card), in the builder's own shape.
    ...(state.address ? {
      jobAddress: {
        address: state.address.street,
        city: state.address.suburb,
        state: state.address.state,
        postal: state.address.postcode,
      },
    } : {}),
    // The full answers ride along: the editor's add-room re-applies them, and
    // the customer layer's range bands recompute from them. The EFFECTIVE
    // state is stored - if the server neutralised the damage-photo claim, the
    // snapshot must not resurrect it on a later add_room re-merge.
    wizard: { version: 1, state: effectiveState, submittedAt: new Date().toISOString() },
  };

  // ---- price and judge BEFORE anything is revealed -------------------------
  const ctx = await loadPricingContext(db);
  const payload = editorPayload(merged.areas, ctx, adjustmentsFrom(builderState), merged.deferred);

  const isCustomerMode = state.mode === "customer";
  const policy = policyFromSettings(settingValue(ctx.settings, "wizard_policy"));
  const bands = bandsFromSettings(settingValue(ctx.settings, "wizard_bands"));
  const serviceArea = serviceAreaFromSettings(settingValue(ctx.settings, "service_area"));
  const decision = evaluateGuardrails(
    answersFromState(state),
    payload.totals.totalCents,
    payload.accuracyPct,
    wantsExterior,
    policy,
    serviceArea,
  );

  // The proving-window baseline (Step 9): the wizard's ORIGINAL numbers,
  // frozen at submit. The /proving dashboard reprices the live estimate
  // later and measures how far staff corrected it — the gate's exit metric
  // (median staff correction < $150) can only exist if the starting point
  // is recorded now.
  (builderState.wizard as Record<string, unknown>).snapshot = {
    totalCents: payload.totals.totalCents,
    accuracyPct: payload.accuracyPct,
    marginCents: payload.totals.marginCents,
    contractorHours: payload.totals.contractorHours,
    areaCount: payload.rooms.length,
    deferredCount: payload.deferred.length,
    outcome: decision.outcome,
    walkthroughRequired: decision.walkthroughRequired,
    reasons: decision.reasons,
  };

  // Customer mode with a blocking outcome: the estimate is STILL created
  // (staff follow the lead up with the data in hand) but no price crosses
  // the wire — the guardrail response carries only the outcome.
  const title = isCustomerMode
    ? [state.customer?.suburb, state.customer?.postcode].filter(Boolean).join(" ") || "Customer enquiry"
    : state.title.trim() || "Wizard estimate";
  let sourceTag = isCustomerMode ? "customer_intake" : "wizard";
  const baseRow: Record<string, unknown> = {
    title, status: "draft", builder_state: builderState, source: sourceTag,
    ...(actor.kind === "customer" ? { created_by: user.id } : {}),
  };
  let insert = await db.from("estimates").insert(baseRow).select("id").single();
  // Match the CONSTRAINT NAME, not the word "source" - an unrelated error
  // mentioning a source column must not silently retag the estimate.
  if (insert.error && !isCustomerMode && /estimates_source_check/.test(insert.error.message)) {
    // Migration 20260915 (source check) hasn't run yet — degrade gracefully.
    sourceTag = state.noPlan ? "manual" : "ai_floorplan";
    warnings.push("Saved with the old source tag — run migration 20260915000000_wizard_source.sql to enable source=wizard.");
    insert = await db.from("estimates").insert({ ...baseRow, source: sourceTag }).select("id").single();
  }
  if (insert.error || !insert.data) {
    reportError(insert.error, { where: "wizard.submit.insert" });
    return NextResponse.json({ error: `Couldn't create the estimate: ${insert.error?.message}` }, { status: 500 });
  }
  const estimateId = insert.data.id as string;

  // The lead row — every real customer attempt, whatever the outcome.
  if (actor.kind === "customer") {
    const leadOutcome = decision.outcome === "reveal"
      ? (decision.walkthroughRequired ? "walkthrough_only" : "revealed")
      : decision.outcome === "outside_area" ? "outside_area"
      : decision.outcome === "below_floor" ? "below_floor"
      : decision.outcome; // handoff | hard_stop
    await db.from("wizard_leads").insert({
      user_id: user.id, estimate_id: estimateId, email, ip_hash: ipHash,
      suburb: state.customer?.suburb ?? null, postcode: state.customer?.postcode ?? null,
      job_type: state.jobType, outcome: leadOutcome, reasons: decision.reasons,
    }).then((r) => { if (r.error) reportError(r.error, { where: "wizard.leads.insert", bestEffort: true }); });
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
      ? db.from("extraction_runs").update({ status: "applied" }).in("id", appliedRunIds)
      : Promise.resolve(),
    sourceIds.length || facadeSourceIds.length
      // Belt and braces: the ownership check above plus is-null here, so a
      // concurrent claim can't repoint another estimate's plan.
      ? db.from("estimate_sources").update({ estimate_id: estimateId })
          .in("id", [...sourceIds, ...facadeSourceIds]).is("estimate_id", null)
      : Promise.resolve(),
    // A7: damage/property photos ride under runs/{runId}/photos/ — claim them
    // too, so the evidence cascades with the estimate instead of orphaning.
    ...appliedRunIds.map((rid) =>
      db.from("estimate_sources").update({ estimate_id: estimateId })
        .like("storage_path", `runs/${rid}/photos/%`).is("estimate_id", null)
        .then(() => undefined, () => undefined),
    ),
    // Best-effort until migration 20260913/14 has run everywhere.
    storeyHeights
      ? db.from("estimates").update({ storey_heights: storeyHeights }).eq("id", estimateId)
          .then(() => undefined, () => undefined)
      : Promise.resolve(),
    // Every AI-drafted exterior carries requires_site_check until a human
    // clears it deliberately (migration 20260910's rule). Needs the column
    // grant from migration 20260917 on the staff path - report a refusal
    // loudly rather than letting the safety flag silently stay false.
    wantsExterior
      ? db.from("estimates").update({ requires_site_check: true }).eq("id", estimateId)
          .then((r) => { if (r.error) reportError(r.error, { where: "wizard.submit.requiresSiteCheck", bestEffort: true, extra: { estimateId } }); })
      : Promise.resolve(),
    // The reconciled envelope row — what was measured, from what, at what
    // confidence — for the cross-check UI and the E2 scorer. Best-effort.
    envelope
      ? db.from("exterior_envelopes").upsert({
          estimate_id: estimateId,
          footprint_source: "floorplan",
          perimeter_m: sitePlanRead?.perimeterM ?? null,
          perimeter_origin: sitePlanRead ? "site_plan" : null,
          perimeter_confidence: sitePlanRead?.confidence ?? null,
          storeys: sitePlanRead?.storeys ?? null,
          wall_height_m: envelope.elevations.reduce<number | null>(
            (max, e) => (e.heightM != null && (max == null || e.heightM > max) ? e.heightM : max), null),
          wall_height_methods: {
            elevations: envelope.elevations.map((e) => ({
              name: e.name, widthM: e.widthM, heightM: e.heightM,
              surfaces: e.surfaces.length, deferred: e.deferred.length,
            })),
            requiresSiteCheck: envelope.requiresSiteCheck,
          },
        }, { onConflict: "estimate_id" }).then(() => undefined, () => undefined)
      : Promise.resolve(),
  ]);

  // ---- guardrail outcomes: no price crosses the wire -----------------------
  if (isCustomerMode && decision.outcome !== "reveal") {
    return NextResponse.json({
      outcome: decision.outcome,
      message: GUARDRAIL_MESSAGES[decision.outcome] ?? GUARDRAIL_MESSAGES.handoff,
    });
  }

  // The pinned plan, through a short-lived signed URL (private bucket).
  // Exterior-only jobs pin the first facade photo instead.
  let planUrl: string | null = null;
  const pinPath = planSourcePath ?? facadeSourcePath;
  if (pinPath) {
    const { data: signed } = await db.storage.from("estimate-sources").createSignedUrl(pinPath, 3600);
    planUrl = signed?.signedUrl ?? null;
  }

  if (isCustomerMode) {
    // The customer's view: a range, inclusions, confidence — and nothing else.
    return NextResponse.json({
      estimateId,
      planUrl,
      ...customerPayload(payload, merged.areas, decision, bands),
    });
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
