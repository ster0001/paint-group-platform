import { NextResponse } from "next/server";
import { logCrmEvent } from "@/lib/crm/events";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { ensureAccount } from "@/lib/accounts/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraft } from "@/lib/extract/draft";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "@/lib/extract/scope";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { PAINT_SYSTEMS_KEY, paintSystemsFrom } from "@/lib/pricing/systems";
import { applyPaintSystems, applySystemPatch, paintSystemsView, type SystemPatch } from "@/lib/wizard/systems-view";
import { applyRoomExtra, roomExtrasView } from "@/lib/wizard/room-extras";
import { SPOT_EXTENT_QTY_KEY, extentQtyFrom, roomConditionDeferred, spotLine } from "@/lib/wizard/spots";
import { makeDraftSurface } from "@/lib/extract/draft";
import {
  SITE_ACCESS_HOURS_KEY, STAGING_GROUP, applySiteAccess, hourAllowancesFrom,
} from "@/lib/wizard/site-access";
import { extraNoteDeferral } from "@/lib/wizard/extras";
import type { DefectRate } from "@/lib/capture/commit";
import { applyWizardAnswers } from "@/lib/wizard/merge";
import { WIZARD_SURFACE_KEYS, wizardStateSchema } from "@/lib/wizard/state";
import { applyDoorStyle, applyWindowStyle, DOOR_STYLE_DEFERRAL, WINDOW_STYLE_DEFERRAL } from "@/lib/wizard/styles";
import { reconcileRoomAllowances, type AllowanceBlock } from "@/lib/wizard/allowances";
import { markStarterProvenance, starterExtraction, type TypicalSizeRow, FENCE_CODE, FENCE_TYPE_LABEL } from "@/lib/wizard/starter";
import {
  applyCount, applyDoorScope, applyExtent, applyExteriorToggle, applyFenceLength, applyRename, applyToggle, applyWallsShare,
  customerExteriorView, customerScopeRooms, FREESTANDING_EXTRA_KEYS, hasFreestandingExtras, applyFenceType } from "@/lib/wizard/scope-editor";
import { bookWizardSlot, wizardVisitSlots } from "@/lib/visits/wizard";
import { ladderFor, mayFixOnline, requiresSiteCheck } from "@/lib/wizard/ladder";
import { deskCheckPack } from "@/lib/wizard/desk-check";
import { confirmationDraft } from "@/lib/wizard/confirmation";
import { INTERIOR_POOR_MODIFIER_CODE } from "@/lib/wizard/exteriorAnswers";
import {
  ALLOWANCE_CODES, SWEEP_PRICED_CODES, WEATHERED_MODIFIER_CODE,
  addCatalogItem, addSideCustom, addSideSurface, addWallSurface, addWindowGroup, applySideCount, applySideDims,
  applySideInclude, applySideMetres, applySideNote, applySideRename, applySideSizeOk, applyWallShare, applyWindowSize, confirmSide, defaultSidesLoop,
  extrasPrices, findSide, hasExtrasItem, linealCodes, rateFor, removeSideCustom, removeSideLine, sidesView, toggleExtrasItem,
  wallOptionsFromRates,
  type SidesLoopMeta, hoursPerItemCodes } from "@/lib/wizard/sides";
import {
  CUPBOARD_BY_ROOM_TYPE, addCatalogueLine, addRoomCustom, addRoomWindowGroup, applyCupboard, applyCupboardInterior, applyCupboardDoorInside, applyCupboardsEverywhere,
  applyLineCount, applyRoomDims, applyRoomSizeOk, applyRoomWindowSize, confirmRoom,
  defaultInteriorLoop, interiorDwTotals, interiorProgress, removeLine, roomLoopViews,
  type InteriorLoopMeta,
} from "@/lib/wizard/rooms-loop";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { loadScopeRules } from "@/lib/extract/scope-cache";
import { exteriorAddOptions, interiorAddOptions, perItemChargeOut } from "@/lib/wizard/add-catalogue";
import { customerPayload, editorPayload, type WizardDeferred } from "@/lib/wizard/view";
import {
  GUARDRAIL_MESSAGES, answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
  type GuardrailDecision,
} from "@/lib/wizard/policy";
import { holdDaysFromSettings, holdUntil, priceToFix } from "@/lib/wizard/confirmation-actions";
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

/**
 * Pair a paint-system field with its value, or refuse.
 *
 * The posted shape is deliberately flat (see the schema), so this is where a
 * boolean sent for `glossTrims` — or "bold" sent for `ceilingsMarked` —
 * becomes a 400 rather than a silently dropped answer. Returning null beats
 * coercing: a customer who taps a chip and sees nothing move has been lied to.
 */
function systemPatchFrom(
  field: string,
  value: unknown,
  group?: string,
  flag?: string,
  areaId?: number,
): SystemPatch | null {
  /**
   * CEILINGS — all of them, some rooms, or none (Tom, 11 Sep). The scope and the
   * room list are two actions on purpose: a room tap must not have to resend the
   * whole list, and the scope chip must not have to know which rooms exist.
   */
  if (field === "darkToLightCeilings") {
    return value === "all" || value === "some" || value === null
      ? { field: "darkToLightCeilings", value }
      : null;
  }
  if (field === "darkToLightCeilingRoom") {
    if (typeof areaId !== "number" || !Number.isInteger(areaId) || areaId <= 0) return null;
    if (typeof value !== "boolean") return null;
    return { field: "darkToLightCeilingRoom", areaId, value };
  }
  if (field === "surfaceFlag") {
    // The flag KEY is not checked against the catalogue here on purpose: Tom
    // can add or rename one in Settings without a deploy, and a key that no
    // longer exists simply stops applying at derivation time rather than
    // 400-ing a customer who is looking at a stale page.
    const groups = ["walls", "ceilings", "trims", "doors", "windows"] as const;
    const g = groups.find((x) => x === group);
    if (g == null || typeof value !== "boolean") return null;
    if (typeof flag !== "string" || flag.length === 0 || flag.length > 40) return null;
    return { field: "surfaceFlag", group: g, flag, value };
  }
  if (field === "darkToLight") {
    // Which surfaces are going dark → light, and therefore take three coats.
    // Validated against the substrate registry, unlike a Settings-owned flag
    // key: this one drives COATS, and an unknown key must not slip through and
    // silently price nothing.
    const key = WIZARD_SURFACE_KEYS.find((k) => k === group);
    if (key == null || typeof value !== "boolean") return null;
    return { field: "darkToLight", key, value };
  }
  if (field === "colourIntent") {
    return value === "same" || value === "new" || value === "bold" ? { field, value } : null;
  }
  if (field === "glossTrims") {
    return value === "yes" || value === "no" || value === "unsure" ? { field, value } : null;
  }
  if (field === "ceilingsMarked" || field === "ceilingsChangingColour") {
    return typeof value === "boolean" ? { field, value } : null;
  }
  return null;
}

/** A rate code as a customer reads it — the add panel's own prettifier rule. */
function prettifyExtra(code: string): string {
  return code.replace(/\s*\(1 Side\)/i, "").trim();
}

/** The whole-job block the site-access hour allowances live on. */
function isSiteAccessBlock(b: { kind?: string; name?: string }): boolean {
  return b.kind === "area" && String(b.name ?? "").toLowerCase() === "site access";
}

/** The `what` shape site-and-access notes use, so re-answering clears them. */
const SITE_ACCESS_DEFERRAL = /^(cleared|floors|stairwell|parking|lift|furniture stays|rooms cleared)\b/;

/** One site-access answer, narrowed. Null for a value that field can't take. */
function siteAccessValue(field: string, value: string): string | null {
  const allowed: Record<string, string[]> = {
    cleared: ["yes", "some", "no"],
    floors: ["carpet", "hard", "mixed"],
    stairwell: ["yes", "no"],
    parking: ["drive", "street", "hard"],
    lift: ["yes", "no"],
    pets: ["yes", "no"],
  };
  return allowed[field]?.includes(value) ? value : null;
}

