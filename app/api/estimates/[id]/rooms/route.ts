import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { draftToAreaNode, type RoomDraft } from "@/lib/capture/commit";
import { expandCaptureTiles, tilesForRoomType, type TileRule } from "@/lib/capture/presets";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import {
  priceArea,
  priceEstimateTotals,
  type AreaInput,
  type BlockInput,
} from "@/lib/pricing/estimate";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/estimates/:id/rooms - capture mode's batched room commit.
 *
 * One call per room (brief section 7: one batched upsert, not one per
 * surface). THE BOUNDARY RULE, same as the plan reader's apply route: the
 * body carries geometry, tile selections and counts - never a price, a rate
 * or a quantity computed client-side. The area node is built HERE from the
 * same rules table the tile grid rendered from, and repriced HERE so the
 * response's totals are the server's own arithmetic.
 *
 * Two sanctioned, BOUNDED hour inputs are the exception, both deliberate
 * staff decisions rather than client arithmetic: the manual prep stepper
 * (0-100 h) and the per-tile hours override (0-200 h, the review screen's
 * "the rate is wrong for this one" escape hatch). Everything else about an
 * hour or a dollar is derived server-side.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const roomSchema = z.object({
  localId: z.string().min(1).max(64),
  areaId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(120),
  roomType: z.string().min(1).max(60),
  storey: z.string().min(1).max(40),
  lengthM: z.number().min(0).max(60),
  widthM: z.number().min(0).max(60),
  heightM: z.number().min(0).max(8),
  heightInherited: z.boolean().default(true),
  extraWallSegmentsM: z.array(z.number().min(0).max(60)).max(12).default([]),
  perimeterOverrideM: z.number().min(0).max(400).nullable().default(null),
  selections: z.record(z.string(), z.number().int().min(0).max(99)).default({}),
  exclusions: z.array(z.string()).max(40).default([]),
  prepHours: z.record(z.string(), z.number().min(0).max(100)).default({}),
  coats: z.record(z.string(), z.number().int().min(1).max(4)).default({}),
  crewNotes: z.record(z.string(), z.string().max(2000)).default({}),
  // The tile's TOTAL hours as shown on the review screen; the commit
  // subtracts the manual prep back out (see lib/capture/commit.ts). 200 h
  // comfortably exceeds any real single surface.
  hoursOverride: z.record(z.string(), z.number().min(0).max(200)).default({}),
  labels: z.record(z.string(), z.string().max(80)).default({}),
  extraTiles: z.array(z.object({ id: z.string().max(80), from: z.string().max(80) })).max(30).default([]),
  // Observations only - severity and affected quantity. The HOURS come from
  // defect_prep_rates server-side; a client cannot post its own prep time
  // beyond the bounded manual stepper above.
  defects: z.record(
    z.string(),
    z.array(z.object({
      type: z.string().min(1).max(60),
      severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      qty: z.number().min(0).max(500),
    })).max(12),
  ).default({}),
});

const bodySchema = z.object({
  room: roomSchema,
  /** Estimate-level storey heights, persisted on first entry / when edited. */
  storeyHeights: z.record(z.string().max(40), z.number().min(1.8).max(8)).optional(),
  exterior: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Bad estimate id." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

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

  // The tile list is rebuilt server-side from the rules table - a client
  // cannot invent a tile that maps to a rate code the rules don't offer.
  const [{ data: rulesRows }, { data: defectRatesRows }] = await Promise.all([
    supabase.from("room_type_scope_rules").select("*").eq("version", SCOPE_VERSION),
    supabase.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
  ]);
  const rules = (rulesRows ?? []) as TileRule[];
  const room = parsed.data.room as RoomDraft & { status?: "capturing" | "complete" };
  const tiles = expandCaptureTiles(tilesForRoomType(room.roomType, rules));
  if (tiles.length === 0) {
    return NextResponse.json({ error: `No scope rules exist for a "${room.roomType}".` }, { status: 422 });
  }

  // Duplicated substrates may only CLONE a real tile, and every id must be
  // unique — a clone id colliding with a base tile (or another clone) would
  // emit the same priced surface twice and double-charge the room.
  const baseIds = new Set(tiles.map((t) => t.id));
  const cloneIds = new Set<string>();
  for (const x of room.extraTiles ?? []) {
    if (!baseIds.has(x.from)) {
      return NextResponse.json({ error: `Unknown base tile "${x.from}" for a duplicated substrate.` }, { status: 422 });
    }
    if (baseIds.has(x.id) || cloneIds.has(x.id)) {
      return NextResponse.json({ error: "Duplicated substrates must have unique ids." }, { status: 400 });
    }
    cloneIds.add(x.id);
  }

  const state = (estimate.builder_state ?? {}) as { blocks?: Array<Record<string, unknown>> } & Record<string, unknown>;
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];

  // Builder id allocation: everything above the current max, exactly like the
  // builder's own nextId derivation (QuoteBuilder recomputes from loaded ids).
  const usedIds = blocks.flatMap((b) => [
    Number(b.id) || 0,
    ...(Array.isArray(b.surfaces) ? (b.surfaces as Array<{ id?: number }>).map((s) => Number(s.id) || 0) : []),
  ]);
  let next = Math.max(0, ...usedIds) + 1;

  const draft: RoomDraft = { ...room, status: "complete", areaId: room.areaId ?? null };
  const node = draftToAreaNode(draft, tiles, () => next++, {
    exterior: parsed.data.exterior,
    defectRates: (defectRatesRows ?? []) as import("@/lib/capture/commit").DefectRate[],
  });

  const existingIdx = draft.areaId != null ? blocks.findIndex((b) => Number(b.id) === draft.areaId) : -1;
  const newBlocks = existingIdx >= 0
    ? blocks.map((b, i) => (i === existingIdx ? (node as unknown as Record<string, unknown>) : b))
    : [...blocks, node as unknown as Record<string, unknown>];

  const newState = { ...state, blocks: newBlocks };

  const { error: writeError } = await supabase
    .from("estimates")
    .update({ builder_state: newState })
    .eq("id", id);
  if (writeError) {
    reportError(writeError, { where: "capture.rooms.update", extra: { id } });
    return NextResponse.json({ error: `Couldn't save the room: ${writeError.message}` }, { status: 500 });
  }

  if (parsed.data.storeyHeights) {
    // Best-effort until migration 20260913 has run everywhere.
    await supabase.from("estimates").update({ storey_heights: parsed.data.storeyHeights }).eq("id", id)
      .then(() => undefined, () => undefined);
  }

  // ---- reprice server-side so the live total bar shows OUR arithmetic -------
  const ctx = await loadPricingContext(supabase);
  const adj = adjustmentsFrom(state);

  const areaPriceCents = priceArea(node as unknown as AreaInput, ctx, adj);
  const totals = priceEstimateTotals(newBlocks as unknown as BlockInput[], ctx, adj);

  return NextResponse.json({
    areaId: node.id,
    surfaces: node.surfaces.length,
    areaPriceCents,
    totals: {
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      contractorHours: Math.round(totals.contractorHours * 100) / 100,
      marginCents: totals.marginCents,
    },
  });
}
