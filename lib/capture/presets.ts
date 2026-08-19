/**
 * Rules rows -> ordered tile list. Pure, no I/O - callers fetch the rows.
 *
 * room_type_scope_rules is the ONE table behind both the AI plan reader's
 * scope stage (lib/extract/scope.ts) and the capture/wizard tile grids. This
 * module is the tile-side view over it: which tiles a room type shows, which
 * are pre-selected, how they group and order, and how each is measured.
 */
import type { MeasureBasis } from "./quantities";
import { SURFACE_TO_RATE_CODE, doorRateCode, windowRateCode } from "@/lib/extract/scope";

/** The rules row as it comes from the table (post Step 3 migration). */
export type TileRule = {
  room_type: string;
  surface_type: string;
  is_option: boolean;
  requires_confirm: boolean;
  countable: boolean;
  tile_group: string;
  sort_order: number;
  notes: string | null;
};

export const WET_ROOM_TYPES = new Set(["bathroom", "wc", "laundry"]);

export type SurfaceTile = {
  id: string;
  surfaceType: string;
  label: string;
  /** Short label for the tile box. */
  tileLabel: string;
  /**
   * The active rate card's item code this tile prices as. Falls back to the
   * surface type for tiles with no rate item (Cabinets, Shelving) - those
   * commit as prep-only rows, which is how lib/pricing already treats an
   * unknown code.
   */
  rateCode: string;
  measureBasis: MeasureBasis;
  group: "core" | "openings" | "joinery" | "extras";
  /** Pre-selected when the room opens (the biggest tap saving). */
  defaultOn: boolean;
  countable: boolean;
  /** Stairwell-style tiles that demand an explicit confirm before pricing. */
  requiresConfirm: boolean;
  sortOrder: number;
  /** Wet-area walls: taps cycle 25/50/75/100% instead of on/off. */
  fractional?: boolean;
  /** Exterior cladding: taps cycle DOWN — 100/75/50/25% then off. */
  descending?: boolean;
};

/**
 * How each known surface type is measured. Anything not listed is manual -
 * a tile that appears and asks for its quantity rather than deriving one,
 * which is the honest default for surfaces we cannot derive.
 */
const BASIS_BY_SURFACE: Record<string, MeasureBasis> = {
  "Walls": "wall_area",
  "Ceiling": "ceiling_area",
  "Cornices": "perimeter",
  "Skirting Boards": "perimeter",
  "Architrave": "per_item",
  "Picture Rails": "perimeter",
  "Mantle": "per_item",
  "Door & Frame": "per_item",
  "Windows": "per_item",
  "Cabinets": "per_item",
  "Shelving": "per_item",
};

const TILE_LABELS: Record<string, string> = {
  "Skirting Boards": "Skirting",
  "Door & Frame": "Door + Frame",
};

const GROUPS = new Set(["core", "openings", "joinery", "extras"]);
const GROUP_ORDER: Record<string, number> = { core: 0, openings: 1, joinery: 2, extras: 3 };

/**
 * The ordered tile list for one room type. Group order core -> openings ->
 * joinery -> extras, then sort_order, then name - so the grid reads the same
 * way in every room and nobody hunts for Walls.
 */
/**
 * Exterior elevations: capture is one PLANE (width x height), not a room.
 * Built-in tile set so exterior capture works on every database — a
 * room_type_scope_rules row for exterior_elevation still wins when present.
 * Cladding taps cycle DOWN (100/75/50/25%) because an elevation is usually
 * all one cladding and partly another, not the other way around.
 */
const EXTERIOR_ELEVATION_TILES: SurfaceTile[] = [
  ...([["Weatherboards", 10], ["Render", 11], ["Stucco", 12], ["Brick", 13]] as Array<[string, number]>)
    .map(([code, sort]): SurfaceTile => ({
      id: `exterior_elevation:${code}`, surfaceType: code, label: code, tileLabel: code,
      rateCode: code, measureBasis: "plane_area", group: "core", defaultOn: false,
      countable: false, requiresConfirm: false, sortOrder: sort, fractional: true, descending: true,
    })),
  ...([["Fascias", 20], ["Gutters", 21], ["Eaves", 22], ["Downpipes", 23], ["Soffits / Exterior Ceilings", 24]] as Array<[string, number]>)
    .map(([code, sort]): SurfaceTile => ({
      id: `exterior_elevation:${code}`, surfaceType: code, label: code, tileLabel: code,
      rateCode: code, measureBasis: "elevation_length", group: "core", defaultOn: false,
      countable: false, requiresConfirm: false, sortOrder: sort,
    })),
  ...([["Fixed / Picture Window", "Windows", 30], ["Front Door", "Entry door", 31], ["Standard Door (1 Side)", "Standard door", 32], ["Garage Door (1 Car)", "Garage door (1 car)", 33], ["Garage Door (2 Car)", "Garage door (2 car)", 34]] as Array<[string, string, number]>)
    .map(([code, label, sort]): SurfaceTile => ({
      id: `exterior_elevation:${code}`, surfaceType: code, label, tileLabel: label,
      rateCode: code, measureBasis: "per_item", group: "openings", defaultOn: false,
      countable: true, requiresConfirm: false, sortOrder: sort,
    })),
  ...([["Deck Painting", "Deck", "manual_m2", 40], ["Paling Fence", "Fence", "manual_lin", 41], ["Pergola", "Pergola", "manual_lin", 42], ["Hand Rails", "Hand rails", "manual_lin", 43], ["Pressure Washing", "Pressure washing", "manual_m2", 44]] as Array<[string, string, MeasureBasis, number]>)
    .map(([code, label, basis, sort]): SurfaceTile => ({
      id: `exterior_elevation:${code}`, surfaceType: code, label, tileLabel: label,
      rateCode: code, measureBasis: basis, group: "extras", defaultOn: false,
      countable: basis === "manual_m2" || basis === "manual_lin" ? false : true, requiresConfirm: false, sortOrder: sort,
    })),
];