/** The customer-facing name of a spot line, for clearing its amber note. */
function spotLabelFor(surface: Record<string, unknown>): string {
  return String(surface.internalLabel ?? "").replace(/^Repair — /, "").replace(/ \(to price\)$/, "");
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_height"), heightM: z.number().min(2).max(6) }),
  /** Phase 2 (6 Sep plan): the door / window style left "Not sure" in the
   * wizard is answerable in the editor — every assumed-style line swaps to
   * the answered rate; the amber flag clears. */
  z.object({ action: z.literal("set_door_style"), style: z.enum(["flat", "panel"]) }),
  z.object({ action: z.literal("set_window_style"), style: z.enum(["casement", "sash", "colonial", "winder"]) }),
  /**
   * Phase 4 (estimator journey v2 §4.2): a correction on the paint-systems
   * card. The customer never posts coats — they post the ANSWER, and the
   * server re-derives every interior surface from Tom's Settings table. That
   * is the same boundary the rest of this route keeps: answers in, never
   * geometry or money.
   */
  /**
   * Phase 4 (§4.3): "point out a spot" — a photo and a tag, which becomes a
   * repair line pinned to the room. The customer posts the TAG, never hours:
   * ⚑6 decides on the server which tags auto-price and which go to a person.
   */
  z.object({
    action: z.literal("add_spot"),
    areaId: z.number().int().positive(),
    tag: z.string().min(1).max(40),
    /** How much of it there is — the customer's words, as a quantity. */
    extent: z.enum(["spots", "patches", "most"]).optional(),
    /** How bad per unit — the PHOTO READER's judgement, never the customer's. */
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    sourceId: z.string().uuid().nullable().optional(),
    note: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("remove_spot"),
    areaId: z.number().int().positive(),
    surfaceId: z.number().int().positive(),
  }),
  /**
   * Phase 5 (§4.5): the whole-job extras sheet. Named extras price from the
   * card; an unusual one is a sentence that is flagged and never priced.
   */
  z.object({
    action: z.literal("toggle_job_extra"),
    code: z.string().min(1).max(80),
    on: z.boolean(),
  }),
  z.object({ action: z.literal("set_colour_help"), want: z.boolean() }),
  z.object({ action: z.literal("extra_note"), note: z.string().max(400) }),
  /** C10 — extras in THIS room: a review line pinned to the room, never a price (lib/wizard/room-extras.ts). */
  z.object({
    action: z.literal("room_extra"),
    areaId: z.number().int().positive(),
    kind: z.enum(["feature_wall", "wallpaper", "other"]),
    count: z.number().int().min(0).max(6).optional(),
    on: z.boolean().optional(),
    text: z.string().max(120).optional(),
  }),
  /**
   * Phase 5 (§4.4): site and access — the things that set our setup time and
   * which the flow never asked at all. One answer per post; the server maps
   * it to a modifier, or raises an amber note when Tom has not seeded one.
   */
  z.object({
    action: z.literal("set_site_access"),
    field: z.enum(["cleared", "floors", "stairwell", "parking", "lift", "pets"]),
    value: z.string().min(1).max(12),
  }),
  /** §4.3: how THIS room sits against the job's condition band. */
  z.object({
    action: z.literal("set_room_condition"),
    areaId: z.number().int().positive(),
    condition: z.enum(["same", "better", "worse"]),
  }),
  z.object({
    action: z.literal("set_paint_system"),
    field: z.enum([
      "colourIntent", "ceilingsMarked", "ceilingsChangingColour", "glossTrims", "surfaceFlag", "darkToLight",
      "darkToLightCeilings", "darkToLightCeilingRoom",
    ]),
    /** surfaceFlag: which line, and which flag on it. darkToLight: which
     *  SURFACE is going dark → light (a substrate key, checked in the parser). */
    group: z.string().max(40).optional(),
    flag: z.string().max(40).optional(),
    /** darkToLightCeilingRoom: which room's ceiling (Tom, 11 Sep). */
    areaId: z.number().int().positive().optional(),
    // Flat rather than a nested discriminated union: nesting one inside
    // `actionSchema` collapses its own "action" discriminator. The field and
    // value are paired by `systemPatchFrom` below, which returns null on any
    // combination that does not exist — an unpaired value is a 400, not a
    // silently ignored answer.
    value: z.union([
      z.enum(["same", "new", "bold"]), z.enum(["yes", "no", "unsure"]),
      z.enum(["all", "some"]), z.boolean(), z.null(),
    ]),
  }),
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
  // ---- Part B: the customer scope editor's whitelist ----------------------
  // These five shapes are the ONLY customer-reachable mutations beyond
  // add/remove room: WHAT is painted, never hours, rates or allowances.
  // Anything else fails schema validation right here.
  z.object({ action: z.literal("toggle_surface"), areaId: z.number().int().positive(), key: z.string().min(1).max(40), on: z.boolean() }),
  z.object({ action: z.literal("set_count"), areaId: z.number().int().positive(), key: z.string().min(1).max(40), count: z.number().int().min(1).max(12) }),
  z.object({ action: z.literal("rename_room"), areaId: z.number().int().positive(), name: z.string().min(1).max(60) }),
  /** What comes with each door in one room — door · door+frame · +architrave. */
  z.object({ action: z.literal("room_door_scope"), areaId: z.number().int().positive(), scope: z.enum(["door", "frame", "architrave"]) }),
  /** Tom, 31 Aug: how much of the room's walls — 100/75/50/25%. */
  z.object({ action: z.literal("walls_share"), areaId: z.number().int().positive(), pct: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]) }),
  /** Free text → an amber estimator note. NEVER silently priced. */
  z.object({ action: z.literal("add_note"), areaId: z.number().int().positive().nullable().default(null), note: z.string().min(1).max(500) }),
  /** "Not right? Tell us" — flags the job non-straightforward. */
  z.object({ action: z.literal("flag_geometry"), note: z.string().max(300).optional() }),
  // ---- Part B2: exterior + the sign-off ladder ----------------------------
  z.object({ action: z.literal("toggle_exterior"), key: z.string().min(1).max(40), on: z.boolean() }),
  z.object({ action: z.literal("set_extent"), extent: z.enum(["whole", "front", "front_sides"]) }),
  /** metres sets the fence length; null = "not sure" → amber note. */
  z.object({ action: z.literal("set_fence"), metres: z.number().min(1).max(500).nullable() }),
  /** Fence type — paling, picket brushed or picket sprayed (Tom, 5 Sep). */
  z.object({ action: z.literal("set_fence_type"), type: z.enum(["paling", "picket_hand", "picket_spray"]) }),
  /** Customer accepted online (self-serve tier) — desk check follows. */
  z.object({ action: z.literal("accept_intent") }),
  /**
   * C7 — "fix my price online". Carries NO price: the figure is the engine's
   * central estimate, read server-side (⚑8). A client that could name its own
   * number is the hole R2b closed in `accept_estimate`, and it stays closed.
   */
  z.object({ action: z.literal("fix_online") }),
  /** Book the confirming visit; slot must be one the server offered. */
  z.object({ action: z.literal("book_visit"), slot: z.string().min(4).max(60) }),
  /** Tom, 5 Sep 2026: finalise by a call back or a site visit at the
   *  customer's convenience — a person schedules it, nothing is reserved. */
  z.object({
    action: z.literal("request_contact"),
    how: z.enum(["callback", "visit"]),
    window: z.enum(["am", "pm", "any"]),
    phone: z.string().trim().min(8).max(30),
    when: z.string().trim().max(300).default(""),
  }),
  // ---- R2b: the exterior confirm loop, BY SIDES ---------------------------
  z.object({ action: z.literal("side_include"), side: z.enum(["front", "left", "right", "back"]), include: z.boolean() }),
  z.object({ action: z.literal("side_size_ok"), side: z.enum(["front", "left", "right", "back"]) }),
  z.object({
    action: z.literal("side_dims"), side: z.enum(["front", "left", "right", "back"]),
    // Wide at the schema; applySideDims clamps to 3–40 / 2–8 (mockup's
    // gentle clamp — proceed at the nearest bound, never refuse).
    lengthM: z.number().min(0.1).max(500).nullable().default(null),
    heightM: z.number().min(0.1).max(500).nullable().default(null),
    notSure: z.boolean().default(false),
  }),
  z.object({ action: z.literal("wall_share"), side: z.enum(["front", "left", "right", "back"]), surfaceId: z.number().int().positive(), pct: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]) }),
  z.object({ action: z.literal("add_wall"), side: z.enum(["front", "left", "right", "back"]), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal("win_size"), side: z.enum(["front", "left", "right", "back"]), surfaceId: z.number().int().positive(), size: z.enum(["S", "M", "L"]) }),
  z.object({ action: z.literal("side_count"), side: z.enum(["front", "left", "right", "back"]), surfaceId: z.number().int().positive(), count: z.number().int().min(1).max(20) }),
  z.object({ action: z.literal("add_window_group"), side: z.enum(["front", "left", "right", "back"]) }),
  z.object({ action: z.literal("side_custom"), side: z.enum(["front", "left", "right", "back"]), name: z.string().min(1).max(120) }),
  /** Tom, 8 Sep: the customer's own name for a side ("Courtyard"); "" restores the default. */
  z.object({ action: z.literal("rename_side"), side: z.enum(["front", "left", "right", "back"]), name: z.string().max(40) }),
  /** Tom, 8 Sep: the optional "anything worth mentioning" box on a side,
   * with however many photos were attached alongside it. */
  z.object({ action: z.literal("side_note"), side: z.enum(["front", "left", "right", "back"]), note: z.string().max(600).default(""), photos: z.number().int().min(0).max(12).default(0) }),
  /** Tom, 8 Sep: the metres on a lineal run — handrails, gutters, fascias. */
  z.object({ action: z.literal("side_metres"), side: z.enum(["front", "left", "right", "back"]), surfaceId: z.number().int().positive(), metres: z.number().min(0.1).max(200).nullable().default(null) }),
  /** Parity STOP-item 1: a priced catalogue item onto one side's tile grid. */
  z.object({ action: z.literal("add_catalog"), side: z.enum(["front", "left", "right", "back"]), code: z.enum(["Window Shutters", "Side Gate", "Security Door", "Meter Box"]) }),
  /** R5: any Exterior rate-card row onto one side — validated against the
   * LIVE card in the handler, so the card decides what is offerable. */
  z.object({ action: z.literal("add_side_surface"), side: z.enum(["front", "left", "right", "back"]), code: z.string().min(1).max(60) }),
  /** 21 Aug: every exterior item is untickable — a wall, an "also on this
   * side" tile, or one of the customer's own named notes. */
  z.object({ action: z.literal("side_remove_line"), side: z.enum(["front", "left", "right", "back"]), surfaceId: z.number().int().positive() }),
  z.object({ action: z.literal("side_remove_custom"), side: z.enum(["front", "left", "right", "back"]), index: z.number().int().min(0).max(40) }),
  z.object({ action: z.literal("confirm_side"), side: z.enum(["front", "left", "right", "back"]) }),
  z.object({ action: z.literal("loop_cond"), cond: z.enum(["good", "weathered", "peeling"]).optional(), rot: z.enum(["no", "little", "lots"]).optional(), acc: z.enum(["steep", "tight", "high", "none"]).optional() }),
  z.object({ action: z.literal("loop_extras_none") }),
  z.object({ action: z.literal("loop_dw"), ok: z.boolean() }),
  z.object({ action: z.literal("loop_sweep"), ans: z.enum(["none"]).optional(), add: z.string().min(1).max(60).optional() }),
  /** Priced sweep chips — Shed / Side gate toggle a real line on the extras
   * block; Carport and free text stay on the amber loop_sweep path. */
  z.object({ action: z.literal("sweep_item"), code: z.enum(["Shed", "Side Gate"]), on: z.boolean() }),
  z.object({ action: z.literal("confirm_loop_item"), item: z.enum(["extras", "cond", "dw", "sweep"]) }),
  // ---- R3: the interior confirm loop --------------------------------------
  z.object({ action: z.literal("room_size_ok"), areaId: z.number().int().positive() }),
  z.object({ action: z.literal("room_dims"), areaId: z.number().int().positive(), lengthM: z.number().min(0.1).max(500), widthM: z.number().min(0.1).max(500) }),
  z.object({ action: z.literal("room_cupboard"), areaId: z.number().int().positive(), on: z.boolean(), count: z.number().int().min(1).max(40).nullable().default(null) }),
  z.object({ action: z.literal("room_cupboard_interior"), areaId: z.number().int().positive(), on: z.boolean(), count: z.number().int().min(1).max(40).nullable().default(null) }),
  /** Tom, 7 Sep: the inside face of the robe doors, and the sweep's "inside the cupboards" chips (every room at once). */
  z.object({ action: z.literal("room_cupboard_door_inside"), areaId: z.number().int().positive(), on: z.boolean(), count: z.number().int().min(1).max(40).nullable().default(null) }),
  z.object({ action: z.literal("iloop_sweep_cupboards"), kind: z.enum(["interior", "door_inside"]) }),
  z.object({ action: z.literal("room_win_size"), areaId: z.number().int().positive(), surfaceId: z.number().int().positive(), size: z.enum(["S", "M", "L"]) }),
  z.object({ action: z.literal("room_add_window_group"), areaId: z.number().int().positive() }),
  z.object({ action: z.literal("room_custom"), areaId: z.number().int().positive(), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("confirm_room_loop"), areaId: z.number().int().positive() }),
  z.object({ action: z.literal("iloop_dw"), ok: z.boolean() }),
  z.object({ action: z.literal("iloop_sweep"), ans: z.enum(["none"]).optional(), add: z.string().min(1).max(60).optional() }),
  z.object({ action: z.literal("room_add_catalogue"), areaId: z.number().int().positive(), code: z.string().min(1).max(60) }),
  z.object({ action: z.literal("room_line_count"), areaId: z.number().int().positive(), surfaceId: z.number().int().positive(), count: z.number().int().min(1).max(20) }),
  z.object({ action: z.literal("room_remove_line"), areaId: z.number().int().positive(), surfaceId: z.number().int().positive() }),
  z.object({ action: z.literal("confirm_iloop_item"), item: z.enum(["dw", "sweep"]) }),
]);


type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; surfaces?: Array<Record<string, unknown>>;
};

/** One whitelisted edit. */
type Action = z.infer<typeof actionSchema>;
/** Why an action was refused, so a batch can stop and still report. */
type ActionRefusal = { error: string; status: number };

/** Terminal actions that end the customer's session with a commitment —
 * they write events and a prep pack, so they are never swept into a batch
 * of scope edits. The client sends them alone; this is the server's half of
 * that rule. */
