/**
 * RoomDraft -> the builder's own area node. Pure, no I/O.
 *
 * THE TWO RULES (room-loop brief section 0), enforced here:
 *   1. The tree is unchanged - what comes out is exactly the node
 *      QuoteBuilder's newArea()/newSurface() make by hand, same fields, same
 *      defaults, plus capture metadata the builder ignores.
 *   2. Capture must not change any price - so for a plain rectangular room we
 *      set ONLY L/W/H and let lib/pricing derive walls/ceiling/lineal exactly
 *      as it does for a hand-built room. Overrides are written only when the
 *      estimator explicitly measured something different (wall segments or a
 *      corrected perimeter), and then through the SAME fields the builder
 *      itself uses (qtyOverride / measureL).
 */
import { perimeterM, resolveQuantity, type RoomGeometry } from "./quantities";
import type { SurfaceTile } from "./presets";

/** One room's capture state - the client draft. */
export type RoomDraft = {
  localId: string;
  /** Builder node id when this room was committed before (re-entry edits it). */
  areaId?: number | null;
  name: string;
  roomType: string;
  storey: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  heightInherited: boolean;
  extraWallSegmentsM: number[];
  perimeterOverrideM: number | null;
  /** tileId -> count. Measured tiles use 1/0; countables the tap count. */
  selections: Record<string, number>;
  /** tileIds marked excluded (splashback-style "not this one"). */
  exclusions: string[];
  /** tileId -> extra prep hours (RoomReview stepper). */
  prepHours: Record<string, number>;
  /** tileId -> coats when changed from the default 2. */
  coats: Record<string, number>;
  /** tileId -> crew note. */
  crewNotes: Record<string, string>;
  status: "capturing" | "complete";
};

export function emptyDraft(localId: string, name: string, roomType: string, storey: string, heightM: number): RoomDraft {
  return {
    localId, areaId: null, name, roomType, storey,
    lengthM: 0, widthM: 0, heightM, heightInherited: true,
    extraWallSegmentsM: [], perimeterOverrideM: null,
    selections: {}, exclusions: [], prepHours: {}, coats: {}, crewNotes: {},
    status: "capturing",
  };
}

/** Exactly QuoteBuilder.newSurface()'s fields and defaults. */
type BuilderSurface = {
  id: number; code: string; internalLabel: string; clientLabel: string;
  coats: number; count: number; hidden: boolean; media: never[];
  measureL: number | null; measureH: number | null;
  qtyOverride: number | null; rateOverride: number | null;
  paintingHrOverride: number | null; prepHr: number; priceOverride: number | null;
  productName: string | null; color: string; colorHex: string;
  coverageOverride: number | null; volumeOverride: number | null;
  unitPriceOverride: number | null; crewNote: string; hideQty: boolean;
  showCoats: boolean; showPrice: boolean; useCustomRate: boolean;
  customRate: number | null; open: boolean;
  origin: "human_confirmed"; confidence: 1; assumedFields: string[];
};

export type BuilderAreaNode = {
  id: number; kind: "area"; name: string; type: "Interior" | "Exterior";
  areaType: "room" | "surface"; L: number; W: number; H: number;
  isOption: boolean; description: string; open: boolean; media: never[];
  surfaces: BuilderSurface[];
  origin: "human_confirmed"; confidence: 1; assumedFields: string[];
  // capture metadata (brief section 8) - node fields in the jsonb tree
  capturedVia: "room_loop"; roomType: string; storey: string;
  perimeterM: number; perimeterOverridden: boolean; irregular: boolean;
  extraWallSegmentsM: number[]; perimeterOverrideM: number | null;
};

/** Whether the room's perimeter differs from plain 2(L+W). */
function perimeterDiffers(geo: RoomGeometry): boolean {
  const derived = 2 * (geo.lengthM + geo.widthM);
  return Math.abs(perimeterM(geo) - derived) > 1e-9;
}

/**
 * Build the area node. `nextId` allocates builder ids; call with the current
 * max+1 and it consumes ids sequentially exactly like the builder does.
 */
export function draftToAreaNode(
  draft: RoomDraft,
  tiles: SurfaceTile[],
  nextId: () => number,
  opts: { exterior?: boolean } = {},
): BuilderAreaNode {
  const geo: RoomGeometry = {
    lengthM: draft.lengthM, widthM: draft.widthM, heightM: draft.heightM,
    extraWallSegmentsM: draft.extraWallSegmentsM,
    perimeterOverrideM: draft.perimeterOverrideM,
  };
  const perim = perimeterM(geo);
  const irregular = draft.extraWallSegmentsM.length > 0;
  const overridden = perimeterDiffers(geo);
  const excluded = new Set(draft.exclusions);

  const surfaces: BuilderSurface[] = [];
  for (const tile of tiles) {
    const count = draft.selections[tile.id] ?? 0;
    if (count <= 0 || excluded.has(tile.id) || !tile.rateCode) continue;

    // Perimeter-driven quantities only override when the room isn't the plain
    // rectangle the builder would assume - rule 2.
    let qtyOverride: number | null = null;
    let measureL: number | null = null;
    if (overridden) {
      if (tile.measureBasis === "wall_area") {
        qtyOverride = resolveQuantity({ basis: "wall_area", geo });
      } else if (tile.measureBasis === "perimeter") {
        measureL = perim;
      }
    }

    surfaces.push({
      id: nextId(),
      code: tile.rateCode,
      internalLabel: tile.label,
      clientLabel: tile.label,
      coats: draft.coats[tile.id] ?? 2,
      count: tile.countable ? count : 1,
      hidden: false, media: [],
      measureL, measureH: null,
      qtyOverride, rateOverride: null, paintingHrOverride: null,
      prepHr: draft.prepHours[tile.id] ?? 0,
      priceOverride: null, productName: null, color: "", colorHex: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
      crewNote: draft.crewNotes[tile.id] ?? "",
      hideQty: false, showCoats: false, showPrice: false,
      useCustomRate: false, customRate: null, open: false,
      origin: "human_confirmed", confidence: 1, assumedFields: [],
    });
  }

  return {
    id: draft.areaId ?? nextId(),
    kind: "area",
    name: draft.name,
    type: opts.exterior ? "Exterior" : "Interior",
    areaType: "room",
    L: draft.lengthM, W: draft.widthM, H: draft.heightM,
    isOption: false, description: "", open: false, media: [],
    surfaces,
    origin: "human_confirmed", confidence: 1, assumedFields: [],
    capturedVia: "room_loop",
    roomType: draft.roomType,
    storey: draft.storey,
    perimeterM: perim,
    perimeterOverridden: overridden,
    irregular,
    extraWallSegmentsM: draft.extraWallSegmentsM,
    perimeterOverrideM: draft.perimeterOverrideM,
  };
}
