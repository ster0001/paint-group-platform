import { roomGateError } from "./required-questions";
import { makeDraftSurface } from "@/lib/extract/draft";
import { windowRateCode } from "@/lib/extract/scope";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { windowStyleToSchema, type WizardState } from "./state";

/**
 * R3: the interior confirm loop (reference:
 * customer-review-confirm-mockup.html; rebuild addendum §1–2).
 *
 * Pure helpers over the same interior room blocks everything else reads.
 * Room answers ride ON the block (`customer.size`, `customer.cup`,
 * `customer.confirmed`); the non-room loop items (doors & windows totals
 * check, missed-rooms sweep) keep their answers in
 * builder_state.interiorLoop.
 */

export type InteriorLoopMeta = {
  dwOk: boolean | null;
  sweepAns: "none" | "added" | null;
  done: { dw: boolean; sweep: boolean };
};

export function defaultInteriorLoop(): InteriorLoopMeta {
  return { dwOk: null, sweepAns: null, done: { dw: false, sweep: false } };
}

type LooseSurface = Record<string, unknown> & { id?: number; code?: string; count?: number };
export type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string; roomType?: string;
  L?: number; W?: number; H?: number;
  surfaces?: LooseSurface[];
  customer?: { size: "yes" | "adjusted" | null; cup: boolean | null; cupInterior?: boolean | null; confirmed: boolean };
  customerCustom?: string[];
  assumedFields?: unknown;
  origin?: unknown; confidence?: unknown;
};

/** Cupboard questions by room type (rebuild addendum §2). The question only
 * renders when its rate item exists on the active card — data-driven, so an
 * un-migrated card simply asks nothing. */
export const CUPBOARD_BY_ROOM_TYPE: Record<string, {
  code: string; question: string; unit: string; defaultCount: number; note: string;
}> = {
  kitchen: {
    code: "Kitchen Cupboard Front",
    question: "Are we painting the kitchen cupboards?",
    unit: "doors & drawer fronts", defaultCount: 14,
    note: "Cupboards are spray-finished for a smooth, factory-style result — doors, drawer fronts and frames.",
  },
  bedroom: {
    code: "Robe Door",
    question: "Paint the built-in robe doors?",
    unit: "robe doors", defaultCount: 2, note: "",
  },
  bathroom: {
    code: "Vanity Door",
    question: "Paint the vanity cupboard?",
    unit: "vanity doors", defaultCount: 2, note: "",
  },
  laundry: {
    code: "Vanity Door",
    question: "Paint the laundry cupboard?",
    unit: "cupboard doors", defaultCount: 2, note: "",
  },
};

const isInteriorRoom = (b: LooseBlock) =>
  b.kind === "area" && b.type !== "Exterior" && b.areaType !== "surface";

const customerOf = (b: LooseBlock) =>
  b.customer ?? { size: null as "yes" | "adjusted" | null, cup: null as boolean | null, confirmed: false };

export type RoomsLoopResult = { ok: true; blocks: LooseBlock[] } | { ok: false; error: string };

function withRoom(blocks: LooseBlock[], areaId: number, fn: (b: LooseBlock) => string | void): RoomsLoopResult {
  const room = blocks.find((b) => isInteriorRoom(b) && Number(b.id) === areaId);
  if (!room) return { ok: false, error: "No such room." };
  const copy: LooseBlock = { ...room, surfaces: (room.surfaces ?? []).map((s) => ({ ...s })), customer: { ...customerOf(room) } };
  const err = fn(copy);
  if (err) return { ok: false, error: err };
  return { ok: true, blocks: blocks.map((b) => (b === room ? copy : b)) };
}

/**
 * "Looks right" — the customer agrees the size we assumed IS the size.
 *
 * R5: this SETTLES the dimensions, exactly as typing the same numbers back
 * would (applyRoomDims below). Before R5 it only set a flag, so a customer
 * could agree with every room in the house and the confidence score would
 * not move a single point — measured stuck at 18% across a full walk-through
 * on 20 Aug. Agreeing with a number is an answer, not a shrug.
 */
export function applyRoomSizeOk(blocks: LooseBlock[], areaId: number): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    b.origin = "customer_stated"; b.confidence = 0.85;
    b.assumedFields = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : []).filter((f) => f !== "L" && f !== "W");
    b.customer = { ...customerOf(b), size: "yes" };
  });
}