const UNBATCHABLE = new Set(["accept_intent", "book_visit", "request_contact", "fix_online"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Bad estimate id." }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  // R5.1: a request carries either ONE action (as it always did) or a BATCH
  // of them under `actions` — everything the customer tapped while the last
  // save was in flight. Both shapes go through the same whitelist.
  const rawBatch = (raw as { actions?: unknown }).actions;
  const parsed = Array.isArray(rawBatch)
    ? z.array(actionSchema).min(1).max(24).safeParse(rawBatch)
    : actionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const actions: Action[] = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  // Everything below that reads a single action reads the LAST one: it is the
  // action whose toast the customer is waiting on, and the only shape that
  // ever arrives alone (a terminal action is never batched).
  if (actions.length > 1 && actions.some((a) => UNBATCHABLE.has(a.action))) {
    return NextResponse.json({ error: "That step has to be sent on its own." }, { status: 400 });
  }
  // R1.1 — the response contract. The payload shape follows the REQUESTING
  // SURFACE, never the caller's role: a staff member previewing a customer
  // screen gets exactly the customer payload. `view` is REQUIRED so a caller
  // can never drift onto the wrong shape silently — that is precisely the bug
  // this replaces (staff previews got editorPayload, the range rendered
  // undefined, and tiles never refreshed).
  const viewParse = z.object({ view: z.enum(["customer", "staff"]) }).safeParse(raw);
  if (!viewParse.success) {
    return NextResponse.json({ error: "Missing view — say which payload this surface renders: view=customer|staff." }, { status: 400 });
  }

  const supabase = await createClient();
  // Staff edit anything; a customer edits ONLY the draft they created
  // through the wizard, via the service client with an ownership check.
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  /** The wizard session behind this estimate. The "converted" save that
   *  stamps estimate_id on the draft can land AFTER a request made from the
   *  builder's footer (Tom, 8 Sep: reach a person at any point), so when no
   *  row carries the estimate yet, the visitor's open draft is marked — and
   *  linked — instead. Never throws; the request itself is already filed. */
  const markSession = async (patch: Record<string, unknown>, where: string) => {
    const db0 = createServiceClient();
    if (!db0) return;
    try {
      const byEstimate = await db0.from("wizard_drafts").update(patch).eq("estimate_id", id).select("id");
      if (byEstimate.error) throw byEstimate.error;
      if ((byEstimate.data ?? []).length > 0 || actor.kind !== "customer") return;
      const byUser = await db0.from("wizard_drafts").update({ ...patch, estimate_id: id }).eq("user_id", actor.user.id).is("converted_at", null);
      if (byUser.error) throw byUser.error;
    } catch (e) { reportError(e, { where, bestEffort: true }); }
  };
  // A customer can never request the staff payload (totals, margin, hours).
  if (actor.kind === "customer" && viewParse.data.view === "staff") {
    return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  }
  const view = viewParse.data.view;
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
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id)
    .maybeSingle();
  if (!estimate) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  if (actor.kind === "customer") {
    // Phase 1 (6 Sep plan): the anonymous builder OR a signed-in member of
    // the linked account (lib/supabase/guards customerOwnsDraft).
    const own = await customerOwnsDraft(db, actor, estimate as { created_by?: string | null; source?: string | null; status?: string | null; account_id?: string | null });
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

  // These carry the loop state ACROSS a batch, so they live outside
  // applyAction — action 3 must see what action 1 did.
  let sidesMeta: SidesLoopMeta = ((state.sidesLoop as SidesLoopMeta | undefined) ?? defaultSidesLoop());
  let interiorMeta: InteriorLoopMeta = ((state.interiorLoop as InteriorLoopMeta | undefined) ?? defaultInteriorLoop());
  // AUDIT 9.1: the stored flag ORed with the derivation from state, through the
  // one function, so this route can never be softer than the submit that made
  // the estimate. `flagSiteCheck` below still escalates it live for actions that
  // introduce a reason mid-edit.
  /** C5 — set when the customer asks for a person; the row is written after pricing. */
  let confirmationIntent: "remote" | "visit" | "fix_online" | null = null;
  /** C7 — the customer tapped "fix my price online"; the ladder decides below. */
  let fixOnlineIntent = false;
  /**
   * Read through a function on purpose. `confirmationIntent` is assigned both
   * here and inside `applyAction`; TypeScript's control-flow analysis does not
   * follow the nested one, so a direct comparison against "visit" downstream
   * is reported as unreachable. It is not — every booked visit takes it. The
   * accessor's return type is the variable's DECLARED type, which is the type
   * it actually has, so the check survives without a cast silencing it.
   */
  const readIntent = () => confirmationIntent;
  let siteCheck = requiresSiteCheck({
    state: wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state).data ?? null,
    stored: (estimate as { requires_site_check?: boolean | null }).requires_site_check,
  });
  const flagSiteCheck = async () => {
    if (siteCheck) return;
    siteCheck = true;
    await db.from("estimates").update({ requires_site_check: true }).eq("id", id)
      .then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.sides.siteCheck", bestEffort: true, extra: { id } }); });
  };
  let newDeferred = deferred;

  /**
   * Apply ONE whitelisted action to the state above. Returns null on success,
   * or the refusal to report — it can no longer answer the request itself,
   * because a request may now carry several actions (see the loop below).
   */
  async function applyAction(act: Action): Promise<ActionRefusal | null> {
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

    if (act.action === "set_door_style" || act.action === "set_window_style") {
      const r = act.action === "set_door_style"
        ? applyDoorStyle(blocks, act.style, stampOrigin)
        : applyWindowStyle(blocks, act.style, stampOrigin);
      if ("error" in r) return { error: r.error, status: 400 };
      blocks = r.blocks;
      const gone = act.action === "set_door_style" ? DOOR_STYLE_DEFERRAL : WINDOW_STYLE_DEFERRAL;
      newDeferred = newDeferred.filter((d) => d.what !== gone);
      // The wizard snapshot remembers the answer, so a later re-merge (add_room)
      // builds new rooms at the answered style too.
      const wiz = state.wizard as { state?: { details?: Record<string, unknown> } } | undefined;
      if (wiz?.state?.details) wiz.state.details[act.action === "set_door_style" ? "doorStyle" : "windowStyle"] = act.style;
    }

    /**
     * Phase 4 (estimator journey v2 §4.2): a tap on the paint-systems card.
     *
     * The customer posts an ANSWER — "same colour actually", "they're
     * marked", "yes, the trims are shiny" — and the server re-derives every
     * interior surface's coats from Tom's Settings table. Three things this
     * order gets right:
     *
     *   1. The SNAPSHOT is written first, so a room added later merges at the
     *      corrected answer (the same rule set_door_style follows).
     *   2. The whole tree is re-derived, not the line that was tapped.
     *      Colour intent is job-wide: "same colour actually" on the walls has
     *      to move the trims too, or the estimate holds two answers to one
     *      question.
     *   3. Exterior rows are untouched by applyPaintSystems — there is no
     *      validated exterior table to re-derive them from (plan §4.4).
     */
    if (act.action === "set_paint_system") {
      const patch = systemPatchFrom(act.field, act.value, act.group, act.flag, act.areaId);
      if (!patch) return { error: "That isn't an answer we recognise.", status: 400 };

      const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
      if (!snap.success) {
        return { error: "This estimate predates the paint systems screen — a person will confirm the coats.", status: 409 };
      }
      const { condition, paint } = applySystemPatch(snap.data, patch);
      const next = { ...snap.data, condition, paint };

      const wiz = state.wizard as { state?: Record<string, unknown> } | undefined;
      if (wiz?.state) { wiz.state.condition = condition; wiz.state.paint = paint; }

      const systems = paintSystemsFrom(settingValue((await ctxPromise).settings, PAINT_SYSTEMS_KEY));
      blocks = applyPaintSystems(blocks, next, systems) as typeof blocks;
    }

    /**
     * §4.5 — a named extra. Priced from the CARD, never from a constant: the
     * row's own charge-out is the price, and a code the card does not carry
     * is refused rather than added at nothing.
     */
    if (act.action === "toggle_job_extra") {
      const ctxNow = await ctxPromise;
      const row = ctxNow.rateItems.find((r) => r.code === act.code && r.category === "Interior");
      const cents = Number(row?.charge_out_cents ?? 0);
      if (!row || cents <= 0) return { error: "We don't offer that one — pick from the list.", status: 400 };
      let next = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((x) => Number(x.id) || 0)])) + 1;
      const res = toggleExtrasItem(
        blocks as unknown as Parameters<typeof toggleExtrasItem>[0],
        act.code, prettifyExtra(act.code), act.on, () => next++, cents / 100, "Interior",
      );
      if (!res.ok) return { error: res.error, status: 400 };
      blocks = res.blocks as unknown as typeof blocks;
    }

    /** §4.5's fourth extra. Not a rate row — it rides the field that already
     *  exists, which the CRM reads to raise a colour-advice follow-up. */
    if (act.action === "set_colour_help") {
      const wiz = state.wizard as { state?: { paint?: Record<string, unknown> } } | undefined;
      if (wiz?.state?.paint) wiz.state.paint.colourHelp = act.want ? "advice" : "known";
    }

    /**
     * §4.5 — an unusual extra. Recorded and flagged, NEVER auto-priced (the
     * rule `addSideCustom` follows). Re-raised from scratch so editing the
     * sentence replaces the note instead of stacking a second one.
     */
    if (act.action === "room_extra") {
      const roomBlock = blocks.find((b) => b.kind === "area" && Number(b.id) === act.areaId);
      if (!roomBlock) return { error: "That room isn't on this estimate.", status: 400 };
      newDeferred = applyRoomExtra(newDeferred, {
        areaId: act.areaId, room: String(roomBlock.name ?? "Room"), kind: act.kind,
        count: act.count ?? null, on: act.on ?? null, text: act.text ?? null,
      });
    }

    if (act.action === "extra_note") {
      newDeferred = newDeferred.filter((d) => d.what !== "an extra the customer asked for");
      const raised = extraNoteDeferral(act.note);
      if (raised) newDeferred = [...newDeferred, { room: "Whole job", areaId: null, count: 1, ...raised }];
      const wiz = state.wizard as { state?: { details?: Record<string, unknown> } } | undefined;
      if (wiz?.state?.details) wiz.state.details.extraNote = act.note.trim().slice(0, 400);
    }

    /**
     * §4.4 — site and access.
     *
     * The answer is written to the wizard snapshot and the whole set is then
     * re-applied, so changing an answer REPLACES its modifier and its amber
     * note rather than stacking a second one. Nothing here invents a price:
     * `applySiteAccess` uses a modifier when Tom has seeded it and defers to
     * a person when he has not (the allowances spec §4 is not in the repo).
     */
    if (act.action === "set_site_access") {
      const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
      if (!snap.success) {
        return { error: "This estimate predates the site and access questions — a person will confirm them.", status: 409 };
      }
      const parsed = siteAccessValue(act.field, act.value);
      if (parsed == null) return { error: "That isn't an answer we recognise.", status: 400 };

      const access = { ...(snap.data.details.siteAccess ?? {}), [act.field]: parsed };
      const wiz = state.wizard as { state?: { details?: Record<string, unknown> } } | undefined;
      if (wiz?.state?.details) wiz.state.details.siteAccess = access;

      const ctxNow = await ctxPromise;
      const outcome = applySiteAccess(
        access,
        ctxNow.modifiers,
        hourAllowancesFrom(settingValue(ctxNow.settings, SITE_ACCESS_HOURS_KEY)),
      );
      // Every note this module has ever raised goes, then the current set is
      // re-raised — an answer changed back to "the rooms will be cleared"
      // must not leave yesterday's flag behind.
      newDeferred = newDeferred.filter((d) => !SITE_ACCESS_DEFERRAL.test(d.what));
      newDeferred = [...newDeferred, ...outcome.deferred];

      const modSel = { ...((state.modSel as Record<string, string>) ?? {}) };
      delete modSel[STAGING_GROUP];
      Object.assign(modSel, outcome.modSel);
      (state as Record<string, unknown>).modSel = modSel;

      /**
       * The flat-hour allowances (Tom, 9 Sep: tricky parking ≈ 2–3 h, a lift
       * booking ≈ 1 h). They do NOT scale with the job, so they are hours on
       * a whole-job line rather than a percentage — a percentage would
       * under-price the small job the walk hurts most.
       *
       * Rebuilt from scratch every time: an answer taken back must take its
       * hours with it, and re-answering must not stack a second copy.
       */
      let nextId = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((x) => Number(x.id) || 0)])) + 1;
      blocks = blocks.map((b) => (isSiteAccessBlock(b)
        ? { ...b, surfaces: (b.surfaces ?? []).filter((x) => !String(x.code ?? "").startsWith("Site Access — ")) }
        : b));
      if (outcome.hours.length > 0) {
        const lines = outcome.hours.map((h) => {
          const line = makeDraftSurface(nextId++, `Site Access — ${h.label}`, h.label, 1, "customer_stated", 0.9, ["prep"]) as unknown as Record<string, unknown>;
          line.prepHr = h.hours;
          line.crewNote = h.note;
          return line;
        });
        const idx = blocks.findIndex(isSiteAccessBlock);
        if (idx >= 0) {
          blocks = blocks.map((b, i) => (i === idx ? { ...b, surfaces: [...(b.surfaces ?? []), ...lines] } : b));
        } else {
          blocks = [...blocks, {
            id: nextId++, kind: "area", name: "Site access", type: "Interior", areaType: "surface",
            roomType: "interior", storey: "ground", L: 0, W: 0, H: 0,
            isOption: false, description: "", open: false, media: [],
            origin: "customer_stated", confidence: 0.9, assumedFields: [], extractionSourceId: null,
            surfaces: lines,
          } as unknown as typeof blocks[number]];
        }
      }
    }

    /**
     * §4.3 — the customer points out a spot.
     *
     * The line is created whether or not it prices (⚑6): a spot that became
     * only an amber note in a queue would be the free-text box §2.3 complains
     * about, wearing a tag. The rates come from `defect_prep_rates`, which is
     * the same table the plan reader's own defects price from — one defect
     * vocabulary, one price for the same damage however it was spotted.
     */
    if (act.action === "add_spot") {
      const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === act.areaId);
      if (idx < 0) return { error: "No such room.", status: 404 };
      const area = blocks[idx];
      let next = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((x) => Number(x.id) || 0)])) + 1;
      const { data: rateRows } = await db
        .from("defect_prep_rates")
        .select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3")
        .eq("version", SCOPE_VERSION);
      const line = spotLine(
        { tag: act.tag, extent: act.extent, severity: act.severity, sourceId: act.sourceId ?? null, note: act.note },
        { id: act.areaId, name: String(area.name ?? "this room") },
        (rateRows ?? []) as DefectRate[],
        () => next++,
        // Tom's quantities per extent — how much "most of it" actually means.
        extentQtyFrom(settingValue((await ctxPromise).settings, SPOT_EXTENT_QTY_KEY)),
      );
      if (line == null) return { error: "We don't know that one — pick a tag from the list.", status: 400 };
      blocks = blocks.map((b, i) => (i === idx
        ? { ...b, surfaces: [...(b.surfaces ?? []), line.surface as unknown as Record<string, unknown>] }
        : b));
      if (line.deferred) newDeferred = [...newDeferred, line.deferred];
    }

    if (act.action === "remove_spot") {
      const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === act.areaId);
      if (idx < 0) return { error: "No such room.", status: 404 };
      const gone = (blocks[idx].surfaces ?? []).find((x) => Number(x.id) === act.surfaceId);
      // Only a spot may be removed this way — the action must never become a
      // way to delete a painting line the customer is meant to untick.
      if (!gone || !String(gone.internalLabel ?? "").startsWith("Repair — ")) {
        return { error: "That isn't a flagged spot.", status: 400 };
      }
      blocks = blocks.map((b, i) => (i === idx
        ? { ...b, surfaces: (b.surfaces ?? []).filter((x) => Number(x.id) !== act.surfaceId) }
        : b));
      // Its amber note goes with it, or the estimator chases a spot that no
      // longer exists.
      newDeferred = newDeferred.filter((d) => !(d.areaId === act.areaId && d.what.startsWith(`${spotLabelFor(gone)} `)));
    }

    if (act.action === "set_room_condition") {
      const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === act.areaId);
      if (idx < 0) return { error: "No such room.", status: 404 };
      const name = String(blocks[idx].name ?? "this room");
      const area: LooseBlock = { ...blocks[idx], roomCondition: act.condition };
      blocks = blocks.map((b, i) => (i === idx ? area : b));
      // Re-raised from scratch each time, so changing the answer back to
      // "same" clears the flag rather than leaving a stale one behind.
      newDeferred = newDeferred.filter((d) => !(d.areaId === act.areaId && d.what === "worse than the rest"));
      const raised = roomConditionDeferred({ id: act.areaId, name }, act.condition);
      if (raised) newDeferred = [...newDeferred, raised];
    }

    if (act.action === "confirm_room") {
      const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === act.areaId);
      if (idx < 0) return { error: "No such room.", status: 404 };
      const b = { ...blocks[idx] };
      if (act.lengthM != null) b.L = act.lengthM;
      if (act.widthM != null) b.W = act.widthM;
      if (!Number(b.L) || !Number(b.W)) {
        return { error: "This room has no size yet — enter its length and width to confirm it.", status: 400 };
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
        return { error: `No scope rules exist for a "${act.roomType}".`, status: 422 };
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
        // The wizard's size band, if this tree came from the quick basics.
        { heightM, bedrooms: 0, sizeBand: ((state.wizard as { state?: { basics?: { sizeBand?: string } | null } } | undefined)?.state?.basics?.sizeBand) ?? null },
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
      // Same Settings table the submit route derives with — a room added
      // later must follow the job's systems, not the file's defaults.
      const paintSystems = paintSystemsFrom(settingValue((await ctxPromise).settings, PAINT_SYSTEMS_KEY));
      const mergedRoom = parsedSnap.success
        ? applyWizardAnswers(roomDraft, parsedSnap.data, () => next++, paintSystems)
        : roomDraft;
      if (mergedRoom.areas.length === 0) {
        return { error: "Nothing is selected for that room type on this job.", status: 422 };
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

    // ---- Part B: customer scope actions — pure helpers, then reprice --------
    if (act.action === "toggle_surface" || act.action === "set_count" || act.action === "rename_room"
      || act.action === "room_door_scope" || act.action === "walls_share") {
      const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
      const snapshot = snap.success ? snap.data : null;
      let next = Math.max(0, ...blocks.flatMap((b) => [
        Number(b.id) || 0,
        ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
      ])) + 1;
      const result =
        act.action === "toggle_surface" ? applyToggle(blocks, act.areaId, act.key, act.on, snapshot, () => next++)
        : act.action === "set_count" ? applyCount(blocks, act.areaId, act.key, act.count)
        : act.action === "room_door_scope" ? applyDoorScope(blocks, act.areaId, act.scope, () => next++)
        : act.action === "walls_share" ? applyWallsShare(blocks, act.areaId, act.pct)
        : applyRename(blocks, act.areaId, act.name);
      if (!result.ok) return { error: result.error, status: 400 };
      blocks = result.blocks as LooseBlock[];
    }

    if (act.action === "add_note") {
      const room = act.areaId != null ? blocks.find((b) => b.kind === "area" && Number(b.id) === act.areaId) : null;
      if (act.areaId != null && !room) return { error: "No such room.", status: 404 };
      deferred.push({
        room: room ? String(room.name ?? "Room") : "Whole job",
        areaId: act.areaId ?? null,
        what: "customer note",
        count: 1,
        needs: `"${act.note.trim().slice(0, 300)}" — price this WITH the customer, never silently`,
      });
    }

    if (act.action === "flag_geometry") {
      deferred.push({
        room: "Whole job", areaId: null, what: "geometry flagged by customer", count: 1,
        needs: act.note?.trim()
          ? `customer says the storeys/heights look wrong: "${act.note.trim().slice(0, 200)}" — verify on site`
          : "customer says the storeys/heights look wrong — verify on site",
      });
      await db.from("estimates").update({ requires_site_check: true }).eq("id", id)
        .then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.flagGeometry", bestEffort: true, extra: { id } }); });
    }

    if (act.action === "set_fence_type") {
      const result = applyFenceType(blocks, FENCE_CODE[act.type], FENCE_TYPE_LABEL[act.type]);
      if (!result.ok) return { error: result.error, status: 400 };
      blocks = result.blocks as LooseBlock[];
    }

    if (act.action === "toggle_exterior" || act.action === "set_extent" || act.action === "set_fence") {
      let next = Math.max(0, ...blocks.flatMap((b) => [
        Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
      ])) + 1;
      if (act.action === "set_fence" && act.metres == null) {
        // "Not sure" is a first-class answer: amber, measured on the day.
        deferred.push({
          room: "Exterior", areaId: null, what: "fence length", count: 1,
          needs: "customer isn't sure of the fence length — measure it on site",
        });
      } else {
        const result =
          act.action === "toggle_exterior" ? applyExteriorToggle(blocks, act.key, act.on, () => next++)
          : act.action === "set_extent" ? applyExtent(blocks, act.extent)
          : applyFenceLength(blocks, act.metres as number);
        if (!result.ok) return { error: result.error, status: 400 };
        blocks = result.blocks as LooseBlock[];
        // Ticking a freestanding extra IS the answer to the extras card —
        // "Nothing else" must never be demanded on top of a ticked deck
        // (Tom, 31 Aug). Unticking the last one re-opens the question.
        if (act.action === "toggle_exterior" && FREESTANDING_EXTRA_KEYS.includes(act.key)) {
          sidesMeta = {
            ...sidesMeta,
            extrasAns: hasFreestandingExtras(blocks) ? "some"
              : sidesMeta.extrasAns === "some" ? null : sidesMeta.extrasAns,
          };
        }
      }
    }

    if (act.action === "request_contact") {
      // The prep pack + the estimator's amber line, as for a booking …
      const windowText = act.window === "am" ? "mornings" : act.window === "pm" ? "afternoons" : "any time";
      const visit = act.how === "visit";
      const note = `${visit ? "SITE VISIT — " : ""}${windowText}${act.when ? ` · ${act.when}` : ""} · ${act.phone} · via the estimate builder`;
      (state as Record<string, unknown>).prepPack = {
        kind: visit ? "visit_request" : "callback", slot: null, at: new Date().toISOString(),
        window: act.window, phone: act.phone, when: act.when, removedSubstrates: [], flags: [],
      };
      deferred.push({
        room: "Whole job", areaId: null, count: 1,
        what: visit ? `site visit requested — ${windowText}${act.when ? `, ${act.when}` : ""}` : `call back requested — ${windowText}`,
        needs: visit ? `ring ${act.phone} to book the visit, then confirm the scope on site` : `ring ${act.phone} to finalise the price`,
      });
      await db.from("estimate_events").insert({
        estimate_id: id, type: visit ? "visit_requested" : "callback_requested",
        payload: { window: act.window, phone: act.phone, when: act.when },
      }).then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.contact", bestEffort: true }); });
      /**
       * ⚑ A call back has to leave somebody to call back.
       *
       * Since ⚑1 took the contact form out from in FRONT of the price, an
       * estimate reaches this point with no account at all — so the CRM event
       * was filed against account_id null and the office's own timeline never
       * heard about the request. The number they just typed IS the handle:
       * accounts are found by email OR phone (crm_find_account, CRM v2 P1), so
       * a phone alone is enough to file one and link the estimate to it. No new
       * question is asked — this is the number the form already demands.
       *
       * Best effort on purpose: they asked us to ring them, and the request is
       * already recorded on the estimate. A stumble here costs a timeline entry,
       * never the call back.
       */
      let contactAccountId = (estimate as { account_id?: string | null } | null)?.account_id ?? null;
      if (!contactAccountId) {
        try {
          const ensured = await ensureAccount(db, { phone: act.phone });
          if (ensured.accountId) {
            contactAccountId = ensured.accountId;
            await db.from("estimates").update({ account_id: ensured.accountId }).eq("id", id);
          } else {
            // Not silent. "A call back nobody can be called back on" is exactly
            // the kind of thing that hides for weeks behind a best-effort catch.
            reportError(
              new Error(`no account filed from "${act.phone}"${ensured.migrationPending ? " (migration pending)" : ""}`),
              { where: "wizard.edit.contactAccount", bestEffort: true },
            );
          }
        } catch (e) {
          reportError(e, { where: "wizard.edit.contactAccount", bestEffort: true });
        }
      }
      // … and the CRM event that puts it on Today and the account timeline
      // (a booking never wrote one, so the office was never told).
      await logCrmEvent(db, {
        type: "callback_requested", source: "customer",
        accountId: contactAccountId,
        estimateId: id,
        payload: { phone: act.phone, note },
        dedupeKey: `contact:${id}:${act.how}:${act.window}:${act.phone}`,
      });
      // Buckets brief §3: the wizard session's outcome → bucket A on Today.
      await markSession({
        outcome: visit ? "visit_requested" : "call_requested", outcome_at: new Date().toISOString(), outcome_note: note,
        bucket: visit ? "ready_visit" : "ready_call",
      }, "wizard.edit.sessionOutcome");
    }

    if (act.action === "fix_online") {
      // Nothing is decided here. The tap only records that it happened; the
      // ladder gets the last word after pricing, below.
      fixOnlineIntent = true;
    }

    if (act.action === "accept_intent" || act.action === "book_visit") {
      if (act.action === "book_visit") {
        // Buckets brief §3: a booked visit is a visit requested, for the session's bucket.
        // Tom, 8 Sep: "Booked: …" is what keeps Today from raising a "book
        // visit" card for a visit that is already in the Diary (work-queue).
        await markSession({
          outcome: "visit_requested", outcome_at: new Date().toISOString(), bucket: "ready_visit", outcome_note: `Booked: ${act.slot} (from the estimate builder)`,
        }, "wizard.edit.sessionVisit");
        const flags = (settingValue((await ctxPromise).settings, "scope_editor") ?? {}) as { visitSlots?: string[] };
        const slots = await wizardVisitSlots(db, flags);
        if (!slots.labels.includes(act.slot)) {
          return { error: "Pick one of the offered times.", status: 400 };
        }
        // P6: the window books a real visit — estimator, block, invite, calendar.
        // A window that filled since it was offered says so, and offers again.
        const booked = await bookWizardSlot(db, slots, act.slot, {
          accountId: (estimate as { account_id?: string | null } | null)?.account_id ?? null, estimateId: id,
          note: "Booked online from the estimate.",
        });
        if (booked && !booked.ok) return { error: booked.message, status: booked.code === "double_booked" ? 409 : 400 };
      }
      // The estimator's prep pack: scope summary, flags, not-sures and removed
      // substrates ride builder_state for the visit's capture verify mode.
      const { data: events } = await db.from("estimate_events")
        .select("type, payload").eq("estimate_id", id).eq("type", "scope_edit").limit(200);
      const removed = (events ?? [])
        .map((e) => (e.payload ?? {}) as { action?: string; key?: string; on?: boolean })
        .filter((p) => p.action === "toggle_surface" && p.on === false)
        .map((p) => p.key);
      (state as Record<string, unknown>).prepPack = {
        kind: act.action === "book_visit" ? "visit" : "desk_check",
        slot: act.action === "book_visit" ? act.slot : null,
        at: new Date().toISOString(),
        removedSubstrates: [...new Set(removed)],
        flags: deferred.filter((d) => /customer|not sure|flagged/i.test(`${d.what} ${d.needs}`)).map((d) => `${d.room}: ${d.what}`),
      };
      deferred.push({
        room: "Whole job", areaId: null,
        what: act.action === "book_visit" ? `visit booked — ${act.slot}` : "customer accepted online",
        count: 1,
        needs: act.action === "book_visit"
          ? "confirm the scope on site (capture verify mode) — the customer's build rides in the prep pack"
          : "desk check, then send the fixed price and booking confirmation",
      });
      await db.from("estimate_events").insert({
        estimate_id: id, type: act.action === "book_visit" ? "visit_booked" : "customer_accept_intent",
        payload: act.action === "book_visit" ? { slot: act.slot } : {},
      }).then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.ladder", bestEffort: true }); });
      // C5: the row is created below, once the payload exists — the pack it
      // freezes needs the priced tree, and pricing happens after every action
      // has been applied. Flagged here so the intent survives a batch.
      confirmationIntent = act.action === "book_visit" ? "visit" : "remote";
    }

    // ---- R2b: the sides confirm loop ----------------------------------------
    if (act.action === "side_include" || act.action === "side_size_ok" || act.action === "side_dims"
      || act.action === "wall_share" || act.action === "add_wall" || act.action === "win_size"
      || act.action === "side_count" || act.action === "add_window_group" || act.action === "side_custom"
      || act.action === "rename_side" || act.action === "side_metres" || act.action === "side_note"
      || act.action === "add_catalog" || act.action === "add_side_surface"
      || act.action === "side_remove_line" || act.action === "side_remove_custom"
      || act.action === "confirm_side") {
      let next = Math.max(0, ...blocks.flatMap((b) => [
        Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
      ])) + 1;
      // Catalogue items price off the live card's per-item charge-out; a code
      // the card can't price refuses loudly — never a silent $0 line.
      const catalogRate = act.action === "add_catalog" ? rateFor((await ctxPromise).rateItems, act.code) : null;
      if (act.action === "add_catalog" && !catalogRate) {
        return { error: "We can't price that item right now — name it in “Something else” instead.", status: 400 };
      }
      // R5: a generic side add is checked against the LIVE Exterior card, and
      // only against rows the panel is allowed to offer — the wall %-mix and
      // the whole-job sweep items keep their own controls.
      // A wall substrate arrives at the card's own coat count (unpainted
      // brick is sealed then twice topcoated — a 3-coat row).
      const wallCoats = act.action === "add_wall"
        ? ((await ctxPromise).rateItems.find((r) => r.code === act.code && r.category === "Exterior")?.default_coats ?? null)
        : null;
      let sideAddLabel = "";
      let sideAddRate: number | null = null;
      if (act.action === "add_side_surface") {
        const rateItems = (await ctxPromise).rateItems;
        const allowed = exteriorAddOptions(rateItems).find((o) => o.key === act.code);
        if (!allowed) {
          return { error: "We can't price that item right now — name it in “Something else” instead.", status: 422 };
        }
        sideAddLabel = allowed.label;
        sideAddRate = perItemChargeOut(rateItems, "Exterior", act.code);
      }
      const result =
        act.action === "side_include" ? applySideInclude(blocks, act.side, act.include)
        : act.action === "side_size_ok" ? applySideSizeOk(blocks, act.side)
        : act.action === "side_dims" ? applySideDims(blocks, act.side, { lengthM: act.lengthM, heightM: act.heightM, notSure: act.notSure })
        : act.action === "wall_share" ? applyWallShare(blocks, act.side, act.surfaceId, act.pct)
        : act.action === "add_wall" ? addWallSurface(blocks, act.side, act.code, () => next++, wallCoats)
        : act.action === "add_side_surface" ? addSideSurface(blocks, act.side, act.code, sideAddLabel, () => next++, sideAddRate)
        : act.action === "win_size" ? applyWindowSize(blocks, act.side, act.surfaceId, act.size)
        : act.action === "side_count" ? applySideCount(blocks, act.side, act.surfaceId, act.count)
        : act.action === "add_window_group" ? addWindowGroup(blocks, act.side, () => next++)
        : act.action === "side_custom" ? addSideCustom(blocks, act.side, act.name)
        : act.action === "rename_side" ? applySideRename(blocks, act.side, act.name)
        : act.action === "side_metres" ? applySideMetres(blocks, act.side, act.surfaceId, act.metres)
        : act.action === "side_note" ? applySideNote(blocks, act.side, act.note, act.photos)
        : act.action === "add_catalog" ? addCatalogItem(blocks, act.side, act.code, () => next++, catalogRate!.chargeOutDollars)
        : act.action === "side_remove_line" ? removeSideLine(blocks, act.side, act.surfaceId)
        : act.action === "side_remove_custom" ? removeSideCustom(blocks, act.side, act.index)
        : confirmSide(blocks, act.side);
      if (!result.ok) return { error: result.error, status: 400 };
      blocks = result.blocks as LooseBlock[];
      if (act.action === "side_dims" && act.notSure) {
        deferred.push({
          room: `Exterior - ${act.side}`, areaId: null, what: "side measurements", count: 1,
          needs: "customer isn't sure of this side's size — we'll measure on the day",
        });
      }
      if (act.action === "side_custom") {
        // Custom = never auto-priced; the estimate carries the amber item and
        // routes to the visit tier — an unpriced area can't be accepted fixed.
        deferred.push({
          room: `Exterior - ${act.side}`, areaId: null, what: `custom surface: "${act.name.trim().slice(0, 80)}"`,
          count: 1, needs: "price this WITH the customer on the visit — never silently", kind: "custom_surface",
        });
        await flagSiteCheck();
      }
      if (act.action === "side_note") {
        // The note is the estimator's to read and price — an amber review
        // line, never a silent number. Re-saving replaces the last one so a
        // corrected note doesn't leave the old text on the sheet.
        const room = `Exterior - ${act.side}`;
        for (let i = deferred.length - 1; i >= 0; i--) {
          if (deferred[i].room === room && deferred[i].kind === "side_note") deferred.splice(i, 1);
        }
        const text = act.note.trim().slice(0, 300);
        const photos = (findSide(blocks, act.side)?.customerPhotos as number | undefined) ?? 0;
        if (text || photos > 0) {
          deferred.push({
            room, areaId: null, kind: "side_note", count: 1,
            what: `customer note on the ${act.side}${photos > 0 ? ` (+${photos} photo${photos > 1 ? "s" : ""})` : ""}`,
            needs: text
              ? `"${text}" — read this before pricing the prep on this side`
              : "photos attached to this side — check them before pricing the prep",
          });
        }
      }
      if (act.action === "side_include" && !act.include) {
        // The exclusion is explicit on the quote; its open questions leave.
        deferred.push({
          room: `Exterior - ${act.side}`, areaId: null, what: "side excluded", count: 1,
          needs: `customer chose not to paint the ${act.side} — show it as an exclusion on the quote`,
        });
      }
    }
    if (act.action === "loop_cond") {
      sidesMeta = { ...sidesMeta, cond: { ...sidesMeta.cond, ...(act.cond ? { cond: act.cond } : {}), ...(act.rot ? { rot: act.rot } : {}), ...(act.acc ? { acc: act.acc } : {}) } };
      // Parity STOP-item 1 (Tom's ruling, 20 Aug): weathered / minor rot /
      // access PRICE — the modifier and allowance rows live on the live card
      // (migrations 20260921–22). If a row is missing, each falls back to the
      // old amber deferral rather than a silent $0. Answers toggle both ways.
      const ctxCond = await ctxPromise;
      let nextExtra = Math.max(0, ...blocks.flatMap((b) => [
        Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
      ])) + 1;
      const setAllowance = (def: { code: string; label: string }, on: boolean): boolean => {
        const r = rateFor(ctxCond.rateItems, def.code);
        if (!r) return false;
        const res = toggleExtrasItem(blocks, def.code, def.label, on, () => nextExtra++, r.chargeOutDollars);
        if (res.ok) blocks = res.blocks as LooseBlock[];
        return res.ok;
      };
      if (act.cond) {
        const modSel = { ...((state.modSel as Record<string, string>) ?? {}) };
        const hasWeathered = ctxCond.modifiers.some((m) => m.code === WEATHERED_MODIFIER_CODE);
        const hasPoor = ctxCond.modifiers.some((m) => m.code === INTERIOR_POOR_MODIFIER_CODE);
        // Interior damage tier ≥ 2 owns the Poor slot on a Both job — the
        // exterior card answering "good" must not take the interior's hours away.
        const interiorPoor = ((state.wizard as { state?: { jobType?: string; details?: { damageTier?: number } } } | undefined)?.state?.details?.damageTier ?? 0) >= 2
          && (state.wizard as { state?: { jobType?: string } } | undefined)?.state?.jobType !== "exterior";
        if (act.cond === "peeling" && hasPoor) modSel.Condition = INTERIOR_POOR_MODIFIER_CODE;
        else if (act.cond === "weathered" && hasWeathered && !(interiorPoor && modSel.Condition === INTERIOR_POOR_MODIFIER_CODE)) modSel.Condition = WEATHERED_MODIFIER_CODE;
        else if (modSel.Condition === WEATHERED_MODIFIER_CODE) delete modSel.Condition;
        else if (modSel.Condition === INTERIOR_POOR_MODIFIER_CODE && !interiorPoor) delete modSel.Condition;
        (state as Record<string, unknown>).modSel = modSel;
        if (act.cond === "weathered" && !hasWeathered) {
          deferred.push({ room: "Exterior", areaId: null, what: "weathered paintwork", count: 1, needs: "extra preparation allowed for — confirm the prep scope at review" });
        }
        if (act.cond === "peeling") {
          deferred.push({ room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1, needs: "needs eyes on it — lead-safe check on the visit if pre-1970" });
          await flagSiteCheck();
        }
      }
      if (act.rot) {
        const priced = setAllowance(ALLOWANCE_CODES.rot, act.rot === "little");
        if (act.rot === "little" && !priced) {
          deferred.push({ room: "Exterior", areaId: null, what: "minor fascia rot", count: 1, needs: "allow minor fascia prep — confirm extent at review" });
        }
        if (act.rot === "lots") {
          deferred.push({ room: "Exterior", areaId: null, what: "fascia rot", count: 1, needs: "rot repair needs eyes on it — confirm the roofline scope on the visit" });
          await flagSiteCheck();
        }
      }
      if (act.acc) {
        const priced = setAllowance(ALLOWANCE_CODES.access, act.acc !== "none");
        if (act.acc !== "none" && !priced) {
          deferred.push({ room: "Exterior", areaId: null, what: `access: ${act.acc}`, count: 1, needs: "access affects setup time — allow for it at review" });
        }
      }
    }
    if (act.action === "loop_extras_none") sidesMeta = { ...sidesMeta, extrasAns: "none" };
    if (act.action === "loop_dw") sidesMeta = { ...sidesMeta, dwOk: act.ok ? true : null };
    if (act.action === "loop_sweep") {
      if (act.add) {
        sidesMeta = { ...sidesMeta, sweepAns: "added" };
        deferred.push({
          room: "Exterior", areaId: null, what: `sweep: "${act.add.trim().slice(0, 50)}"`, count: 1,
          needs: "named in the final sweep — price it with the customer before send", kind: "custom_surface",
        });
        await flagSiteCheck();
      } else if (act.ans === "none") {
        sidesMeta = { ...sidesMeta, sweepAns: "none" };
      }
    }
    if (act.action === "sweep_item") {
      // Shed / Side gate price straight onto the extras block (STOP-item 1);
      // tapping again takes the line off. A card that can't price the code
      // falls back to the amber sweep flag — never a silent $0.
      const def = SWEEP_PRICED_CODES.find((c) => c.code === act.code)!;
      const r = rateFor((await ctxPromise).rateItems, act.code);
      if (!r && act.on) {
        sidesMeta = { ...sidesMeta, sweepAns: "added" };
        deferred.push({
          room: "Exterior", areaId: null, what: `sweep: "${def.label}"`, count: 1,
          needs: "named in the final sweep — price it with the customer before send", kind: "custom_surface",
        });
        await flagSiteCheck();
      } else if (r) {
        let nextSweep = Math.max(0, ...blocks.flatMap((b) => [
          Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
        ])) + 1;
        const res = toggleExtrasItem(blocks, def.code, def.label, act.on, () => nextSweep++, r.chargeOutDollars);
        if (res.ok) blocks = res.blocks as LooseBlock[];
        // The answer tracks the truth: something priced or flagged = "added";
        // taking the last priced item off re-opens the question (unless a
        // custom sweep flag already answered it).
        const anyPriced = SWEEP_PRICED_CODES.some((c) => hasExtrasItem(blocks, c.code));
        const anyFlagged = deferred.some((d) => d.what.startsWith("sweep:"));
        sidesMeta = { ...sidesMeta, sweepAns: anyPriced || anyFlagged ? "added" : sidesMeta.sweepAns === "added" ? null : sidesMeta.sweepAns };
      }
    }
    if (act.action === "confirm_loop_item") {
      const m = sidesMeta;
      const missing =
        // Extras is answered by "Nothing else", by any ticked freestanding
        // extra, or by a priced line on the Extras block — never demand the
        // explicit "Nothing else" over a real tick (Tom, 31 Aug).
        act.item === "extras" ? m.extrasAns == null && !hasFreestandingExtras(blocks)
          && !blocks.some((b) => /Exterior - Extras/i.test(String(b.name ?? "")) && (b.surfaces ?? []).length > 0)
        : act.item === "cond" ? m.cond.cond == null || m.cond.rot == null || m.cond.acc == null
        : act.item === "dw" ? m.dwOk !== true
        : m.sweepAns == null;
      if (missing) {
        return { error: "One question above still needs an answer — it's marked REQUIRED.", status: 400 };
      }
      sidesMeta = { ...sidesMeta, done: { ...m.done, [act.item]: true } };
    }

    // ---- R3: the interior confirm loop ---------------------------------------
    if (act.action === "iloop_sweep_cupboards") {
      let next = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0)])) + 1;
      const codes = new Set((await ctxPromise).rateItems.map((r) => r.code));
      const res = applyCupboardsEverywhere(blocks, act.kind, codes, () => next++);
      if (res.rooms === 0) return { error: "Tick the cupboard doors Yes in a room first — the insides follow that answer.", status: 400 };
      blocks = res.blocks;
      return null;
    }

    if (act.action === "room_size_ok" || act.action === "room_dims" || act.action === "room_cupboard" || act.action === "room_cupboard_interior" || act.action === "room_cupboard_door_inside"
      || act.action === "room_win_size" || act.action === "room_add_window_group" || act.action === "room_custom"
      || act.action === "room_add_catalogue" || act.action === "room_line_count" || act.action === "room_remove_line"
      || act.action === "confirm_room_loop") {
      let next = Math.max(0, ...blocks.flatMap((b) => [
        Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0),
      ])) + 1;
      const snapForWin = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
      let cupboardApplies = false;
      if (act.action === "confirm_room_loop") {
        const room = blocks.find((b) => b.kind === "area" && Number(b.id) === act.areaId);
        const cfg = CUPBOARD_BY_ROOM_TYPE[String(room?.roomType ?? "")];
        cupboardApplies = !!cfg && (await ctxPromise).rateItems.some((r) => r.code === cfg.code);
      }
      // Pre-apply dims, for the "wildly changed" test below.
      const dimsBefore = act.action === "room_dims"
        ? (({ L, W }) => ({ L: Number(L) || 0, W: Number(W) || 0 }))(blocks.find((b) => Number(b.id) === act.areaId) ?? {})
        : null;
      let catalogueLabel = "";
      let catalogueChargeOut: number | null = null;
      if (act.action === "room_add_catalogue") {
        // Only real Interior rate-card codes — the card, never the client,
        // decides what is priceable.
        const rateItems = (await ctxPromise).rateItems;
        const item = rateItems.find((r) => r.code === act.code && r.category === "Interior");
        if (!item) return { error: "That surface isn't on our rate card.", status: 422 };
        catalogueLabel = item.code;
        // Per-item charge-out (Air Vent $180/h × 0.25 h = $45) — without it
        // the engine bills the category rate and the price lands wrong. R5:
        // pinned ONLY where the row differs from its category base, so
        // widening the panel to ordinary rows can't override a staff hourly
        // rate. See lib/wizard/add-catalogue.perItemChargeOut.
        catalogueChargeOut = perItemChargeOut(rateItems, "Interior", item.code);
      }
      const result =
        act.action === "room_add_catalogue" ? addCatalogueLine(blocks, act.areaId, act.code, catalogueLabel, () => next++, catalogueChargeOut)
        : act.action === "room_line_count" ? applyLineCount(blocks, act.areaId, act.surfaceId, act.count)
        : act.action === "room_remove_line" ? removeLine(blocks, act.areaId, act.surfaceId)
        : act.action === "room_size_ok" ? applyRoomSizeOk(blocks, act.areaId)
        : act.action === "room_dims" ? applyRoomDims(blocks, act.areaId, act.lengthM, act.widthM)
        : act.action === "room_cupboard" ? applyCupboard(blocks, act.areaId, act.on, act.count, () => next++)
        : act.action === "room_cupboard_interior" ? applyCupboardInterior(blocks, act.areaId, act.on, act.count, () => next++)
        : act.action === "room_cupboard_door_inside" ? applyCupboardDoorInside(blocks, act.areaId, act.on, act.count, () => next++)
        : act.action === "room_win_size" ? applyRoomWindowSize(blocks, act.areaId, act.surfaceId, act.size)
        : act.action === "room_add_window_group" ? addRoomWindowGroup(blocks, act.areaId, snapForWin.success ? snapForWin.data : null, () => next++)
        : act.action === "room_custom" ? addRoomCustom(blocks, act.areaId, act.name)
        : confirmRoom(blocks, act.areaId, cupboardApplies);
      if (!result.ok) return { error: result.error, status: 400 };
      blocks = result.blocks as LooseBlock[];
      if (act.action === "room_dims") {
        // Only a WILDLY changed size gets human eyes at review (>25% on either
        // side) — quiet flag, never a block: the customer knows their house
        // better than the plan does, and routine nudges aren't suspicious.
        const after = blocks.find((b) => Number(b.id) === act.areaId) ?? {};
        const newL = Number(after.L) || 0;
        const newW = Number(after.W) || 0;
        const big = (oldV: number, newV: number) => oldV > 0 && Math.abs(newV - oldV) / oldV > 0.25;
        if (dimsBefore && (big(dimsBefore.L, newL) || big(dimsBefore.W, newW))) {
          deferred.push({
            room: String((after as { name?: unknown }).name ?? "Room"),
            areaId: act.areaId, what: "size corrected by customer", count: 1,
            needs: `customer set this room to ${newL} × ${newW} m (was ${dimsBefore.L} × ${dimsBefore.W}) — sanity-check at review`,
          });
        }
      }
      if (act.action === "room_custom") {
        deferred.push({
          room: String(blocks.find((b) => Number(b.id) === act.areaId)?.name ?? "Room"),
          areaId: act.areaId, what: `custom surface: "${act.name.trim().slice(0, 80)}"`, count: 1,
          needs: "price this WITH the customer — never silently", kind: "custom_surface",
        });
        await flagSiteCheck();
      }
    }
    if (act.action === "iloop_dw") interiorMeta = { ...interiorMeta, dwOk: act.ok ? true : null };
    if (act.action === "iloop_sweep") {
      if (act.add) {
        // Same rule as the exterior sweep: the NAME rides the amber flag, the
        // job routes to the visit tier — an unpriced area is never accepted.
        interiorMeta = { ...interiorMeta, sweepAns: "added" };
        deferred.push({
          room: "Interior", areaId: null, what: `sweep: "${act.add.trim().slice(0, 50)}"`, count: 1,
          needs: "named in the final sweep — price it with the customer before send", kind: "custom_surface",
        });
        await flagSiteCheck();
      } else if (act.ans === "none") {
        interiorMeta = { ...interiorMeta, sweepAns: "none" };
      }
    }
    if (act.action === "add_room") {
      // Adding a room IS the sweep's answer — it appears as a new amber card.
      interiorMeta = { ...interiorMeta, sweepAns: "added" };
    }
    if (act.action === "confirm_iloop_item") {
      const missing = act.item === "dw" ? interiorMeta.dwOk !== true : interiorMeta.sweepAns == null;
      if (missing) {
        return { error: "One question above still needs an answer — it's marked REQUIRED.", status: 400 };
      }
      interiorMeta = { ...interiorMeta, done: { ...interiorMeta.done, [act.item]: true } };
    }

    if (act.action === "remove_room") {
      const before = blocks.length;
      // The last room can't be removed - an empty tree prices at $0, and the
      // customer path would render a straight-faced $0-$0 range.
      if (blocks.filter((b) => b.kind === "area").length <= 1) {
        return { error: "That's the last room — an estimate needs at least one. Start again if this job is different.", status: 400 };
      }
      blocks = blocks.filter((b) => !(b.kind === "area" && Number(b.id) === act.areaId));
      if (blocks.length === before) return { error: "No such room.", status: 404 };
      // The room's open questions leave with it — otherwise they haunt the
      // review list and dock the accuracy score for a room that no longer
      // exists. Whole-job entries (areaId null) stay.
      newDeferred = deferred.filter((d) => d.areaId == null || d.areaId !== act.areaId);
    }

    return null;
  }

  /**
   * R5.1 (Tom, 20 Aug: "while it continually autosaves, it stops working, so
   * you can't add any further detail and you have to wait").
   *
   * Saves are serialized — they read-modify-write ONE builder_state row, so
   * they must be — and a round trip measured 3.4s on production. Three quick
   * taps therefore took fifteen seconds to appear, during which the customer
   * saw nothing happen, re-tapped, and generated duplicate-action errors.
   * Reproduced end to end before this change.
   *
   * So a request may now carry a BATCH: everything the customer tapped while
   * the last save was in flight arrives together and costs one round trip
   * instead of N. Order is preserved — these are edits to one document.
   *
   * A refusal mid-batch stops the batch but KEEPS what already applied: the
   * alternative is throwing away work the customer did because their fourth
   * tap was a duplicate. The refusal still reaches them, alongside the
   * authoritative state, so the screen reconciles either way.
   */
  let refusal: ActionRefusal | null = null;
  let applied = 0;
  for (const one of actions) {
    refusal = await applyAction(one);
    if (refusal) break;
    applied++;
  }
  // Nothing survived — answer as the single-action route always did.
  if (refusal && applied === 0) {
    return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }

  // Tom, 7 Sep: after every edit the engine's per-room allowances follow the
  // scope — untick a room's walls and its ceilings-only allowance appears.
  {
    const tierSnap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
    let allowId = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0)])) + 1;
    blocks = reconcileRoomAllowances(blocks as unknown as AllowanceBlock[], { tier: tierSnap.success ? tierSnap.data.condition.tier : null, rateItems: (await ctxPromise).rateItems }, () => allowId++).blocks as unknown as LooseBlock[];
  }
  const newState = { ...state, blocks, aiDeferred: newDeferred, sidesLoop: sidesMeta, interiorLoop: interiorMeta };
  const { error: writeError } = await db
    .from("estimates")
    .update({ builder_state: newState })
    .eq("id", id);
  if (writeError) {
    reportError(writeError, { where: "wizard.edit.update", extra: { id, actions: actions.map((a) => a.action) } });
    return NextResponse.json({ error: `Couldn't save the change: ${writeError.message}` }, { status: 500 });
  }
  if (storeyHeights) {
    await db.from("estimates").update({ storey_heights: storeyHeights }).eq("id", id)
      .then(() => undefined, () => undefined);
  }

  const ctx = await ctxPromise;
  // R5: score against the loop the customer has just moved — this very
  // action may be the confirmation that lifts the ring.
  const loopState = loopConfirmState(blocks, interiorMeta, sidesMeta);
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(newState), newDeferred, loopState);
  // Tom, 7 Sep: keep the list's price in step with every edit (best-effort).
  await db.from("estimates").update({ total_cents: payload.totals.totalCents }).eq("id", id)
    .then(() => undefined, () => undefined);

  /**
   * THE LADDER, EVALUATED ONCE, AFTER THE EDITS (C7).
   *
   * Two callers now need the server's verdict on this request: the customer
   * view, which has always recomputed it, and `fix_online`, which must ask
   * *at the moment of the tap* whether this job may still be fixed online.
   *
   * Memoised rather than called twice on purpose. Two evaluations of the one
   * ladder in one request is precisely the bug class phase 0 spent C1 and C2
   * removing — and here they would straddle a write, so the second could
   * legitimately disagree with the first and nobody would be wrong.
   */
  let decisionMemo: Promise<GuardrailDecision> | null = null;
  const ladderDecision = () => (decisionMemo ??= (async () => {
    const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
    const answers = snap.success
      ? answersFromState(snap.data)
      : answersFromState({ jobType: "interior", details: { damageTier: 1 }, customer: null });
    // Same trade relaxation as submit + the scope page, decided from the
    // estimate's own linked account — one rule, three evaluation sites.
    let tradeActor = false;
    const estAccountId = (estimate as { account_id?: string | null }).account_id;
    if (estAccountId) {
      const { data: acct } = await db.from("accounts").select("account_type").eq("id", estAccountId).maybeSingle();
      tradeActor = (acct as { account_type?: string } | null)?.account_type === "trade";
    }
    return evaluateGuardrails(
      answers,
      payload.totals.totalCents,
      payload.accuracyPct,
      siteCheck, // live — this very action may have flagged the visit tier
      policyFromSettings(settingValue(ctx.settings, "wizard_policy")),
      serviceAreaFromSettings(settingValue(ctx.settings, "service_area")),
      tradeActor,
    );
  })());

  /**
   * C7 — "FIX MY PRICE ONLINE", decided by the SERVER at the tap.
   *
   * The door the customer tapped was drawn from a payload that may be minutes
   * old, and in those minutes they may have flagged a spot, added a room or
   * moved the job over the cap — any of which takes self-serve away. A client
   * that asks to fix a price it is no longer allowed to fix is not an attack
   * and not an error; it is a stale screen, and the only honest answer is the
   * one a person would give: of course, we'll just have someone confirm it.
   *
   * So a refused fix is NOT a 4xx. It becomes the ordinary confirmation
   * request — the promise is still made, the estimator still gets the job —
   * and the response says which way it went so the screen can tell the truth.
   */
  let fixedOnline: { priceCents: number; heldUntil: string; holdDays: number } | null = null;
  let fixDeclined = false;
  /** Set when the price was ALREADY fixed — a second tap, not a second price. */
  let fixRepeated = false;
  if (fixOnlineIntent) {
    /**
     * ALREADY FIXED IS NOT FIXED AGAIN.
     *
     * `confirmation_requests_open_per_estimate` deliberately excludes the
     * terminal statuses so a job CAN come back for a second look later — which
     * means it does not stop a second `fixed` row either. Without this check a
     * double tap, or a reload and a re-tap, would write a second fixed price
     * and re-stamp `valid_until`, quietly extending a hold the customer had
     * already been given. Same rule as the estimator's route in C6: a repeat of
     * the producing action returns what it produced.
     */
    const { data: already } = await db.from("confirmation_requests")
      .select("fixed_price_cents")
      .eq("estimate_id", id).eq("kind", "fix_online").eq("status", "fixed")
      .order("fixed_at", { ascending: false }).limit(1).maybeSingle();
    const priorCents = (already as { fixed_price_cents?: number | null } | null)?.fixed_price_cents ?? null;
    if (priorCents != null) {
      const { data: est } = await db.from("estimates").select("valid_until").eq("id", id).maybeSingle();
      const holdDays = holdDaysFromSettings(settingValue(ctx.settings, "wizard_hold_days"));
      fixedOnline = {
        priceCents: priorCents,
        heldUntil: ((est as { valid_until?: string | null } | null)?.valid_until) ?? holdUntil(new Date(), holdDays),
        holdDays,
      };
      fixRepeated = true;
      fixOnlineIntent = false;
    }
  }
  if (fixOnlineIntent) {
    // The ONE ladder answers it — not three lines copied into a route.
    if (!mayFixOnline(await ladderDecision())) {
      fixDeclined = true;
      confirmationIntent = "remote";
    } else {
      const holdDays = holdDaysFromSettings(settingValue(ctx.settings, "wizard_hold_days"));
      const price = priceToFix({ centralCents: payload.totals.totalCents });
      if (!price.ok) {
        // Nothing to fix. Same kindness: a person looks at it.
        fixDeclined = true;
        confirmationIntent = "remote";
      } else {
        const heldUntil = holdUntil(new Date(), holdDays);
        fixedOnline = { priceCents: price.cents, heldUntil, holdDays };
        // The hold LIVES on the estimate — `valid_until` is what the daily
        // lapse sweep reads (20270121). A hold recorded only on the
        // confirmation row would be a promise nothing enforced.
        await db.from("estimates").update({ valid_until: heldUntil }).eq("id", id)
          .then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.hold", bestEffort: true }); });
        confirmationIntent = "fix_online";
      }
    }
  }

  /**
   * C5 — the qualified lead becomes a row.
   *
   * `prepPack` keeps its own job (removed substrates and flags for the visit's
   * capture verify mode); what changed is that the QUEUE no longer keys off it.
   * This is the record of the promise: what we said we would do, what the rules
   * suggested, whose patch it is, and the pack exactly as it stood when the
   * customer was told a person would look.
   *
   * Best-effort by the same rule as the rest of this route: a failed insert
   * must not lose the customer's action. But it IS reported — a promise we did
   * not record is a customer waiting for a call nobody scheduled, which is the
   * exact failure §2.6 exists to stop.
   */
  if (confirmationIntent) {
    try {
      const deskPolicy = policyFromSettings(settingValue(ctx.settings, "wizard_policy"));
      /**
       * The ROW matters more than the frozen pack. An estimate whose wizard
       * state will not parse still has a customer waiting for a call, and
       * throwing here would have skipped the promise entirely to protect a
       * nice-to-have — the failure mode this whole chunk exists to stop.
       */
      const snapForPack = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
      const pack = snapForPack.success ? deskCheckPack(blocks, snapForPack.data, {
        totalCents: payload.totals.totalCents,
        rules: await loadScopeRules(db),
        deferred: newDeferred,
        policy: deskPolicy,
        systems: paintSystemsFrom(settingValue(ctx.settings, PAINT_SYSTEMS_KEY)),
      }) : null;
      const postcode = snapForPack.success ? (snapForPack.data.customer?.postcode ?? null) : null;
      const { data: staffRows } = await db.from("profiles")
        .select("id, patch_postcodes").not("patch_postcodes", "is", null);
      const draft = pack ? confirmationDraft({
        pack,
        postcode,
        staff: ((staffRows ?? []) as Array<{ id: string; patch_postcodes: string[] | null }>)
          .map((r) => ({ id: r.id, postcodes: r.patch_postcodes ?? [] })),
        requestedBy: view === "customer" ? "customer" : "staff",
      }) : { kind: "visit" as const, suggestedAction: "visit" as const, assignedTo: null, why: "we could not read the scope, so a person looks" };
      // The customer asked for a visit: that is what they get, whatever the
      // ladder would have allowed. Their choice outranks our eligibility.
      // A fix the ladder just allowed is its own kind and is already done.
      /**
       * Annotated, not inferred: `confirmationIntent` is also assigned inside
       * `applyAction`, which TypeScript's control-flow analysis does not
       * follow, so at this point it believes "visit" is impossible and calls
       * the test below unreachable. It is not — a booked visit reaches here
       * on every run. The annotation restores the type the variable actually
       * has rather than silencing the check with a cast.
       */
      const intent = readIntent();
      const kind = intent === "visit" ? "visit"
        : intent === "fix_online" ? "fix_online"
        : draft.kind;
      /**
       * C10 (v2.5) — the hazmat check goes on the estimator's site checklist at
       * confirmation, where a trained person makes the call. It replaced the
       * asbestos / lead hard stop on the customer path: the customer is not
       * asked, the answers default to unsure, and every price is confirmed by
       * a person before acceptance. Idempotent on (estimate, key).
       */
      await db.from("site_checklist_items").upsert(
        { estimate_id: id, key: "hazmat_check", value: "customer not asked — check age of paintwork and any sheeting before work starts", source: "wizard" },
        { onConflict: "estimate_id,key" },
      ).then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.siteChecklist", bestEffort: true }); });
      const { error: crError } = await db.from("confirmation_requests").insert({
        estimate_id: id,
        requested_by: view === "customer" ? "customer" : "staff",
        kind,
        /**
         * A fix online lands `fixed`, not `requested`. It is not a job for the
         * queue — the price IS fixed, by the same ladder an estimator would
         * have applied, and putting it in the queue as outstanding work would
         * have an estimator ring a customer to confirm a number that is
         * already confirmed. The row still exists so the four Phase 1 metrics
         * can count it: it is the denominator of "share fixed without a visit".
         */
        status: fixedOnline ? "fixed" : "requested",
        fixed_price_cents: fixedOnline?.priceCents ?? null,
        fixed_at: fixedOnline ? new Date().toISOString() : null,
        suggested_action: fixedOnline ? "fix" : draft.suggestedAction,
        assigned_to: draft.assignedTo,
        pack: (pack ?? {}) as unknown as Record<string, unknown>,
      });
      // 23505 = the one-open-request-per-estimate index. A double tap is not an
      // error: the promise already exists and one is what we want — and the
      // CRM event is skipped with it, so a second tap does not double the
      // customer's timeline.
      if (crError && crError.code !== "23505") {
        reportError(crError, { where: "wizard.edit.confirmationRequest", extra: { id, kind } });
      } else if (!crError) {
        await logCrmEvent(db, {
          type: "confirmation_requested",
          accountId: (estimate as { account_id?: string | null } | null)?.account_id ?? null,
          estimateId: id,
          source: view === "customer" ? "customer" : "staff",
          payload: {
            kind,
            suggested: draft.suggestedAction,
            totalCents: payload.totals.totalCents,
            assigned: draft.assignedTo != null,
          },
        }).catch((e) => reportError(e, { where: "wizard.edit.confirmationEvent", bestEffort: true }));
        /**
         * C7 — a price fixed online is a `price_fixed` event too, exactly as
         * an estimator's desk fix is (C6). Same event, same shape, one `kind`
         * apart: without it "share fixed without a visit" would count only the
         * fixes a person made and miss every one the ladder made, which is the
         * number the whole self-serve door exists to move.
         */
        if (fixedOnline) {
          await logCrmEvent(db, {
            type: "price_fixed",
            accountId: (estimate as { account_id?: string | null } | null)?.account_id ?? null,
            estimateId: id,
            source: view === "customer" ? "customer" : "staff",
            payload: { totalCents: fixedOnline.priceCents, kind: "fix_online" },
          }).catch((e) => reportError(e, { where: "wizard.edit.priceFixedEvent", bestEffort: true }));
        }
      }
    } catch (e) {
      reportError(e, { where: "wizard.edit.confirmationRequest", bestEffort: true, extra: { id } });
    }
  }

  if (view === "customer") {
    // The customer's view recomputes the range and the acceptance verdict —
    // their confirmations tighten the band but never bypass the guardrails.
    // Branching on view (not actor) is the R1.1 contract: staff previews of
    // customer surfaces exercise the exact payload a customer receives.
    // The same verdict `fix_online` was judged against — memoised above, so a
    // fixed price and the payload that reports it can never disagree.
    const decision = await ladderDecision();
    // Same rule as submit: a blocking outcome means NO price crosses the
    // wire - edits can move a job across a guardrail (e.g. under the floor)
    // and the edit path must honour that, not keep revealing the range.
    if (decision.outcome !== "reveal") {
      return NextResponse.json({
        outcome: decision.outcome,
        message: GUARDRAIL_MESSAGES[decision.outcome] ?? GUARDRAIL_MESSAGES.handoff,
      });
    }
    // Part B telemetry: which substrates customers remove and where they say
    // "not sure" feeds preset tuning. Best-effort, never blocks the edit.
    // Real customers only — a staff preview must not pollute preset tuning.
    // R5.1: a batch carries several edits — record EVERY one of them, or the
    // preset tuning silently loses whatever a customer did quickly.
    const tracked = actions
      .slice(0, applied)
      .filter((a) => a.action === "toggle_surface" || a.action === "add_note" || a.action === "flag_geometry");
    if (actor.kind === "customer" && tracked.length) {
      await db.from("estimate_events").insert(
        tracked.map((a) => ({
          estimate_id: id,
          type: "scope_edit",
          payload: { action: a.action, ...(a.action === "toggle_surface" ? { key: a.key, on: a.on } : {}) },
        })),
      ).then((r) => { if (r.error) reportError(r.error, { where: "wizard.edit.telemetry", bestEffort: true }); });
    }

    // The editor's tile grids re-derive from the tree + the same scope rules
    // that drive capture — one source of truth, mode="customer".
    // R5: reference data, cached per process — it was re-read on every tap.
    const rules = await loadScopeRules(db);
    // B2: the sign-off ladder — thresholds are Settings values (defaults
    // $6k interior / $12k exterior at ≥90%), and the visit tier is an offer,
    // never a block. Slots recompute server-side so booking can validate.
    const bands = bandsFromSettings(settingValue(ctx.settings, "wizard_bands"));
    const cp = customerPayload(payload, blocks, decision, bands);
    const flags = (settingValue(ctx.settings, "scope_editor") ?? {}) as { visitSlots?: string[] };
    const hasExterior = blocks.some((b) => b.kind === "area" && b.type === "Exterior");
    const wizSnap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
    return NextResponse.json({
      ...cp,
      // A batch that stopped part-way saved what applied; the refusal rides
      // WITH the authoritative state so the screen reconciles and the
      // customer still hears why the last tap didn't take.
      ...(refusal ? { error: refusal.error, appliedCount: applied } : {}),
      /**
       * C7 — what actually happened to a "fix my price online" tap.
       *
       * `fixedOnline` carries the figure and the date it is held to, so the
       * screen states a promise the server has already written down rather
       * than one it computed itself. `fixDeclined` is the stale-client case:
       * the tap arrived, the ladder said no, and a confirmation request was
       * made instead — the screen apologises for nothing and says what will
       * happen. Both are absent on every other action.
       */
      ...(fixedOnline ? { fixedOnline, ...(fixRepeated ? { repeated: true } : {}) } : {}),
      ...(fixDeclined ? { fixDeclined: true } : {}),
      scopeRooms: customerScopeRooms(blocks, rules),
      // C10: what each room's extras row shows back, read off the deferrals.
      roomExtras: Object.fromEntries(blocks.filter((b) => b.kind === "area").map((b) => [String(b.id), roomExtrasView(newDeferred, Number(b.id))])),
      // Phase 4: the derived systems, recomputed from the tree that this
      // request just changed. It rides EVERY response, not only a
      // set_paint_system one — removing the last ceiling has to remove the
      // ceilings line, and that arrives as a toggle_surface.
      paintSystems: (() => {
        const sn = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
        return sn.success
          ? paintSystemsView(sn.data, blocks, paintSystemsFrom(settingValue(ctx.settings, PAINT_SYSTEMS_KEY)))
          : [];
      })(),
      // §4.5 — what is on, read off the TREE so the estimator's own edits win.
      jobExtras: (() => {
        const sn = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
        return {
          on: blocks
            .filter((b) => String(b.name ?? "").toLowerCase() === "interior - extras")
            .flatMap((b) => (b.surfaces ?? []))
            .map((x) => String(x.code ?? "")),
          colourHelp: sn.success ? sn.data.paint.colourHelp === "advice" : false,
          note: sn.success ? String(sn.data.details.extraNote ?? "") : "",
        };
      })(),
      // §4.4 — the answers as stored, so the card reconciles with the server.
      siteAccess: (() => {
        const sn = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
        return sn.success ? (sn.data.details.siteAccess ?? {}) : {};
      })(),
      exterior: customerExteriorView(blocks),
      // R2b: the sides confirm loop's full view (null when no sides exist).
      sides: sidesView(blocks, sidesMeta, extrasPrices(ctx.rateItems),
        wizSnap.success ? (wizSnap.data.exterior?.storeys ?? null) : null,
        exteriorAddOptions(ctx.rateItems), wallOptionsFromRates(ctx.rateItems), hoursPerItemCodes(ctx.rateItems),
        linealCodes(ctx.rateItems)),
      // R3: the interior confirm loop — rooms joined by areaId, plus the
      // totals check and sweep state. Cupboard questions are data-driven off
      // the live rate card.
      interiorLoop: {
        rooms: roomLoopViews(blocks, new Set(ctx.rateItems.map((r) => r.code))),
        dw: { ...interiorDwTotals(blocks), ok: interiorMeta.dwOk },
        meta: interiorMeta,
        progress: interiorProgress(blocks, interiorMeta),
        // R5: the add-surface panel offers EVERY interior surface the live
        // card can price, not just the one row filed under Extras.
        catalogue: interiorAddOptions(ctx.rateItems),
      },
      // C11: the visit tier names its reason (custom > peeling > rot >
      // flagged > big) — the sticky line renders the mockup's wording.
      // ONE ladder (C1): tier + self-serve + reason + the
      // next unlock, from the same decision the guardrails already made.
      ladder: ladderFor({
        accuracyPct: payload.accuracyPct, decision, bands,
        sidesMeta, deferred: newDeferred, hasExterior,
        hasPlan: wizSnap.success ? (wizSnap.data.planRunIds.length > 0 || Boolean(wizSnap.data.listingUrl?.trim())) : false,
        pendingAreas: [...loopState.states.values()].filter((v) => v === "pending").length,
        visitSlots: (await wizardVisitSlots(db, flags)).labels,
      }),
    });
  }

  return NextResponse.json(payload);
}
