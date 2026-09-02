/**
 * THE QUESTION GRAPH (assistant brief §4, Addendum A §3.1).
 *
 * "The question order is data, not prose." A deterministic function decides
 * what is asked next; the model phrases it. Same inputs → same order.
 *
 * Generated, not hand-written: the per-area questions come from the editors'
 * required-question registry (lib/wizard/required-questions.ts — the same
 * list confirmRoom/confirmSide gate on) and from `room_type_scope_rules`;
 * the global ones follow the wizard page order; the sweep mirrors the loop
 * metas (doors & windows check, missed rooms/sides, per-area confirm).
 *
 * Ordering rules (tested):
 *   1. A hard stop outranks everything.
 *   2. Required before tightening before recommended before confirm.
 *   3. Within required: qualification → interior intake → interior loop
 *      (hallway first) → interior globals → exterior intake → sides loop
 *      (front, left, right, back) → exterior globals. A both-job's interior
 *      questions all precede its exterior ones.
 *   4. Tightening gaps (Addendum A) by $ swing, largest first — the swing is
 *      supplied by price_scope (A1); unknown swings keep definition order.
 *   5. Confirm gaps are asked at most once, in the sweep, last.
 *   6. Known ≠ asked: a value already in the tree (plan-read sizes, wizard
 *      answers, account records) is never a required gap.
 */

import type { WizardState } from "@/lib/wizard/state";
import { CUPBOARD_BY_ROOM_TYPE, CUPBOARD_INTERIOR_BY_ROOM_TYPE, type InteriorLoopMeta } from "@/lib/wizard/rooms-loop";
import { SIDE_KEYS, SIDE_LABEL, findSide, isWallLine, wallSumPct, type SideKey, type SidesLoopMeta, type LooseBlock as SideBlock } from "@/lib/wizard/sides";
import {
  ROOM_REQUIRED_QUESTIONS, SIDE_REQUIRED_QUESTIONS,
  type RoomRequiredQuestion, type SideRequiredQuestion,
} from "@/lib/wizard/required-questions";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import type { ScopeRule } from "@/lib/extract/scope";
import type { Gap } from "./schemas";

export type GraphBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string; areaType?: string; roomType?: string;
  L?: number; W?: number; origin?: unknown; assumedFields?: unknown;
  surfaces?: Array<Record<string, unknown> & { id?: number; code?: string; count?: number; origin?: unknown; sizeBand?: unknown }>;
  customer?: { size?: "yes" | "adjusted" | "ns" | null; cup?: boolean | null; cupInterior?: boolean | null; include?: boolean | null; confirmed?: boolean; surfacesOk?: boolean };
  customerCustom?: string[];
};

export type GraphFacts = {
  /** Service-area check result; null = not yet checked. */
  inServiceArea: boolean | null;
  /** asap | 1-3 months | just pricing — informational, CRM temperature. */
  timing: string | null;
  /** "Will anyone be living there while we paint?" */
  occupied: boolean | null;
  /** Email from any source (account, wizard, conversation). */
  email: string | null;
  /** "Anything tricky about access?" answered — including "no" (the wizard
   *  state cannot tell an unasked question from an empty answer). */
  accessAnswered?: boolean;
};

export type GraphInput = {
  mode: "guided" | "cowork";
  accountType: "residential" | "trade" | null;
  state: Partial<WizardState> | null;
  blocks: GraphBlock[];
  interior: InteriorLoopMeta | null;
  sides: SidesLoopMeta | null;
  scopeRules: ScopeRule[];
  /** Codes on the active rate card — cupboard questions are data-driven. */
  rateCodes: ReadonlySet<string>;
  facts: GraphFacts;
  /** A1: assumption key → $ swing in cents, from price_scope. */
  swings?: Record<string, number>;
  /** Test seam: the editors' registries (defaults to the real ones). */
  requiredQuestions?: { room: ReadonlyArray<RoomRequiredQuestion>; side: ReadonlyArray<SideRequiredQuestion> };
};

export const KIND_RANK: Record<Gap["kind"], number> = { required: 0, tightening: 1, recommended: 2, confirm: 3 };

/** Phase = where in the wizard order the question sits. */
export const PHASE = {
  stop: 0, qual: 1, intIntake: 2, intLoop: 3, intGlobal: 4, extIntake: 5, extLoop: 6, extGlobal: 7, sweep: 8,
} as const;
type Phase = (typeof PHASE)[keyof typeof PHASE];