/** "Not sure" on the size (assistant §4: always a valid answer). The
 * question is ANSWERED — the loop can move on — but the typical default and
 * its assumption stay, so the range stays honest-wide until someone measures. */
export function applyRoomSizeNotSure(blocks: LooseBlock[], areaId: number): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    b.customer = { ...customerOf(b), size: "yes" };
  });
}

/** The L × W adjust — metres, clamped 1–15 per side; reprices via the
 * engine, provenance customer_stated. m² stays internal: everything
 * customer-facing displays L × W. */
export function applyRoomDims(blocks: LooseBlock[], areaId: number, lengthM: number, widthM: number): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    // Mockup behaviour: the gentle clamp — out-of-range proceeds at the
    // nearest bound (a toast's job to say so), never a refusal.
    b.L = Math.min(15, Math.max(1, lengthM));
    b.W = Math.min(15, Math.max(1, widthM));
    b.origin = "customer_stated"; b.confidence = 0.85;
    b.assumedFields = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : []).filter((f) => f !== "L" && f !== "W");
    b.customer = { ...customerOf(b), size: "adjusted" };
  });
}

/** The cupboard answer. Yes adds the priced cabinetry line (count defaults
 * by room type); No records the answer and removes any line — a recorded
 * answer, never an omission. */
export function applyCupboard(
  blocks: LooseBlock[], areaId: number, on: boolean, count: number | null, nextId: () => number,
): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const cfg = CUPBOARD_BY_ROOM_TYPE[String(b.roomType ?? "")];
    if (!cfg) return "This room has no cupboard question.";
    const surfaces = (b.surfaces ?? []).filter((s) => String(s.code) !== cfg.code);
    if (on) {
      const n = Math.min(40, Math.max(1, count ?? cfg.defaultCount));
      const line = makeDraftSurface(nextId(), cfg.code, cfg.unit, n, "customer_stated", 0.85, []) as unknown as LooseSurface;
      surfaces.push(line);
    }
    b.surfaces = surfaces;
    b.customer = { ...customerOf(b), cup: on };
  });
}

/**
 * Cupboard INTERIORS by room type (assistant Addendum A, R5 / D19 ruled by
 * Tom 2 Sep 2026). Priced per carcass on migration 20261227; like the fronts
 * above, the question only renders when the code exists on the active card.
 * It is a TIGHTENING question, never a gate: a room confirms without it, and
 * the assistant lists "cupboard interiors not included" as an assumption chip
 * until it is answered.
 */
export const CUPBOARD_INTERIOR_BY_ROOM_TYPE: Record<string, {
  code: string; question: string; unit: string; defaultCount: number; note: string;
}> = {
  kitchen: {
    code: "Kitchen Cupboard Interior",
    question: "Paint inside the kitchen cupboards too?",
    unit: "cupboards", defaultCount: 8,
    note: "Inside the carcass and shelves, brushed and rolled — in the room's colour unless you tell us otherwise.",
  },
  bedroom: {
    code: "Robe Interior",
    question: "Paint inside the built-in robe?",
    unit: "robes", defaultCount: 1, note: "",
  },
  bathroom: {
    code: "Vanity Interior",
    question: "Paint inside the vanity?",
    unit: "vanities", defaultCount: 1, note: "",
  },
  laundry: {
    code: "Linen / Broom Cupboard Interior",
    question: "Paint inside the laundry cupboard?",
    unit: "cupboards", defaultCount: 1, note: "",
  },
  hallway: {
    code: "Linen / Broom Cupboard Interior",
    question: "Paint inside the linen cupboard?",
    unit: "cupboards", defaultCount: 1, note: "",
  },
};

/** The cupboard-interior answer — same shape as applyCupboard: Yes adds the
 * priced line at the room's default count, No records the answer and removes
 * any line. Independent of the fronts answer (a customer may want the doors
 * done and not the insides, or the reverse). */