export function tilesForRoomType(roomType: string, rules: TileRule[]): SurfaceTile[] {
  if ((roomType === "exterior_elevation" || roomType === "exterior")
      && !rules.some((r) => r.room_type === roomType)) {
    return EXTERIOR_ELEVATION_TILES;
  }
  return rules
    .filter((r) => r.room_type === roomType)
    .map((r): SurfaceTile => ({
      id: `${r.room_type}:${r.surface_type}`,
      surfaceType: r.surface_type,
      label: r.surface_type,
      tileLabel: TILE_LABELS[r.surface_type] ?? r.surface_type,
      rateCode: SURFACE_TO_RATE_CODE[r.surface_type] ?? r.surface_type,
      measureBasis: BASIS_BY_SURFACE[r.surface_type] ?? "manual_m2",
      group: (GROUPS.has(r.tile_group) ? r.tile_group : "extras") as SurfaceTile["group"],
      defaultOn: !r.is_option && !r.countable,
      countable: r.countable,
      requiresConfirm: r.requires_confirm,
      sortOrder: r.sort_order,
      fractional: r.surface_type === "Walls" && WET_ROOM_TYPES.has(r.room_type),
    }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label),
    );
}

/**
 * Capture-mode tile expansion: on site the estimator KNOWS the door and window
 * styles, so the generic "Door & Frame" and "Windows" rules become one tile
 * per style, each carrying its own rate code. Same no-guessing rule as the
 * plan reader (doorRateCode/windowRateCode), exercised from the other side:
 * here a human picks the style by tapping the right tile.
 */
export function expandCaptureTiles(tiles: SurfaceTile[]): SurfaceTile[] {
  const out: SurfaceTile[] = [];
  for (const t of tiles) {
    if (t.surfaceType === "Door & Frame") {
      out.push(
        { ...t, id: `${t.id}:flat`, label: "Flat Door + Frame", tileLabel: "Flat Door + Frame", rateCode: doorRateCode("flat")!, sortOrder: t.sortOrder },
        { ...t, id: `${t.id}:panel`, label: "Panel Door + Frame", tileLabel: "Panel Door + Frame", rateCode: doorRateCode("panel")!, sortOrder: t.sortOrder + 1 },
        // Door-only rates (no frame) - robe/cupboard leaves, re-hangs.
        { ...t, id: `${t.id}:flat-nf`, label: "Flat Door (no frame)", tileLabel: "Flat Door (no frame)", rateCode: "Flat Door (1 Side)", sortOrder: t.sortOrder + 2 },
        { ...t, id: `${t.id}:panel-nf`, label: "Panel Door (no frame)", tileLabel: "Panel Door (no frame)", rateCode: "4-6 Panel Door (1 Side)", sortOrder: t.sortOrder + 3 },
      );
    } else if (t.surfaceType === "Windows") {
      out.push(
        { ...t, id: `${t.id}:sash`, label: "Sash Window", tileLabel: "Sash Window", rateCode: windowRateCode("double_hung_sash")!, sortOrder: t.sortOrder },
        { ...t, id: `${t.id}:awning`, label: "Awning / Casement", tileLabel: "Awning / Casement", rateCode: windowRateCode("awning_casement")!, sortOrder: t.sortOrder + 1 },
        { ...t, id: `${t.id}:fixed`, label: "Fixed / Picture", tileLabel: "Fixed / Picture", rateCode: windowRateCode("fixed_picture")!, sortOrder: t.sortOrder + 2 },
        { ...t, id: `${t.id}:bay`, label: "Colonial / Bay", tileLabel: "Colonial / Bay", rateCode: windowRateCode("colonial_bay")!, sortOrder: t.sortOrder + 3 },
      );
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Storey heights model: the estimate's map, with the brief's 2.4 m default. */
export const DEFAULT_STOREY_HEIGHTS: Record<string, number> = { ground: 2.4 };

export function heightForStorey(
  storeyHeights: Record<string, number> | null | undefined,
  storey: string,
): number {
  return storeyHeights?.[storey] ?? storeyHeights?.ground ?? DEFAULT_STOREY_HEIGHTS.ground;
}

/**
 * A5: derive per-storey heights from the area nodes themselves — the one
 * source every estimate has, however it was made. A wizard estimate with
 * `ceilingHeight: "unsure"` stores no storey_heights row, and capture used
 * to open wedged on an empty prompt with only "ground" on offer even for a
 * double-storey. These derived values PRE-FILL the confirm prompt; they
 * don't skip it — height is the walls error, production always confirms it.
 */
export function storeyHeightsFromBlocks(
  blocks: Array<Record<string, unknown>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blocks) {
    if (b.kind !== "area" || b.type === "Exterior") continue;
    const storey = typeof b.storey === "string" && b.storey ? b.storey : "ground";
    const h = Number(b.H);
    if (out[storey] == null && h >= 1.8 && h <= 8) out[storey] = h;
  }
  return Object.keys(out).length ? out : { ...DEFAULT_STOREY_HEIGHTS };
}
