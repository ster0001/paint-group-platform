/**
 * EXTERIOR TYPICALS — the home shapes and the sizes a drawn house starts at
 * (Exterior wizard v2 brief §5.1, S1).
 *
 * One row per shape: the silhouette (storeys, roof), the typical front and
 * side lengths, the wall height, the gable rise, which sides usually share a
 * wall, whether the walls are usually painted at all, and the picture's
 * starting texture. The shape NEVER decides the wall material — that is
 * asked for the ticked walls (Tom, 12 Oct 2026: Colorbond, vertical cladding
 * and cement sheet are materials, not houses).
 *
 * The same nine rows live in `exterior_typicals` (migration 20270278, seeded
 * by `scripts/seed-exterior-typicals.ts` from THIS list) so Settings can
 * edit them later; until a database row replaces one, these are the
 * fallback — and every row is `source: "proposed"` (⚑ 2) until Tom owns it.
 */

export type ExteriorShapeKey = "wb" | "cal" | "brick" | "ds" | "th" | "unit" | "terrace" | "modern" | "other";
export const EXTERIOR_SHAPE_KEYS: ExteriorShapeKey[] = ["wb", "cal", "brick", "ds", "th", "unit", "terrace", "modern", "other"];

export type ExteriorRoof = "hip" | "gable" | "parapet" | "skillion";
export type ExteriorSideKey = "front" | "right" | "back" | "left";
export const EXTERIOR_SIDE_KEYS: ExteriorSideKey[] = ["front", "right", "back", "left"];

/** The wall materials the About-it step offers — every one a rate row on the card (§5.1). */
export type WallMaterial = "weatherboards" | "render" | "brick" | "stucco" | "cement_sheet" | "colorbond" | "vertical_timber" | "concrete";
export const WALL_MATERIALS: WallMaterial[] = ["weatherboards", "render", "brick", "stucco", "cement_sheet", "colorbond", "vertical_timber", "concrete"];

export type ExteriorTypical = {
  key: ExteriorShapeKey;
  name: string;
  storeys: 1 | 2;
  roof: ExteriorRoof;
  frontM: number;
  sideM: number;
  wallHM: number;
  /** The gable (or parapet / skillion) rise in metres; null for a hip roof. */
  gableRiseM: number | null;
  /** The picture's starting texture only — never the priced material. */
  usualWalls: WallMaterial;
  wallsPainted: boolean;
  sharedSides: ExteriorSideKey[];
  verandah: "none" | "porch" | "columns" | "lace";
  source: "proposed" | "tom";
};

/** The database row shape (`exterior_typicals`), as the seed writes and the reader loads it. */
export type ExteriorTypicalRow = {
  key: string;
  name: string;
  storeys: number;
  roof: string;
  front_m: number;
  side_m: number;
  wall_h_m: number;
  gable_rise_m: number | null;
  usual_walls: string;
  walls_painted: boolean;
  shared_sides: string[];
  verandah: string;
  source: string;
};

export const EXTERIOR_TYPICALS_VERSION = 1;

/** §5.1 — my proposed Melbourne numbers, placeholders until Tom replaces them (⚑ 2). */
export const EXTERIOR_TYPICALS: ReadonlyArray<ExteriorTypical> = [
  { key: "wb", name: "Weatherboard home", storeys: 1, roof: "hip", frontM: 11, sideM: 14, wallHM: 2.7, gableRiseM: null, usualWalls: "weatherboards", wallsPainted: true, sharedSides: [], verandah: "porch", source: "proposed" },
  { key: "cal", name: "Californian bungalow", storeys: 1, roof: "gable", frontM: 12, sideM: 16, wallHM: 3.0, gableRiseM: 2.4, usualWalls: "weatherboards", wallsPainted: true, sharedSides: [], verandah: "columns", source: "proposed" },
  { key: "brick", name: "Brick veneer home", storeys: 1, roof: "hip", frontM: 12, sideM: 15, wallHM: 2.5, gableRiseM: null, usualWalls: "brick", wallsPainted: false, sharedSides: [], verandah: "none", source: "proposed" },
  { key: "ds", name: "Double-storey home", storeys: 2, roof: "hip", frontM: 12, sideM: 14, wallHM: 5.6, gableRiseM: null, usualWalls: "render", wallsPainted: true, sharedSides: [], verandah: "none", source: "proposed" },
  { key: "th", name: "Townhouse", storeys: 2, roof: "hip", frontM: 7, sideM: 14, wallHM: 5.6, gableRiseM: null, usualWalls: "render", wallsPainted: true, sharedSides: ["left", "right"], verandah: "none", source: "proposed" },
  { key: "unit", name: "Unit or villa", storeys: 1, roof: "hip", frontM: 9, sideM: 12, wallHM: 2.5, gableRiseM: null, usualWalls: "brick", wallsPainted: false, sharedSides: ["left"], verandah: "none", source: "proposed" },
  { key: "terrace", name: "Period terrace", storeys: 1, roof: "parapet", frontM: 6, sideM: 16, wallHM: 3.6, gableRiseM: 0.9, usualWalls: "render", wallsPainted: true, sharedSides: ["left", "right"], verandah: "lace", source: "proposed" },
  { key: "modern", name: "Modern home", storeys: 1, roof: "skillion", frontM: 12, sideM: 14, wallHM: 3.0, gableRiseM: 1.1, usualWalls: "cement_sheet", wallsPainted: true, sharedSides: [], verandah: "none", source: "proposed" },
  { key: "other", name: "Something else", storeys: 1, roof: "hip", frontM: 12, sideM: 14, wallHM: 2.7, gableRiseM: null, usualWalls: "weatherboards", wallsPainted: true, sharedSides: [], verandah: "none", source: "proposed" },
];

