import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { draftToAreaNode, type RoomDraft } from "@/lib/capture/commit";
import { expandCaptureTiles, tilesForRoomType, type TileRule } from "@/lib/capture/presets";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import {
  priceArea,
  priceEstimateTotals,
  type Adjustments,
  type AreaInput,
  type BlockInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/estimates/:id/rooms - capture mode's batched room commit.
 *
 * One call per room (brief section 7: one batched upsert, not one per
 * surface). THE BOUNDARY RULE, same as the plan reader's apply route: the
 * body carries geometry, tile selections and counts - never a price, an hour
 * rate or a quantity computed client-side. The area node is built HERE from
 * the same rules table the tile grid rendered from, and repriced HERE so the
 * response's totals are the server's own arithmetic.
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
  const { data: rulesRows } = await supabase
    .from("room_type_scope_rules")
    .select("*")
    .eq("version", SCOPE_VERSION);
  const rules = (rulesRows ?? []) as TileRule[];
  const room = parsed.data.room as RoomDraft & { status?: "capturing" | "complete" };
  const tiles = expandCaptureTiles(tilesForRoomType(room.roomType, rules));
  if (tiles.length === 0) {
    return NextResponse.json({ error: `No scope rules exist for a "${room.roomType}".` }, { status: 422 });
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
  const node = draftToAreaNode(draft, tiles, () => next++, { exterior: parsed.data.exterior });

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
  const [rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as PricingContext["rateItems"],
    products: (productsRes.data ?? []) as PricingContext["products"],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  const adj: Adjustments = {
    modSel: (state.modSel as Record<string, string>) ?? {},
    materials: (state.materials as Record<string, string>) ?? {},
    discountPct: (state.discountPct as number) ?? 0,
    discountMode: (state.discountMode as "pct" | "fixed") ?? "pct",
    discountFixedCents: (state.discountFixedCents as number) ?? 0,
    hourlyRateOverride: (state.hourlyRateOverride as number | null) ?? null,
    contractorRateOverride: (state.contractorRateOverride as number | null) ?? null,
  };

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