export function applyCupboardInterior(
  blocks: LooseBlock[], areaId: number, on: boolean, count: number | null, nextId: () => number,
): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const cfg = CUPBOARD_INTERIOR_BY_ROOM_TYPE[String(b.roomType ?? "")];
    if (!cfg) return "This room has no cupboard-interior question.";
    const surfaces = (b.surfaces ?? []).filter((s) => String(s.code) !== cfg.code);
    if (on) {
      const n = Math.min(40, Math.max(1, count ?? cfg.defaultCount));
      const line = makeDraftSurface(nextId(), cfg.code, cfg.unit, n, "customer_stated", 0.85, []) as unknown as LooseSurface;
      surfaces.push(line);
    }
    b.surfaces = surfaces;
    b.customer = { ...customerOf(b), cupInterior: on };
  });
}

const WINDOW_FACTOR: Record<"S" | "M" | "L", number> = { S: 0.8, M: 1, L: 1.2 };

export function applyRoomWindowSize(blocks: LooseBlock[], areaId: number, surfaceId: number, size: "S" | "M" | "L"): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const line = (b.surfaces ?? []).find((s) => Number(s.id) === surfaceId
      && substrateKeyForRateCode(String(s.code ?? "")) === "windows");
    if (!line) return "That window group isn't in this room.";
    line.sizeBand = size;
    const count = Number(line.count) || 1;
    line.qtyOverride = size === "M" ? null : Math.round(count * WINDOW_FACTOR[size] * 100) / 100;
  });
}

/** "+ More windows — a different size": interior window GROUPS, at the
 * wizard-answered style (default rate when unsure — R1.2's rule). */
export function addRoomWindowGroup(blocks: LooseBlock[], areaId: number, snapshot: WizardState | null, nextId: () => number): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const code = windowRateCode(windowStyleToSchema(snapshot?.details.windowStyle ?? "unsure")) ?? "Awning / Casement Window";
    const line = makeDraftSurface(nextId(), code, "More windows", 1, "customer_stated", 0.75, ["style"]) as unknown as LooseSurface;
    line.sizeBand = "M";
    b.surfaces = [...(b.surfaces ?? []), line];
  });
}

/** A catalogue add: any Interior rate-card code the route has validated —
 * a priced per-item line (Air Vent and friends), customer_stated. Catalogue
 * rows carry PER-ITEM charge-outs (price ÷ hours, e.g. Air Vent $180/h so
 * 0.25 h lands $45) — the line must ride the item's own rate via
 * useCustomRate, or the engine bills it at the category charge-out. */
export function addCatalogueLine(
  blocks: LooseBlock[], areaId: number, code: string, label: string,
  nextId: () => number, chargeOutDollars?: number | null,
): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    if ((b.surfaces ?? []).some((s) => String(s.code) === code)) return "That surface is already in this room.";
    const line = makeDraftSurface(nextId(), code, label, 1, "customer_stated", 0.85, []) as unknown as LooseSurface;
    if (chargeOutDollars != null) {
      line.useCustomRate = true;
      line.customRate = chargeOutDollars;
    }
    b.surfaces = [...(b.surfaces ?? []), line];
  });
}

/** Count on a specific line (catalogue items, window groups) — 1–20. */
export function applyLineCount(blocks: LooseBlock[], areaId: number, surfaceId: number, count: number): RoomsLoopResult {
  if (!(count >= 1 && count <= 20)) return { ok: false, error: "Counts run 1–20." };
  return withRoom(blocks, areaId, (b) => {
    const line = (b.surfaces ?? []).find((s) => Number(s.id) === surfaceId);
    if (!line) return "That item isn't in this room.";
    line.count = count;
    if (line.qtyOverride != null && line.sizeBand) {
      const f = { S: 0.8, M: 1, L: 1.2 }[line.sizeBand as "S" | "M" | "L"] ?? 1;
      line.qtyOverride = Math.round(count * f * 100) / 100;
    }
  });
}

/** Remove a specific line (turning a catalogue tile off). */
export function removeLine(blocks: LooseBlock[], areaId: number, surfaceId: number): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const kept = (b.surfaces ?? []).filter((s) => Number(s.id) !== surfaceId);
    if (kept.length === (b.surfaces ?? []).length) return "That item isn't in this room.";
    b.surfaces = kept;
  });
}

/** A named custom surface: an amber flag tile, recorded — NEVER priced. */
export function addRoomCustom(blocks: LooseBlock[], areaId: number, name: string): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    b.customerCustom = [...(b.customerCustom ?? []), name.trim().slice(0, 120)];
  });
}