const isShapeKey = (k: string): k is ExteriorShapeKey => (EXTERIOR_SHAPE_KEYS as string[]).includes(k);
const isRoof = (r: string): r is ExteriorRoof => r === "hip" || r === "gable" || r === "parapet" || r === "skillion";
const isSide = (s: string): s is ExteriorSideKey => (EXTERIOR_SIDE_KEYS as string[]).includes(s);
const isWall = (w: string): w is WallMaterial => (WALL_MATERIALS as string[]).includes(w);
const isVerandah = (v: string): v is ExteriorTypical["verandah"] => v === "none" || v === "porch" || v === "columns" || v === "lace";

/** A database row as a typical, or null when the row is not one the model can price (a bad edit never reaches the tree). */
export function typicalFromRow(r: ExteriorTypicalRow): ExteriorTypical | null {
  if (!isShapeKey(r.key) || !isRoof(r.roof) || !isWall(r.usual_walls) || !isVerandah(r.verandah)) return null;
  if (!(r.front_m > 0 && r.side_m > 0 && r.wall_h_m > 0)) return null;
  if (r.storeys !== 1 && r.storeys !== 2) return null;
  return {
    key: r.key, name: r.name, storeys: r.storeys, roof: r.roof,
    frontM: r.front_m, sideM: r.side_m, wallHM: r.wall_h_m, gableRiseM: r.gable_rise_m,
    usualWalls: r.usual_walls, wallsPainted: r.walls_painted,
    sharedSides: r.shared_sides.filter(isSide), verandah: r.verandah,
    source: r.source === "tom" ? "tom" : "proposed",
  };
}

/** A typical as the seed writes it. */
export function rowFromTypical(t: ExteriorTypical, version = EXTERIOR_TYPICALS_VERSION): ExteriorTypicalRow & { version: number } {
  return {
    version, key: t.key, name: t.name, storeys: t.storeys, roof: t.roof,
    front_m: t.frontM, side_m: t.sideM, wall_h_m: t.wallHM, gable_rise_m: t.gableRiseM,
    usual_walls: t.usualWalls, walls_painted: t.wallsPainted, shared_sides: t.sharedSides, verandah: t.verandah, source: t.source,
  };
}

/** The typical for a shape: the database row when one is loaded, else the built-in list. */
export function typicalFor(key: ExteriorShapeKey, rows: ReadonlyArray<ExteriorTypicalRow> = []): ExteriorTypical {
  const row = rows.find((r) => r.key === key);
  const fromDb = row ? typicalFromRow(row) : null;
  return fromDb ?? EXTERIOR_TYPICALS.find((t) => t.key === key) ?? EXTERIOR_TYPICALS[EXTERIOR_TYPICALS.length - 1];
}

// ---------------------------------------------------------------------------
// Size bands (§5.1): the answer scales the front and side lengths by footprint.
// ---------------------------------------------------------------------------

export type SizeBand = "sm" | "md" | "lg" | "xl" | "ns";
/** Footprint in m² per band: Small ≤120 (100), Medium 120–200 (160), Large 200–300 (250), Very large 300+ (340), Not sure (160, flagged). */
export const SIZE_BAND_M2: Record<SizeBand, number> = { sm: 100, md: 160, lg: 250, xl: 340, ns: 160 };

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * The front and side lengths for a shape at a size band:
 * `footprint = m² ÷ storeys`, `front = √(footprint ÷ (side ÷ front))`,
 * `side = front × ratio`, rounded to 0.5 m. A double storey keeps one wall
 * height for both floors.
 */
export function scaledLengths(t: Pick<ExteriorTypical, "frontM" | "sideM" | "storeys">, band: SizeBand): { frontM: number; sideM: number } {
  const ratio = t.sideM / t.frontM;
  const footprint = SIZE_BAND_M2[band] / t.storeys;
  const front = Math.sqrt(footprint / ratio);
  return { frontM: roundHalf(front), sideM: roundHalf(front * ratio) };
}

/** A side's typical width: front and back take the front length, left and right the side length. */
export function sideWidth(side: ExteriorSideKey, lengths: { frontM: number; sideM: number }): number {
  return side === "front" || side === "back" ? lengths.frontM : lengths.sideM;
}
