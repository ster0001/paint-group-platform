/**
 * Rules rows -> ordered tile list. Pure, no I/O - callers fetch the rows.
 *
 * room_type_scope_rules is the ONE table behind both the AI plan reader's
 * scope stage (lib/extract/scope.ts) and the capture/wizard tile grids. This
 * module is the tile-side view over it: which tiles a room type shows, which
 * are pre-selected, how they group and order, and how each is measured.
 */
import type { MeasureBasis } from "./quantities";

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

export type SurfaceTile = {
  id: string;
  surfaceType: string;
  label: string;
  /** Short label for the tile box. */
  tileLabel: string;
  measureBasis: MeasureBasis;
  group: "core" | "openings" | "joinery" | "extras";
  /** Pre-selected when the room opens (the biggest tap saving). */
  defaultOn: boolean;
  countable: boolean;
  /** Stairwell-style tiles that demand an explicit confirm before pricing. */
  requiresConfirm: boolean;
  sortOrder: number;
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
export function tilesForRoomType(roomType: string, rules: TileRule[]): SurfaceTile[] {
  return rules
    .filter((r) => r.room_type === roomType)
    .map((r): SurfaceTile => ({
      id: `${r.room_type}:${r.surface_type}`,
      surfaceType: r.surface_type,
      label: r.surface_type,
      tileLabel: TILE_LABELS[r.surface_type] ?? r.surface_type,
      measureBasis: BASIS_BY_SURFACE[r.surface_type] ?? "manual_m2",
      group: (GROUPS.has(r.tile_group) ? r.tile_group : "extras") as SurfaceTile["group"],
      defaultOn: !r.is_option && !r.countable,
      countable: r.countable,
      requiresConfirm: r.requires_confirm,
      sortOrder: r.sort_order,
    }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label),
    );
}

/** Storey heights model: the estimate's map, with the brief's 2.4 m default. */
export const DEFAULT_STOREY_HEIGHTS: Record<string, number> = { ground: 2.4 };

export function heightForStorey(
  storeyHeights: Record<string, number> | null | undefined,
  storey: string,
): number {
  return storeyHeights?.[storey] ?? storeyHeights?.ground ?? DEFAULT_STOREY_HEIGHTS.ground;
}