type Candidate = Gap & { phase: Phase; areaRank: number; idx: number };

const isRoom = (b: GraphBlock) => b.kind === "area" && b.type !== "Exterior" && b.areaType !== "surface" && !b.isOption;
const isHallway = (b: GraphBlock) => String(b.roomType ?? "") === "hallway" || /\b(hall|entry|passage)/i.test(String(b.name ?? ""));

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

export function gapsFor(input: GraphInput): Gap[] {
  const out: Candidate[] = [];
  let idx = 0;
  const add = (phase: Phase, areaRank: number, g: Omit<Gap, "areaId" | "swingCents" | "writes"> & Partial<Pick<Gap, "areaId" | "swingCents" | "writes">>) => {
    out.push({
      areaId: null, swingCents: null, writes: [{ tool: "answer_gap", input: { key: g.key } }],
      ...g, phase, areaRank, idx: idx++,
    });
  };
  const swing = (key: string, fallbackKey?: string) => input.swings?.[key] ?? (fallbackKey ? input.swings?.[fallbackKey] : undefined) ?? null;

  const st = input.state ?? {};
  const cust = st.customer ?? null;
  const jobType = st.jobType ?? null;
  const wantsInterior = jobType === "interior" || jobType === "both";
  const wantsExterior = jobType === "exterior" || jobType === "both";
  const rooms = input.blocks.filter(isRoom);
  const floorplan = (st.planRunIds?.length ?? 0) > 0;
  const registry = input.requiredQuestions ?? { room: ROOM_REQUIRED_QUESTIONS, side: SIDE_REQUIRED_QUESTIONS };

  // ---- 1. hard stops — code, not judgement (§2 rule 5) ----------------------
  const pre1970 = cust?.builtPre1970 === "yes";
  const leadInterior = wantsInterior && pre1970 && (st.details?.damageTier ?? 0) >= 2;
  const leadExterior = wantsExterior && pre1970 && st.exterior?.condition === "peeling";
  if (leadInterior || leadExterior) {
    add(PHASE.stop, 0, { key: "stop.lead_paint", kind: "required", acceptsNotSure: false,
      phrasingHint: "Peeling or damaged paint on a pre-1970s home — the lead-paint script applies; the job goes to a site visit.",
      writes: [{ tool: "hard_stop", input: { kind: "lead_paint" } }] });
  }
  if (cust?.asbestosSuspected === "yes") {
    add(PHASE.stop, 0, { key: "stop.asbestos", kind: "required", acceptsNotSure: false,
      phrasingHint: "Asbestos suspected — the asbestos script applies.", writes: [{ tool: "hard_stop", input: { kind: "asbestos" } }] });
  }
  if (cust?.heritageListed === "yes") {
    add(PHASE.stop, 0, { key: "stop.heritage", kind: "required", acceptsNotSure: false,
      phrasingHint: "Heritage overlay mentioned — the heritage script applies; visit tier.", writes: [{ tool: "hard_stop", input: { kind: "heritage" } }] });
  }
  if (input.facts.inServiceArea === false) {
    add(PHASE.stop, 0, { key: "stop.out_of_area", kind: "required", acceptsNotSure: false,
      phrasingHint: "The address is outside the service area — the out-of-area script applies.", writes: [{ tool: "hard_stop", input: { kind: "out_of_area" } }] });
  }

  // ---- 2. qualification (§4 steps 1–6, always first) -------------------------
  const hasAddress = Boolean(st.address?.suburb || cust?.suburb || cust?.postcode);
  if (!hasAddress) add(PHASE.qual, 0, { key: "q.address", kind: "required", acceptsNotSure: false, phrasingHint: "What's the address of the property?" });
  if (hasAddress && input.facts.inServiceArea == null) add(PHASE.qual, 0, { key: "q.service_area", kind: "required", acceptsNotSure: false, phrasingHint: "Check the address against the service area before going on.", writes: [{ tool: "answer_gap", input: { key: "q.service_area", action: "service_area_check" } }] });
  if (input.accountType == null) add(PHASE.qual, 0, { key: "q.account_type", kind: "required", acceptsNotSure: false, phrasingHint: "Is this for your own home, or are you a business or trade client?" });
  if (jobType == null) add(PHASE.qual, 0, { key: "q.job_type", kind: "required", acceptsNotSure: false, phrasingHint: "Inside, outside, or both?" });
  if (!cust?.propertyKind) add(PHASE.qual, 0, { key: "q.property_type", kind: "required", acceptsNotSure: false, phrasingHint: "Is it a house, townhouse, unit or a commercial building?" });
  // The hard stops depend on these (§2 rule 5) — asked once, up front.
  if (cust?.propertyKind && (cust.builtPre1970 == null || cust.heritageListed == null || cust.bodyCorporate == null || cust.asbestosSuspected == null)) {
    add(PHASE.qual, 0, { key: "q.property_flags", kind: "required", acceptsNotSure: true, phrasingHint: "Quick checks: was it built before 1970, is it heritage-listed, is there a body corporate, and any chance of asbestos? \"Not sure\" is fine for any of them." });
  }
  const storeysKnown = (wantsInterior && (floorplan || st.basics?.storeys != null)) || (wantsExterior && st.exterior != null);
  if (jobType != null && !storeysKnown) add(PHASE.qual, 0, { key: "q.storeys", kind: "required", acceptsNotSure: false, phrasingHint: "Single storey or double?" });
  if (input.facts.timing == null) add(PHASE.qual, 0, { key: "q.timing", kind: "recommended", acceptsNotSure: true, phrasingHint: "When are you hoping to have it done — soon, in the next few months, or just pricing for now?" });
  const email = input.facts.email || cust?.email || st.contact?.email || "";
  if (!email.trim()) add(PHASE.qual, 0, { key: "q.email", kind: "required", acceptsNotSure: false, phrasingHint: "Where should I send the estimate? An email is all I need for now." });

  // ---- 3. interior ------------------------------------------------------------
  if (wantsInterior) {
    if ((st.surfaces?.length ?? 0) === 0 && rooms.length === 0) {
      add(PHASE.intIntake, 0, { key: "job.surfaces", kind: "required", acceptsNotSure: false,
        phrasingHint: "What are we painting inside — walls, ceilings, trim, doors, windows?",
        writes: [{ tool: "answer_gap", input: { key: "job.surfaces", action: "surfaces" } }] });
    }
    if (!floorplan && rooms.length === 0 && !st.basics) {
      add(PHASE.intIntake, 0, { key: "rooms", kind: "required", acceptsNotSure: false,
        phrasingHint: "How many bedrooms and bathrooms, or upload a floorplan and I'll read the rooms off it.",
        writes: [{ tool: "answer_gap", input: { key: "rooms", action: "basics" } }] });
    }

    // Room loop — hallway forced first, then tree order.
    const ordered = [...rooms].sort((a, b) => Number(isHallway(b)) - Number(isHallway(a)));
    ordered.forEach((room, rank) => {
      const areaId = Number(room.id) || 0;
      const roomType = String(room.roomType ?? "");
      const name = String(room.name ?? "this room");
      const cupCfg = CUPBOARD_BY_ROOM_TYPE[roomType];
      const ctx = { cupboardApplies: !!cupCfg && input.rateCodes.has(cupCfg.code) };
      const vars = { room: name, L: Number(room.L) || "?", W: Number(room.W) || "?" };

      for (const q of registry.room) {
        if (!q.applies(room, ctx) || q.answered(room, ctx)) continue;
        const known = q.knownFrom?.(room, ctx) ?? false;
        add(known ? PHASE.sweep : PHASE.intLoop, rank, {
          key: `room.${areaId}.${q.key}`, areaId, kind: known ? "confirm" : "required", acceptsNotSure: q.acceptsNotSure,
          phrasingHint: fill(q.phrasing, vars),
          writes: [{ tool: "answer_gap", input: { key: `room.${areaId}.${q.key}`, action: q.action, areaId } }],
        });
      }

      // What are we painting — from the scope rules for this room type.
      const rules = input.scopeRules.filter((r) => r.room_type === roomType && !r.is_option);
      const surfaces = room.surfaces ?? [];
      if (surfaces.length === 0) {
        add(PHASE.intLoop, rank, { key: `room.${areaId}.surfaces`, areaId, kind: "required", acceptsNotSure: false,
          phrasingHint: `What are we painting in the ${name} — walls, ceiling, trim, doors, windows?`,
          writes: [{ tool: "answer_gap", input: { key: `room.${areaId}.surfaces`, action: "room_add_catalogue", areaId } }] });
      } else if (rules.length > 0 && !room.customer?.confirmed && room.customer?.surfacesOk !== true) {
        add(PHASE.sweep, rank, { key: `room.${areaId}.surfaces`, areaId, kind: "confirm", acceptsNotSure: false,
          phrasingHint: `${name}: ${rules.map((r) => r.surface_type.toLowerCase()).join(", ")} — right?` });
      }

      // Tightening: cupboard interiors (Addendum A §3.1) — data-driven on the card.
      const intCfg = CUPBOARD_INTERIOR_BY_ROOM_TYPE[roomType];
      if (intCfg && input.rateCodes.has(intCfg.code) && room.customer?.cupInterior == null) {
        const key = `room.${areaId}.cupboard_interiors`;
        add(PHASE.intLoop, rank, { key, areaId, kind: "tightening", acceptsNotSure: false, phrasingHint: intCfg.question,
          swingCents: swing(key, "cupboard_interiors"),
          writes: [{ tool: "answer_gap", input: { key, action: "room_cupboard_interior", areaId } }] });
      }

      if (!room.customer?.confirmed && room.customerCustom == null) {
        add(PHASE.intLoop, rank, { key: `room.${areaId}.anything_else`, areaId, kind: "recommended", acceptsNotSure: true,
          phrasingHint: `Anything else in the ${name} we should know about?`,
          writes: [{ tool: "answer_gap", input: { key: `room.${areaId}.anything_else`, action: "room_custom", areaId } }] });
      }
    });

    // Interior globals — wizard page order (condition → details → extras → paint).
    if (!st.condition?.tier) add(PHASE.intGlobal, 0, { key: "condition.tier", kind: "required", acceptsNotSure: false, phrasingHint: "Is it a freshen-up in the same colour, a change of colour, or going from dark to light?" });
    const damageTier = st.details?.damageTier;
    if (damageTier == null) add(PHASE.intGlobal, 0, { key: "condition.damage", kind: "required", acceptsNotSure: false, phrasingHint: "How are the surfaces — good, a few minor cracks or marks, a few areas of concern, or in real need of repair?" });
    const photos = st.details?.damagePhotoCount ?? 0;
    if (damageTier != null && damageTier >= 2 && photos === 0) {
      add(PHASE.intGlobal, 0, { key: "condition.photos", kind: "required", acceptsNotSure: false, phrasingHint: "A quick phone photo of each damaged area, please — prep at this level needs to be seen.", writes: [{ tool: "attach_document", input: { kind: "photo" } }] });
    } else if (damageTier === 1 && photos === 0) {
      add(PHASE.intGlobal, 0, { key: "condition.photos", kind: "tightening", acceptsNotSure: true, phrasingHint: "A photo of the cracks would let me price the prep instead of allowing for it.", swingCents: swing("condition.photos"), writes: [{ tool: "attach_document", input: { kind: "photo" } }] });
    }
    if (input.facts.occupied == null) add(PHASE.intGlobal, 0, { key: "occupied", kind: "required", acceptsNotSure: false, phrasingHint: "Will anyone be living in the home while we paint?" });

    const ticked = new Set(st.surfaces ?? []);
    const ds = st.details?.doorStyle;
    if (ticked.has("doors") && (ds == null || ds === "unsure")) add(PHASE.intGlobal, 0, { key: "door_style", kind: "tightening", acceptsNotSure: true, phrasingHint: "Are the doors mostly flat, or panelled?", swingCents: swing("door_style") });
    const ws = st.details?.windowStyle;
    if (ticked.has("windows") && (ws == null || ws === "unsure")) add(PHASE.intGlobal, 0, { key: "window_style", kind: "tightening", acceptsNotSure: true, phrasingHint: "What type are the windows — casement, sash, colonial or winder?", swingCents: swing("window_style") });
    const ch = st.details?.ceilingHeight;
    if (ch == null || ch === "unsure") add(PHASE.intGlobal, 0, { key: "ceiling_height", kind: "tightening", acceptsNotSure: true, phrasingHint: "Standard 2.4 m ceilings, or higher?", swingCents: swing("ceiling_height") });
    if ((st.paint?.brands?.length ?? 0) === 0) add(PHASE.intGlobal, 0, { key: "paint.brand", kind: "recommended", acceptsNotSure: true, phrasingHint: "Any preference on paint brand?" });
    if (st.paint?.colourHelp == null) add(PHASE.intGlobal, 0, { key: "paint.colours", kind: "tightening", acceptsNotSure: true, phrasingHint: "Do you know the colours you want, or would you like a colour match to what's there?", swingCents: swing("paint.colours") });

    // Interior sweep.
    if (input.interior) {
      const hasOpenings = rooms.some((r) => (r.surfaces ?? []).some((s) => ["doors", "windows"].includes(substrateKeyForRateCode(String(s.code ?? "")) ?? "")));
      if (!input.interior.done.dw && hasOpenings) add(PHASE.sweep, -1, { key: "sweep.dw_totals", kind: "confirm", acceptsNotSure: false, phrasingHint: "Just checking the doors and windows total across the house — right?", writes: [{ tool: "answer_gap", input: { key: "sweep.dw_totals", action: "iloop_dw" } }] });
      if (!input.interior.done.sweep) add(PHASE.sweep, -1, { key: "sweep.missed_rooms", kind: "confirm", acceptsNotSure: false, phrasingHint: "Have we missed any room — laundry, WC, study, garage?", writes: [{ tool: "answer_gap", input: { key: "sweep.missed_rooms", action: "iloop_sweep" } }] });
    }
    ordered.forEach((room, rank) => {
      if (room.customer?.confirmed) return;
      const areaId = Number(room.id) || 0;
      add(PHASE.sweep, rank, { key: `room.${areaId}.confirm`, areaId, kind: "confirm", acceptsNotSure: false,
        phrasingHint: `Confirm the ${String(room.name ?? "room")} as it stands.`,
        writes: [{ tool: "answer_gap", input: { key: `room.${areaId}.confirm`, action: "confirm_room_loop", areaId } }] });
    });
  }

  // ---- 4. exterior -------------------------------------------------------------
  if (wantsExterior) {
    const ext = st.exterior ?? null;
    const listing = Boolean(st.listingUrl?.trim());
    if (!listing && (st.facadeRunIds?.length ?? 0) < 2 && ext?.noPhotos !== true) {
      add(PHASE.extIntake, 0, { key: "ext.photos", kind: "required", acceptsNotSure: true, phrasingHint: "Two or three photos of the outside of the house, or the listing link — or say you have none and I'll size it from your answers.", writes: [{ tool: "attach_document", input: { kind: "photo" } }] });
    }
    if (!ext) add(PHASE.extIntake, 0, { key: "ext.storeys", kind: "required", acceptsNotSure: false, phrasingHint: "Single storey or double?" });
    if (!ext || (ext.substrates ?? []).length === 0) add(PHASE.extIntake, 0, { key: "ext.substrates", kind: "required", acceptsNotSure: false, phrasingHint: "What's the outside made of — weatherboards, render, brick, concrete?" });
    if (!ext || !Object.values(ext.painting ?? {}).some(Boolean)) add(PHASE.extIntake, 0, { key: "ext.painting", kind: "required", acceptsNotSure: false, phrasingHint: "What are we painting outside — the walls, windows and doors, the roofline, the garage?" });
    if (!ext || ext.condition == null) add(PHASE.extIntake, 0, { key: "ext.condition", kind: "required", acceptsNotSure: false, phrasingHint: "How's the paintwork holding up — good, weathered, or peeling?" });
    if (ext && input.facts.accessAnswered !== true && (ext.access ?? []).length === 0 && (ext.accessEquipment ?? []).length === 0) add(PHASE.extIntake, 0, { key: "ext.access", kind: "recommended", acceptsNotSure: true, phrasingHint: "Anything tricky about access — steep, tight, or high?" });

    // Sides loop, front → left → right → back.
    SIDE_KEYS.forEach((key: SideKey, rank) => {
      const side = findSide(input.blocks as SideBlock[], key) as GraphBlock | null;
      if (!side) return;
      const ctx = { hasWalls: (side.surfaces ?? []).some((s) => isWallLine(s)), wallSumPct: wallSumPct(side as SideBlock) };
      const vars = { side: SIDE_LABEL[key].toLowerCase() };
      for (const q of registry.side) {
        if (!q.applies(side, ctx) || q.answered(side, ctx)) continue;
        add(PHASE.extLoop, rank, { key: `side.${key}.${q.key}`, areaId: Number(side.id) || null, kind: "required", acceptsNotSure: q.acceptsNotSure,
          phrasingHint: fill(q.phrasing, vars),
          writes: [{ tool: "answer_gap", input: { key: `side.${key}.${q.key}`, action: q.action, sideKey: key } }] });
      }
      if (side.customer?.include !== false && !side.customer?.confirmed) {
        add(PHASE.sweep, rank, { key: `side.${key}.confirm`, areaId: Number(side.id) || null, kind: "confirm", acceptsNotSure: false,
          phrasingHint: `Confirm the ${SIDE_LABEL[key].toLowerCase()} as it stands.`,
          writes: [{ tool: "answer_gap", input: { key: `side.${key}.confirm`, action: "confirm_side", sideKey: key } }] });
      }
    });

    if (!wantsInterior && input.facts.occupied == null) add(PHASE.extGlobal, 0, { key: "occupied", kind: "required", acceptsNotSure: false, phrasingHint: "Will anyone be living in the home while we paint?" });
    if (!wantsInterior && (st.paint?.brands?.length ?? 0) === 0) add(PHASE.extGlobal, 0, { key: "paint.brand", kind: "recommended", acceptsNotSure: true, phrasingHint: "Any preference on paint brand?" });
    if (!wantsInterior && st.paint?.colourHelp == null) add(PHASE.extGlobal, 0, { key: "paint.colours", kind: "tightening", acceptsNotSure: true, phrasingHint: "Do you know the colours, or want a match to what's there?", swingCents: swing("paint.colours") });
    if (ext && !ext.extras?.deck && !ext.extras?.fence && !ext.extras?.pergola && !ext.extras?.balustrade && input.sides && !input.sides.done.extras) {
      add(PHASE.extGlobal, 0, { key: "ext.freestanding", kind: "recommended", acceptsNotSure: false, phrasingHint: "Any freestanding items — deck, fence, pergola, balustrade?", writes: [{ tool: "answer_gap", input: { key: "ext.freestanding", action: "loop_extras_none" } }] });
    }

    if (input.sides) {
      if (!input.sides.done.cond) add(PHASE.sweep, -1, { key: "ext.cond_card", kind: "confirm", acceptsNotSure: false, phrasingHint: "Condition check: any rot, and how's the access?", writes: [{ tool: "answer_gap", input: { key: "ext.cond_card", action: "loop_cond" } }] });
      if (!input.sides.done.dw) add(PHASE.sweep, -1, { key: "sweep.ext_dw_totals", kind: "confirm", acceptsNotSure: false, phrasingHint: "Doors and windows across the sides we're painting — right?", writes: [{ tool: "answer_gap", input: { key: "sweep.ext_dw_totals", action: "loop_dw" } }] });
      if (!input.sides.done.sweep) add(PHASE.sweep, -1, { key: "sweep.ext_missed", kind: "confirm", acceptsNotSure: false, phrasingHint: "Anything outside we've missed?", writes: [{ tool: "answer_gap", input: { key: "sweep.ext_missed", action: "loop_sweep" } }] });
    }
  }

  // ---- order ------------------------------------------------------------------
  // Tightening gaps sort by $ swing ACROSS phases (Addendum A: largest impact
  // first, wherever the question lives); everything else by wizard order.
  out.sort((a, b) =>
    (a.phase === PHASE.stop ? -1 : KIND_RANK[a.kind]) - (b.phase === PHASE.stop ? -1 : KIND_RANK[b.kind])
    || (a.kind === "tightening" && b.kind === "tightening" ? (b.swingCents ?? 0) - (a.swingCents ?? 0) : 0)
    || a.phase - b.phase
    || a.areaRank - b.areaRank
    || a.idx - b.idx,
  );
  return out.map(({ phase: _p, areaRank: _r, idx: _i, ...gap }) => { void _p; void _r; void _i; return gap; });
}

export function nextGap(input: GraphInput): Gap | null {
  return gapsFor(input)[0] ?? null;
}

/** What one turn may ask: one question in guided mode, up to three when the
 *  next questions are all sweep confirms, everything in co-work (§4 rules). */
export function nextBatch(input: GraphInput): Gap[] {
  const gaps = gapsFor(input);
  if (input.mode === "cowork") return gaps;
  if (gaps[0]?.kind === "confirm") return gaps.filter((g) => g.kind === "confirm").slice(0, 3);
  return gaps.slice(0, 1);
}