/** Confirm one room — refuses by name while a required question is open. */
export function confirmRoom(blocks: LooseBlock[], areaId: number, cupboardApplies: boolean): RoomsLoopResult {
  return withRoom(blocks, areaId, (b) => {
    const c = customerOf(b);
    // The required questions are DATA shared with the assistant's question
    // graph (lib/wizard/required-questions.ts) — one list, two consumers.
    const err = roomGateError({ customer: c }, { cupboardApplies });
    if (err) return err;
    b.customer = { ...c, confirmed: true };
  });
}

export function interiorDwTotals(blocks: LooseBlock[]): { doors: number; windows: number } {
  let doors = 0; let windows = 0;
  for (const b of blocks) {
    if (!isInteriorRoom(b)) continue;
    for (const s of b.surfaces ?? []) {
      const k = substrateKeyForRateCode(String(s.code ?? ""));
      if (k === "doors") doors += Number(s.count) || 1;
      if (k === "windows") windows += Number(s.count) || 1;
    }
  }
  return { doors, windows };
}

export function interiorProgress(blocks: LooseBlock[], meta: InteriorLoopMeta): { done: number; total: number; allDone: boolean } {
  const rooms = blocks.filter(isInteriorRoom);
  const done = rooms.filter((b) => b.customer?.confirmed).length
    + Number(meta.done.dw) + Number(meta.done.sweep);
  const total = rooms.length + 2;
  return { done, total, allDone: rooms.length > 0 && done === total };
}

/** Per-room loop view, joined by areaId onto the tile view the editor
 * already renders. Cupboard applicability is decided by the ROUTE against
 * the live rate card (data-driven; no card row, no question). */
export type RoomLoopView = {
  areaId: number;
  sizeLabel: string; // "3.5 × 3.25 m" — L × W, never m²
  size: "yes" | "adjusted" | null;
  confirmed: boolean;
  cupboard: null | { question: string; unit: string; on: boolean | null; count: number; note: string };
  /** Interiors ride the same shape; null when the card has no row for this room type. */
  cupboardInterior: null | { question: string; unit: string; on: boolean | null; count: number; note: string };
  windows: Array<{ id: number; label: string; count: number; sizeBand: "S" | "M" | "L" }>;
  customs: string[];
};

export function roomLoopViews(blocks: LooseBlock[], cupboardCodes: ReadonlySet<string>): RoomLoopView[] {
  const out: RoomLoopView[] = [];
  for (const b of blocks) {
    if (!isInteriorRoom(b)) continue;
    const c = customerOf(b);
    const cfg = CUPBOARD_BY_ROOM_TYPE[String(b.roomType ?? "")];
    const applicable = cfg && cupboardCodes.has(cfg.code) ? cfg : null;
    const cupLine = applicable
      ? (b.surfaces ?? []).find((s) => String(s.code) === applicable.code)
      : undefined;
    const iCfg = CUPBOARD_INTERIOR_BY_ROOM_TYPE[String(b.roomType ?? "")];
    const interiorCfg = iCfg && cupboardCodes.has(iCfg.code) ? iCfg : null;
    const interiorLine = interiorCfg
      ? (b.surfaces ?? []).find((s) => String(s.code) === interiorCfg.code)
      : undefined;
    out.push({
      areaId: Number(b.id) || 0,
      sizeLabel: `${Number(b.L) || 0} × ${Number(b.W) || 0} m`,
      size: c.size,
      confirmed: c.confirmed,
      cupboard: applicable ? {
        question: applicable.question,
        unit: applicable.unit,
        on: c.cup,
        count: Number(cupLine?.count) || applicable.defaultCount,
        note: applicable.note,
      } : null,
      cupboardInterior: interiorCfg ? {
        question: interiorCfg.question,
        unit: interiorCfg.unit,
        on: c.cupInterior ?? null,
        count: Number(interiorLine?.count) || interiorCfg.defaultCount,
        note: interiorCfg.note,
      } : null,
      windows: (b.surfaces ?? [])
        .filter((s) => substrateKeyForRateCode(String(s.code ?? "")) === "windows")
        .map((s) => ({
          id: Number(s.id) || 0,
          label: String(s.internalLabel ?? "Windows"),
          count: Number(s.count) || 1,
          sizeBand: ((s.sizeBand as "S" | "M" | "L" | undefined) ?? "M"),
        })),
      customs: b.customerCustom ?? [],
    });
  }
  return out;
}
