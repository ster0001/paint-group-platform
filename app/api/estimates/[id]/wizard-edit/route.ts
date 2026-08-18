import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildDraft } from "@/lib/extract/draft";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { applyWizardAnswers } from "@/lib/wizard/merge";
import { wizardStateSchema } from "@/lib/wizard/state";
import { markStarterProvenance, starterExtraction, type TypicalSizeRow } from "@/lib/wizard/starter";
import { editorPayload, type WizardDeferred } from "@/lib/wizard/view";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, status, builder_state")
    .eq("id", id)
    .maybeSingle();
  if (!estimate) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  if (estimate.status === "accepted") {
    return NextResponse.json({ error: "This estimate is accepted and locked." }, { status: 409 });
  }

  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  let blocks: LooseBlock[] = Array.isArray(state.blocks) ? (state.blocks as LooseBlock[]) : [];
  const deferred: WizardDeferred[] = Array.isArray(state.aiDeferred) ? (state.aiDeferred as WizardDeferred[]) : [];
  let storeyHeights: Record<string, number> | null = null;

  if (act.action === "confirm_height") {
    blocks = blocks.map((b) => {
      if (b.kind !== "area") return b;
      const assumed = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : []).filter((f) => f !== "H");
      return { ...b, H: act.heightM, assumedFields: assumed };
    });
    storeyHeights = { ground: act.heightM };
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
    b.origin = "human_confirmed";
    b.confidence = 1;
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
      supabase.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
      supabase.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
      supabase.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
    ]);
    const rules = (rulesRows ?? []) as ScopeRule[];
    const typicals = (typicalRows ?? []) as TypicalSizeRow[];
    if (!rules.some((r) => r.room_type === act.roomType)) {
      return NextResponse.json({ error: `No scope rules exist for a "${act.roomType}".` }, { status: 422 });
    }

    const existingNames = new Set(blocks.map((b) => String(b.name ?? "")));
    let name = act.name?.trim() || act.roomType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    for (let n = 2; existingNames.has(name); n++) name = `${act.name?.trim() || name.replace(/ \d+$/, "")} ${n}`;

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
    deferred.push(...mergedRoom.deferred.filter((d) => d.room === name));
  }

  if (act.action === "remove_room") {
    const before = blocks.length;
    blocks = blocks.filter((b) => !(b.kind === "area" && Number(b.id) === act.areaId));
    if (blocks.length === before) return NextResponse.json({ error: "No such room." }, { status: 404 });
  }

  const newState = { ...state, blocks, aiDeferred: deferred };
  const { error: writeError } = await supabase
    .from("estimates")
    .update({ builder_state: newState })
    .eq("id", id);
  if (writeError) {
    reportError(writeError, { where: "wizard.edit.update", extra: { id, action: act.action } });
    return NextResponse.json({ error: `Couldn't save the change: ${writeError.message}` }, { status: 500 });
  }
  if (storeyHeights) {
    await supabase.from("estimates").update({ storey_heights: storeyHeights }).eq("id", id)
      .then(() => undefined, () => undefined);
  }

  const ctx = await loadPricingContext(supabase);
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(newState), deferred);
  return NextResponse.json(payload);
}
