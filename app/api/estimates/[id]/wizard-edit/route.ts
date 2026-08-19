import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraft } from "@/lib/extract/draft";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { applyWizardAnswers } from "@/lib/wizard/merge";
import { wizardStateSchema } from "@/lib/wizard/state";
import { markStarterProvenance, starterExtraction, type TypicalSizeRow } from "@/lib/wizard/starter";
import { customerPayload, editorPayload, type WizardDeferred } from "@/lib/wizard/view";
import {
  GUARDRAIL_MESSAGES, answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/estimates/:id/wizard-edit — the W3 editor's one-tap mutations.
 *
 * Every edit lands here and is applied to builder_state SERVER-SIDE, then the
 * whole estimate is repriced and rescored in the same request — the editor
 * never mutates the tree or computes a number itself. Deeper surgery (surface
 * quantities, overrides) belongs to the builder and capture, which already
 * own those flows.
 *
 *   confirm_height  — the one-tap that matters most (Step 6: height, not
 *                     plan-reading, is the walls error). Sets H everywhere,
 *                     clears the H assumption, persists storey_heights.
 *   confirm_room    — a human says this room's size is right (or supplies
 *                     it for an unmeasured room). Origin → human_confirmed.
 *   add_room        — priced from the room type's typical size, tagged
 *                     ai_assumed, with the stored wizard answers re-applied
 *                     so ticks, coats and styles hold for new rooms too.
 *   remove_room     — deletes the block.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_height"), heightM: z.number().min(2).max(6) }),
  z.object({
    action: z.literal("confirm_room"),
    areaId: z.number().int().positive(),
    lengthM: z.number().min(0.5).max(60).optional(),
    widthM: z.number().min(0.5).max(60).optional(),
  }),
  z.object({
    action: z.literal("add_room"),
    roomType: z.string().min(1).max(60),
    name: z.string().min(1).max(120).optional(),
  }),
  z.object({ action: z.literal("remove_room"), areaId: z.number().int().positive() }),
  /** "I've checked the plan-derived exterior widths" — clears the rule-2
   * flag on every Exterior node (Tom's ruling: derived widths are always
   * flagged until a human confirms them). */
  z.object({ action: z.literal("confirm_exterior_widths") }),
]);

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; surfaces?: Array<Record<string, unknown>>;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Bad estimate id." }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const act = parsed.data;

  const supabase = await createClient();
  // Staff edit anything; a customer edits ONLY the draft they created
  // through the wizard, via the service client with an ownership check.
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  // A4: the pricing context (rate card, products, modifiers, settings) never
  // depends on the mutation — load it in parallel with everything below
  // instead of serially after the write. Measured ~200ms off every action.
  const ctxPromise = loadPricingContext(db);

  const { data: estimate } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state")
    .eq("id", id)
    .maybeSingle();
  if (!estimate) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  if (actor.kind === "customer") {
    const own = (estimate as { created_by?: string | null }).created_by === actor.user.id
      && (estimate as { source?: string }).source === "customer_intake"
      && estimate.status === "draft";
    // 404, not 403 - existence is never confirmed to guessers.
    if (!own) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  }
  if (estimate.status === "accepted") {
    return NextResponse.json({ error: "This estimate is accepted and locked." }, { status: 409 });
  }

  /** What a confirmation by THIS actor means: staff settle a value; a
   * customer states it - always cross-checked before send. */
  const stampOrigin = actor.kind === "customer" ? "customer_stated" : "human_confirmed";
  const stampConfidence = actor.kind === "customer" ? 0.85 : 1;

  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  let blocks: LooseBlock[] = Array.isArray(state.blocks) ? (state.blocks as LooseBlock[]) : [];
  const deferred: WizardDeferred[] = Array.isArray(state.aiDeferred) ? (state.aiDeferred as WizardDeferred[]) : [];
  let storeyHeights: Record<string, number> | null = null;

  if (act.action === "confirm_height") {
    // A CEILING height applies to interior rooms only - Exterior elevation
    // nodes carry a MEASURED facade height in H (envelopeToAreaNodes), which
    // a ceiling confirmation must never overwrite.
    const isInteriorRoom = (b: LooseBlock) => b.kind === "area" && b.type !== "Exterior" && b.areaType !== "surface";
    blocks = blocks.map((b) => {
      if (!isInteriorRoom(b)) return b;
      const prior = Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [];
      const cleared = prior.filter((f) => f !== "H");
      // A customer's height claim is a statement, not a settlement - marked so
      // the review queue cross-checks the one input Step 6 proved is THE walls
      // error. Staff confirmation clears it clean.
      const stamped = actor.kind === "customer" && prior.includes("H")
        ? [...cleared, "height_customer_stated"]
        : cleared;
      return { ...b, H: act.heightM, assumedFields: stamped };
    });
    // One confirmed height across every INTERIOR storey the tree has (Tom's
    // rule); per-floor differences are capture's job.
    const storeys = [...new Set(
      blocks.filter(isInteriorRoom).map((b) => (typeof b.storey === "string" && b.storey ? b.storey : "ground")),
    )];
    storeyHeights = Object.fromEntries((storeys.length ? storeys : ["ground"]).map((s) => [s, act.heightM]));
  }

  if (act.action === "confirm_room") {
    const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === act.areaId);
    if (idx < 0) return NextResponse.json({ error: "No such room." }, { status: 404 });
    const b = { ...blocks[idx] };
    if (act.lengthM != null) b.L = act.lengthM;
    if (act.widthM != null) b.W = act.widthM;
    if (!Number(b.L) || !Number(b.W)) {
      return NextResponse.json({ error: "This room has no size yet — enter its length and width to confirm it." }, { status: 400 });
    }
    b.origin = stampOrigin;
    b.confidence = stampConfidence;
    b.assumedFields = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [])
      .filter((f) => f !== "L" && f !== "W");
    b.surfaces = (b.surfaces ?? []).map((s) => ({
      ...s,
      assumedFields: (Array.isArray(s.assumedFields) ? (s.assumedFields as string[]) : []).filter((f) => f !== "quantity"),
    }));
    blocks = blocks.map((x, i) => (i === idx ? b : x));
  }

  if (act.action === "add_room") {
    const [{ data: rulesRows }, { data: aliasRows }, { data: typicalRows }] = await Promise.all([
      db.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
      db.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
      db.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
    ]);
    const rules = (rulesRows ?? []) as ScopeRule[];
    const typicals = (typicalRows ?? []) as TypicalSizeRow[];
    if (!rules.some((r) => r.room_type === act.roomType)) {
      return NextResponse.json({ error: `No scope rules exist for a "${act.roomType}".` }, { status: 422 });
    }

    // Case-insensitive, like capture's own nextName() — "bedroom" typed on
    // site must collide with "Bedroom".
    const existingNames = new Set(blocks.map((b) => String(b.name ?? "").trim().toLowerCase()));
    let name = act.name?.trim() || act.roomType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    for (let n = 2; existingNames.has(name.trim().toLowerCase()); n++) {
      name = `${(act.name?.trim() || name).replace(/ \d+$/, "")} ${n}`;
    }

    // New rooms inherit the job's height from the tree itself.
    const groundH = blocks.find((b) => b.kind === "area" && Number(b.H) > 0)?.H;
    const heightM = typeof groundH === "number" && groundH > 0 ? groundH : null;

    let next = Math.max(0, ...blocks.flatMap((b) => [
      Number(b.id) || 0,
      ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
    ])) + 1;

    const x = starterExtraction(
      [{ name, roomType: act.roomType, storey: "Ground" }],
      typicals,
      { heightM, bedrooms: 0 },
    );
    const draft = buildDraft(x, rules, (aliasRows ?? []) as Alias[], { startId: next });
    markStarterProvenance(draft.areas);
    next = Math.max(next, ...draft.areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)])) + 1;

    // Re-apply the stored wizard answers so the new room follows the job's
    // ticks, coats and door/window styles. A non-wizard estimate (no
    // snapshot) just takes the draft as-is.
    const snapshot = (state.wizard as { state?: unknown } | undefined)?.state;
    const parsedSnap = wizardStateSchema.safeParse(snapshot);
    const roomDraft = { areas: draft.areas, skipped: draft.skipped, assumedCount: draft.assumedCount, deferred: draft.deferred };
    const mergedRoom = parsedSnap.success
      ? applyWizardAnswers(roomDraft, parsedSnap.data, () => next++)
      : roomDraft;
    if (mergedRoom.areas.length === 0) {
      return NextResponse.json({ error: "Nothing is selected for that room type on this job." }, { status: 422 });
    }

    blocks = [...blocks, ...(mergedRoom.areas as unknown as LooseBlock[])];
    // Only the questions raised by the rooms just added — matched by id, so
    // a name shared with an existing room can't cross-attach.
    const addedIds = new Set(mergedRoom.areas.map((a) => a.id));
    deferred.push(...mergedRoom.deferred.filter((d) => d.areaId != null && addedIds.has(d.areaId)));
  }

  if (act.action === "confirm_exterior_widths") {
    blocks = blocks.map((b) => {
      const assumed = Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [];
      if (b.kind !== "area" || !assumed.includes("width_from_plan")) return b;
      return {
        ...b,
        origin: stampOrigin,
        confidence: stampConfidence,
        // A customer's check softens the flag; staff still see it in review.
        assumedFields: actor.kind === "customer"
          ? [...assumed.filter((f) => f !== "width_from_plan"), "width_customer_checked"]
          : assumed.filter((f) => f !== "width_from_plan"),
      };
    });
  }

  let newDeferred = deferred;
  if (act.action === "remove_room") {
    const before = blocks.length;
    // The last room can't be removed - an empty tree prices at $0, and the
    // customer path would render a straight-faced $0-$0 range.
    if (blocks.filter((b) => b.kind === "area").length <= 1) {
      return NextResponse.json({ error: "That's the last room — an estimate needs at least one. Start again if this job is different." }, { status: 400 });
    }
    blocks = blocks.filter((b) => !(b.kind === "area" && Number(b.id) === act.areaId));
    if (blocks.length === before) return NextResponse.json({ error: "No such room." }, { status: 404 });
    // The room's open questions leave with it — otherwise they haunt the
    // review list and dock the accuracy score for a room that no longer
    // exists. Whole-job entries (areaId null) stay.
    newDeferred = deferred.filter((d) => d.areaId == null || d.areaId !== act.areaId);
  }

  const newState = { ...state, blocks, aiDeferred: newDeferred };
  const { error: writeError } = await db
    .from("estimates")
    .update({ builder_state: newState })
    .eq("id", id);
  if (writeError) {
    reportError(writeError, { where: "wizard.edit.update", extra: { id, action: act.action } });
    return NextResponse.json({ error: `Couldn't save the change: ${writeError.message}` }, { status: 500 });
  }
  if (storeyHeights) {
    await db.from("estimates").update({ storey_heights: storeyHeights }).eq("id", id)
      .then(() => undefined, () => undefined);
  }

  const ctx = await ctxPromise;
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(newState), newDeferred);

  if (actor.kind === "customer") {
    // The customer's view recomputes the range and the acceptance verdict —
    // their confirmations tighten the band but never bypass the guardrails.
    const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
    const answers = snap.success
      ? answersFromState(snap.data)
      : answersFromState({ jobType: "interior", details: { damageTier: 1 }, customer: null });
    const decision = evaluateGuardrails(
      answers,
      payload.totals.totalCents,
      payload.accuracyPct,
      (estimate as { requires_site_check?: boolean | null }).requires_site_check === true,
      policyFromSettings(settingValue(ctx.settings, "wizard_policy")),
      serviceAreaFromSettings(settingValue(ctx.settings, "service_area")),
    );
    // Same rule as submit: a blocking outcome means NO price crosses the
    // wire - edits can move a job across a guardrail (e.g. under the floor)
    // and the edit path must honour that, not keep revealing the range.
    if (decision.outcome !== "reveal") {
      return NextResponse.json({
        outcome: decision.outcome,
        message: GUARDRAIL_MESSAGES[decision.outcome] ?? GUARDRAIL_MESSAGES.handoff,
      });
    }
    return NextResponse.json(
      customerPayload(payload, blocks, decision, bandsFromSettings(settingValue(ctx.settings, "wizard_bands"))),
    );
  }

  return NextResponse.json(payload);
}
