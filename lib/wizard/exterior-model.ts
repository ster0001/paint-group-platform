/**
 * THE EXTERIOR MODEL — v2 answers to priced lines (Exterior wizard v2 brief
 * §5, S1). Pure: the drawn house (`exterior.v2`), the shape typicals and the
 * rate card's codes in; per-side area nodes, an extras node and deferrals
 * out. Every quantity is written onto the existing surface fields
 * (`measureL`, `measureH`, `qtyOverride`, `count`, `sharePct`) so
 * `lib/pricing` prices it unchanged — no money is computed here.
 *
 * The rules, side by side (§5.2, with the ⚑ defaults of §12):
 *  - walls: `w × h` (single storey); downstairs and upstairs `w × h ÷ 2`
 *    each on a double storey, one row when upstairs is "same" (⚑ 18); a
 *    terrace front carries its parapet in the wall height;
 *  - gable ends: `½ × w × rise` on a gable-roof shape's front and back; a
 *    gable added to any other side is a cross gable `½ × 0.5w × 1.9`;
 *    shingles have no rate row → a $0 placeholder and a deferral (⚑ 4);
 *  - fascias: `w` on eave sides plus the rake of any gable on the side; a
 *    full-gable side is the rake only; a terrace front is the cornice at `w` (⚑ 7);
 *  - gutters: `w` on eave sides, none on a full-gable side, plus `0.8w` for
 *    a verandah on the side (⚑ 7);
 *  - downpipes: 1 per side, 2 when `w > 10` (⚑ 11); eaves: `w`;
 *  - windows and doors: the side's own count, defaulted from the width
 *    (`round(w ÷ 4.5)` front/back, `round(w ÷ 5)` sides, × storeys — ⚑ 12);
 *  - garage 1 or 2 car; posts `max(2, round(0.8w ÷ 2.6) + 1)`; verandah
 *    ceiling `0.8w × 2.4`; handrail `0.8w` (⚑ 8); shutters `2 × windows` at
 *    `Wood Shutters` (⚑ 9);
 *  - around the house: fences by the stated metres, deck by the stated m²,
 *    pergola on its top's footprint (Tom, 5 Oct), shed, boundary wall
 *    `m × 1.8`, side gate, meter box, security door.
 *
 * Condition and access are not priced here — `applyConditionPricing` reads
 * `exterior.condition` (the worst side) and `storeys` exactly as before.
 */
import type { DraftArea, DraftSurface } from "@/lib/extract/draft";
import { pergolaItemsForTop, pergolaTopLabel } from "@/lib/pricing/pergola";
import { extSurface, EXTERIOR_WINDOW_CODE, FENCE_CODE } from "./starter";
import {
  EXTERIOR_SIDE_KEYS, scaledLengths, sideWidth, typicalFor,
  type ExteriorSideKey, type ExteriorTypical, type ExteriorTypicalRow, type WallMaterial,
} from "./exterior-typicals";
import type { ExteriorV2, ExteriorV2Side, ExteriorPart, ExteriorExtra } from "./state";

export type Deferral = { room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string };

/** The block name each side has always had on the tree (the sides editor matches on it). */
export const SIDE_NODE_NAME: Record<ExteriorSideKey, string> = {
  front: "Exterior - Front", right: "Exterior - Right", back: "Exterior - Rear", left: "Exterior - Left",
};

/** §5.1: the wall materials offered, each a rate row. Bare brick is its own row (3 coats); vertical timber is stained at Cutek unless painted. */
export const WALL_MATERIAL_CODE: Record<WallMaterial, string> = {
  weatherboards: "Weatherboards",
  render: "Render",
  brick: "Brick",
  stucco: "Stucco",
  cement_sheet: "Cement Sheet",
  colorbond: "Colorbond Cladding",
  vertical_timber: "Cutek",
  concrete: "Concrete / Tilt Slab",
};
export const BARE_BRICK_CODE = "Brick (Unpainted)";
export const PAINTED_VERTICAL_TIMBER_CODE = "Weatherboards";

export const PART_LABEL: Record<ExteriorPart, string> = {
  walls: "The walls", gable: "Gable ends", fascias: "Fascias", gutters: "Gutters", downpipes: "Downpipes", eaves: "Eaves",
  windows: "Windows", doors: "Doors", garage: "Garage door", shutters: "Window shutters",
  verandah: "Verandah or porch", posts: "Posts / columns", ceiling: "Verandah ceiling", handrail: "Handrail / balustrade",
};

/** Where a whole-house tick lands (§5.2): the front for the verandah family, the garage and shutters; the gable sides for a gable; all four for the rest. */
export function defaultSidesForPart(part: ExteriorPart, t: ExteriorTypical): ExteriorSideKey[] {
  if (part === "gable") return t.roof === "gable" ? ["front", "back"] : [];
  if (part === "verandah" || part === "posts" || part === "ceiling" || part === "handrail" || part === "garage" || part === "shutters") return ["front"];
  return [...EXTERIOR_SIDE_KEYS];
}

/** ⚑ 12: the default window count for a side from its width, × storeys. */
export function defaultWindowCount(side: ExteriorSideKey, w: number, storeys: 1 | 2): number {
  const perStorey = side === "front" || side === "back" ? Math.round(w / 4.5) : Math.round(w / 5);
  return Math.max(0, perStorey) * storeys;
}
/** The default door count: one at the front (the front door), one at the back, none on the sides. */
export function defaultDoorCount(side: ExteriorSideKey): number {
  return side === "front" || side === "back" ? 1 : 0;
}

/** Which of the shape's usual shared sides are OPEN after "Where is it in the row?" (⚑ 10). */
export function sharedSidesAfterRow(t: ExteriorTypical, rowPosition: ExteriorV2["rowPosition"]): ExteriorSideKey[] {
  if (t.sharedSides.length === 0) return [];
  if (rowPosition === "both") return [];
  const open = rowPosition === "left" ? ["left"] : rowPosition === "right" ? ["right"] : [];
  return t.sharedSides.filter((s) => !open.includes(s));
}

/**
 * The per-side record a fresh v2 session starts from: the shape's sizes at
 * the band, the shared sides not painting, the counts from the width —
 * nothing confirmed, nothing checked. The screens (S2–S5) mutate from here.
 */
export function defaultSides(v2: Pick<ExteriorV2, "propertyType" | "sizeBand" | "rowPosition">, rows: ReadonlyArray<ExteriorTypicalRow> = []): Record<ExteriorSideKey, ExteriorV2Side> {
  const t = typicalFor(v2.propertyType, rows);
  const lengths = scaledLengths(t, v2.sizeBand ?? "ns");
  const shared = new Set(sharedSidesAfterRow(t, v2.rowPosition));
  const out = {} as Record<ExteriorSideKey, ExteriorV2Side>;
  for (const k of EXTERIOR_SIDE_KEYS) {
    const w = sideWidth(k, lengths);
    out[k] = {
      paint: !shared.has(k), shared: shared.has(k),
      w, h: t.wallHM, adjusted: false,
      off: [], add: [], material: null, materialUp: null,
      confirmed: false,
      windows: defaultWindowCount(k, w, t.storeys), doors: defaultDoorCount(k),
      cond: null, size: null, checked: false,
    };
  }
  return out;
}

/** The parts on one side: the whole-house ticks that land there, minus the ones taken off, plus the ones added. */
export function partsOnSide(v2: ExteriorV2, side: ExteriorSideKey, t: ExteriorTypical): ExteriorPart[] {
  const s = v2.sides[side];
  const on = new Set<ExteriorPart>();
  for (const p of v2.parts) if (defaultSidesForPart(p, t).includes(side)) on.add(p);
  for (const p of s?.off ?? []) on.delete(p);
  for (const p of s?.add ?? []) on.add(p);
  return [...on];
}

/**
 * Has the Painting step been answered? Until it has (S2 ships the home step
 * alone), the house is a shape and a size: the v1 screens still collect the
 * parts and the v1 scaffold still lays the lines — sized from the drawn house.
 */
export function exteriorV2Answered(v2: Pick<ExteriorV2, "parts" | "extras">): boolean {
  return v2.parts.length > 0 || v2.extras.length > 0;
}

/**
 * The shape, size or row position changed: re-seed the sides from the new
 * typicals, keeping everything the customer has already said on a side (its
 * parts on and off, its own material, its condition) and a width or height
 * they adjusted by hand. Shared-or-not follows the new answer.
 */
export function reseedSides(v2: ExteriorV2, rows: ReadonlyArray<ExteriorTypicalRow> = []): ExteriorV2["sides"] {
  const fresh = defaultSides(v2, rows);
  const out: ExteriorV2["sides"] = {};
  for (const k of EXTERIOR_SIDE_KEYS) {
    const prev = v2.sides[k];
    const next = fresh[k];
    if (!prev) { out[k] = next; continue; }
    const keepSize = prev.adjusted;
    out[k] = {
      ...next,
      off: prev.off, add: prev.add, material: prev.material, materialUp: prev.materialUp,
      cond: prev.cond,
      w: keepSize ? prev.w : next.w, h: keepSize ? prev.h : next.h, adjusted: prev.adjusted,
      windows: prev.checked ? prev.windows : next.windows, doors: prev.checked ? prev.doors : next.doors,
      size: prev.size, checked: prev.checked, confirmed: prev.confirmed && next.paint === prev.paint,
      // A side the customer took off stays off; a side they added back stays on unless it is now shared.
      paint: next.shared ? false : prev.shared ? true : prev.paint,
    };
  }
  return out;
}

/**
 * Does the house HAVE this part on this side — drawn grey when it is not
 * being painted (the picture's question, not the price's)?
 */
export function partExists(v2: ExteriorV2, side: ExteriorSideKey, part: ExteriorPart, t: ExteriorTypical): boolean {
  const on = new Set(partsOnSide(v2, side, t));
  if (part === "walls" || part === "fascias" || part === "gutters" || part === "downpipes" || part === "eaves" || part === "windows" || part === "doors") return true;
  if (part === "gable") return (t.roof === "gable" && (side === "front" || side === "back")) || on.has("gable");
  if (part === "verandah") return (t.verandah !== "none" && side === "front") || on.has("verandah");
  if (part === "posts" || part === "ceiling" || part === "handrail") return partExists(v2, side, "verandah", t) && (on.has(part) || (v2.parts.includes(part) && defaultSidesForPart(part, t).includes(side)));
  return on.has(part) || (v2.parts.includes(part) && defaultSidesForPart(part, t).includes(side));
}

/** The Painting step's groups (brief §7.2), in order. */
export const PART_GROUPS: ReadonlyArray<{ key: "house" | "roof" | "open" | "verandah"; label: string; parts: ExteriorPart[] }> = [
  { key: "house", label: "On the house", parts: ["walls", "gable"] },
  { key: "roof", label: "Roofline", parts: ["fascias", "gutters", "downpipes", "eaves"] },
  { key: "open", label: "Windows & doors", parts: ["windows", "doors", "garage", "shutters"] },
  { key: "verandah", label: "Verandah or porch", parts: ["verandah", "posts", "ceiling", "handrail"] },
];
/** The verandah family is offered once the verandah is ticked. */
export const VERANDAH_PARTS: ExteriorPart[] = ["posts", "ceiling", "handrail"];

export const EXTRA_LABEL: Record<ExteriorExtra, string> = {
  paling_fence: "Paling fence", picket_fence: "Picket fence", deck: "Deck", pergola: "Pergola", shed: "Shed / garage",
  wall: "Boundary wall", side_gate: "Side gate", meter_box: "Meter box", security_door: "Security door",
};

/** Tick or untick a part. Unticking the verandah takes its posts, ceiling and handrail with it (they need it). */
export function togglePart(v2: ExteriorV2, part: ExteriorPart): ExteriorV2 {
  const on = v2.parts.includes(part);
  let parts = on ? v2.parts.filter((p) => p !== part) : [...v2.parts, part];
  if (on && part === "verandah") parts = parts.filter((p) => !VERANDAH_PARTS.includes(p));
  if (!on && VERANDAH_PARTS.includes(part) && !parts.includes("verandah")) parts = ["verandah", ...parts];
  return { ...v2, parts };
}

export function toggleExtra(v2: ExteriorV2, extra: ExteriorExtra): ExteriorV2 {
  const on = v2.extras.includes(extra);
  return { ...v2, extras: on ? v2.extras.filter((e) => e !== extra) : [...v2.extras, extra] };
}

/** Paint this side or not (the old Which-sides screen and S4's Not painting toggle). */
export function setSidePaint(v2: ExteriorV2, side: ExteriorSideKey, paint: boolean): ExteriorV2 {
  const s = v2.sides[side];
  if (!s) return v2;
  return { ...v2, sides: { ...v2.sides, [side]: { ...s, paint, confirmed: false, checked: false } } };
}

/** Does any wall — the house or a side — say brick? (The painted-before question.) */
export function anyBrick(v2: ExteriorV2): boolean {
  const mats = [v2.wall.down, v2.wall.up, ...EXTERIOR_SIDE_KEYS.flatMap((k) => [v2.sides[k]?.material, v2.sides[k]?.materialUp])];
  return mats.includes("brick");
}
export function anyVerticalTimber(v2: ExteriorV2): boolean {
  const mats = [v2.wall.down, v2.wall.up, ...EXTERIOR_SIDE_KEYS.flatMap((k) => [v2.sides[k]?.material, v2.sides[k]?.materialUp])];
  return mats.includes("vertical_timber");
}

/** What About it still needs before the sides (the Continue gate): the walls' material, a ticked pergola's top. */
export function aboutMissing(v2: ExteriorV2): string | null {
  if (v2.parts.includes("walls") && !v2.wall.down) return "What are the walls made of? Tap one.";
  if (v2.extras.includes("pergola") && !(v2.extraSizes.pergola_l > 0 && v2.extraSizes.pergola_w > 0)) return "Roughly how big is the pergola top? Length and width in metres.";
  return null;
}

/** The worst condition answered across the painted sides; null while any painted side is unanswered. */
export function worstCondition(v2: ExteriorV2): "good" | "weathered" | "peeling" | null {
  const rank = { good: 0, weathered: 1, peeling: 2 } as const;
  let worst: keyof typeof rank | null = null;
  for (const k of EXTERIOR_SIDE_KEYS) {
    const s = v2.sides[k];
    if (!s || !s.paint) continue;
    if (s.cond == null) return null;
    if (worst == null || rank[s.cond] > rank[worst]) worst = s.cond;
  }
  return worst;
}

/** The sides being painted, in the tree's order. */
export function paintedSides(v2: ExteriorV2): ExteriorSideKey[] {
  return EXTERIOR_SIDE_KEYS.filter((k) => v2.sides[k]?.paint);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const CROSS_GABLE_RISE_M = 1.9;
const VERANDAH_SHARE = 0.8;
const VERANDAH_DEPTH_M = 2.4;
const POST_SPACING_M = 2.6;
const BOUNDARY_WALL_H_M = 1.8;

type Surface = DraftArea["surfaces"][number];

function line(nextId: () => number, code: string, over: Partial<DraftSurface> = {}): Surface {
  return { ...extSurface(nextId(), code), origin: "customer_stated", confidence: 0.8, assumedFields: [], ...over };
}

/** The wall rate code for a material and the brick / timber answers (§5.2). */
export function wallCode(material: WallMaterial, wall: ExteriorV2["wall"]): string {
  if (material === "brick" && wall.brickPainted === "no") return BARE_BRICK_CODE;
  if (material === "vertical_timber" && wall.timberPainted === "yes") return PAINTED_VERTICAL_TIMBER_CODE;
  return WALL_MATERIAL_CODE[material];
}

/** The rake of a gable: both sloping edges, for the barge boards (⚑ 7). */
export function gableRake(gableWidthM: number, riseM: number): number {
  return 2 * Math.sqrt((gableWidthM / 2) ** 2 + riseM ** 2);
}

/** ⚑ 8: posts along the verandah. */
export function postCount(w: number): number {
  return Math.max(2, Math.round((w * VERANDAH_SHARE) / POST_SPACING_M) + 1);
}

export type ExteriorV2Nodes = { areas: DraftArea[]; deferred: Deferral[] };

/**
 * The tree for a v2 session: one node per painted side, each with its parts
 * as lines, plus "Exterior - Extras" for the things around the house.
 */
export function exteriorV2Nodes(
  v2: ExteriorV2,
  nextId: () => number,
  rows: ReadonlyArray<ExteriorTypicalRow> = [],
  /** The live card's codes; a part whose row is missing is deferred, never priced at a guess. */
  rateCodes: ReadonlySet<string> | null = null,
): ExteriorV2Nodes {
  const t = typicalFor(v2.propertyType, rows);
  const areas: DraftArea[] = [];
  const deferred: Deferral[] = [];
  const has = (code: string) => rateCodes == null || rateCodes.has(code);
  const storeys = t.storeys;

  if (v2.propertyType === "other") {
    deferred.push({ room: "Exterior", areaId: null, what: "home type to confirm", count: 1, kind: "exterior_type_unsure",
      needs: "the customer chose Something else — the sizes are a placeholder; confirm the shape and sizes on the visit" });
  }

  for (const side of paintedSides(v2)) {
    const s = v2.sides[side];
    if (!s) continue;
    const id = nextId();
    const parts = new Set(partsOnSide(v2, side, t));
    const w = s.w;
    const fullGable = t.roof === "gable" && (side === "front" || side === "back") && parts.has("gable");
    const crossGable = !fullGable && parts.has("gable");
    const terraceFront = t.roof === "parapet" && side === "front";
    const rise = t.gableRiseM ?? 0;
    // A terrace front carries its parapet in the wall height (the cornice and mouldings are the fascia line).
    const h = terraceFront ? round2(s.h + rise) : s.h;
    const surfaces: Surface[] = [];
    const sizeConfirmed = s.size === "yes" || s.size === "adj";

    // The walls — the house's material(s), or this side's own.
    if (parts.has("walls")) {
      const down = s.material ?? v2.wall.down;
      const up = s.materialUp ?? v2.wall.up;
      if (!down) {
        deferred.push({ room: SIDE_NODE_NAME[side], areaId: id, what: "wall material to confirm", count: 1, kind: "exterior_material",
          needs: "the walls are ticked but no material was chosen — priced at a placeholder; confirm the material before send" });
        surfaces.push(line(nextId, WALL_MATERIAL_CODE.weatherboards, { sharePct: 100, measureL: w, measureH: h, origin: "ai_assumed", confidence: 0.4, assumedFields: ["material"], internalLabel: "Walls (material to confirm)", clientLabel: "Walls — material to confirm" }));
      } else if (storeys === 2 && up && up !== down) {
        // ⚑ 18: equal halves — each row is w × h ÷ 2, written as the editor writes a share (L × pct ÷ 100 × H).
        surfaces.push(line(nextId, wallCode(down, v2.wall), { sharePct: 50, measureL: round2(w * 0.5), measureH: h, internalLabel: "Walls — downstairs", clientLabel: "Walls — downstairs" }));
        surfaces.push(line(nextId, wallCode(up, v2.wall), { sharePct: 50, measureL: round2(w * 0.5), measureH: h, internalLabel: "Walls — upstairs", clientLabel: "Walls — upstairs" }));
      } else {
        surfaces.push(line(nextId, wallCode(down, v2.wall), { sharePct: 100, measureL: w, measureH: h, internalLabel: "Walls", clientLabel: "Walls" }));
      }
      if ((down === "vertical_timber" || up === "vertical_timber") && v2.wall.timberPainted !== "yes") {
        if (!deferred.some((d) => d.kind === "exterior_timber_stain")) deferred.push({ room: "Exterior", areaId: null, what: "vertical timber — stained, not painted", count: 1, kind: "exterior_timber_stain",
          needs: "priced at the Cutek staining rate; tell the estimator if it is painted and it moves to the weatherboard rate" });
      }
    }

    // Gable ends.
    if (fullGable || crossGable) {
      const gw = fullGable ? w : round2(w * 0.5);
      const gr = fullGable ? rise : CROSS_GABLE_RISE_M;
      const m2 = round2(0.5 * gw * gr);
      const fill = v2.gableFill;
      const label = `Gable end — ${fill === "stucco" ? "stucco" : fill === "boards" ? "weatherboards" : fill === "strap" ? "strapping" : fill === "shingles" ? "shingles" : "fill to confirm"}`;
      if (fill === "shingles" || fill == null) {
        // ⚑ 4: no row — a $0 placeholder the range calls "not in this number".
        surfaces.push(line(nextId, "Gable Shingles", { qtyOverride: m2, priceOverride: 0, internalLabel: label, clientLabel: label, origin: "ai_assumed", confidence: 0.4, assumedFields: ["gable_fill"] }));
        if (!deferred.some((d) => d.kind === "exterior_shingles")) deferred.push({ room: "Exterior", areaId: null, what: fill === "shingles" ? "shingles — priced by your estimator" : "gable fill to confirm", count: 1, kind: "exterior_shingles",
          needs: fill === "shingles" ? "no shingles row on the card — priced on the visit, shown on the range as not in this number" : "the customer did not say what fills the gable — confirm on the visit" });
      } else if (fill === "strap") {
        if (has("Strapping")) surfaces.push(line(nextId, "Strapping", { count: 1, internalLabel: "Gable strapping", clientLabel: "Gable strapping" }));
        if (has("Stucco")) surfaces.push(line(nextId, "Stucco", { qtyOverride: m2, internalLabel: label, clientLabel: label }));
      } else {
        surfaces.push(line(nextId, fill === "stucco" ? "Stucco" : "Weatherboards", { qtyOverride: m2, internalLabel: label, clientLabel: label }));
      }
    }

    // Roofline (⚑ 7, ⚑ 11).
    const rake = fullGable ? gableRake(w, rise) : crossGable ? gableRake(w * 0.5, CROSS_GABLE_RISE_M) : 0;
    if (parts.has("fascias")) {
      const metres = terraceFront ? w : fullGable ? rake : w + rake;
      surfaces.push(line(nextId, "Fascias", { measureL: round2(metres), clientLabel: terraceFront ? "Cornice and mouldings" : fullGable ? "Barge boards" : "Fascias" }));
    }
    if (parts.has("gutters")) {
      // None on a full-gable side; a verandah brings its own run either way.
      const metres = (fullGable ? 0 : w) + (parts.has("verandah") ? w * VERANDAH_SHARE : 0);
      if (metres > 0) surfaces.push(line(nextId, "Gutters", { measureL: round2(metres) }));
    }
    if (parts.has("downpipes")) surfaces.push(line(nextId, "Downpipes", { count: w > 10 ? 2 : 1 }));
    if (parts.has("eaves")) surfaces.push(line(nextId, "Eaves", { measureL: w }));

    // Windows and doors — the side's own counts.
    if (parts.has("windows") && s.windows > 0) {
      if (v2.windowType === "alu") {
        if (!deferred.some((d) => d.kind === "exterior_windows_alu")) deferred.push({ room: "Exterior", areaId: null, what: "aluminium windows — usually not painted", count: s.windows, kind: "exterior_windows_alu",
          needs: "priced at nothing; check on site whether any frames are to be painted" });
      } else {
        surfaces.push(line(nextId, EXTERIOR_WINDOW_CODE[v2.windowType], { count: s.windows }));
        if ((v2.windowType === "winder" || v2.windowType === "unsure") && !deferred.some((d) => d.kind === "exterior_window_style")) deferred.push({ room: "Exterior", areaId: null, what: "window style to confirm", count: s.windows, kind: "exterior_window_style",
          needs: v2.windowType === "winder" ? "winder windows priced at the casement rate — confirm before send" : "priced at the fixed / picture placeholder — confirm the style before send" });
      }
    }
    if (parts.has("doors") && s.doors > 0) {
      const front = side === "front" ? 1 : 0;
      if (front) surfaces.push(line(nextId, "Front Door", { count: 1 }));
      if (s.doors - front > 0) surfaces.push(line(nextId, "Standard Door (1 Side)", { count: s.doors - front }));
    }
    if (parts.has("garage")) surfaces.push(line(nextId, v2.garageCars === 2 ? "Garage Door (2 Car)" : "Garage Door (1 Car)", { count: 1 }));
    if (parts.has("shutters") && s.windows > 0) surfaces.push(line(nextId, "Wood Shutters", { count: 2 * s.windows }));

    // The verandah family (⚑ 8).
    if (parts.has("posts")) {
      const n = postCount(w);
      const kind = v2.postKind ?? (t.verandah === "columns" ? "columns" : "posts");
      surfaces.push(line(nextId, kind === "columns" ? "Columns" : "Posts", { count: n, clientLabel: kind === "lace" ? "Iron posts" : kind === "columns" ? "Columns" : "Posts" }));
      if (kind === "lace" && !deferred.some((d) => d.kind === "exterior_lacework")) deferred.push({ room: "Exterior", areaId: null, what: "iron lacework", count: 1, kind: "exterior_lacework",
        needs: "the posts are priced at the Posts rate; the lace frieze and brackets have no rate row — your estimator prices them" });
    }
    if (parts.has("ceiling")) surfaces.push(line(nextId, "Soffits / Exterior Ceilings", { qtyOverride: round2(w * VERANDAH_SHARE * VERANDAH_DEPTH_M), clientLabel: "Verandah ceiling" }));
    if (parts.has("handrail")) surfaces.push(line(nextId, "Hand Rails", { measureL: round2(w * VERANDAH_SHARE), clientLabel: "Handrail / balustrade" }));

    const assumedFields = ["exterior_envelope", ...(sizeConfirmed ? [] : ["L", "H"])];
    areas.push({
      id, kind: "area", name: SIDE_NODE_NAME[side], type: "Exterior", areaType: "surface",
      roomType: "exterior", storey: "ground",
      L: w, W: 0, H: h,
      isOption: false, description: "", open: false, media: [],
      origin: sizeConfirmed ? "customer_stated" : "ai_assumed", confidence: sizeConfirmed ? 0.8 : 0.4,
      assumedFields,
      extractionSourceId: null,
      surfaces,
      // The sides editor's own per-side answers, pre-filled so it re-asks nothing (§7.7).
      customer: { include: true, size: s.size === "adj" ? "adjusted" : s.size, confirmed: s.checked },
    } as DraftArea);
    if (s.size === "ns") {
      deferred.push({ room: SIDE_NODE_NAME[side], areaId: id, what: "side size not sure", count: 1, kind: `exterior_size_unsure:${side}`,
        needs: `the customer was not sure of this side's size — priced at the typical ${w} × ${h} m; measure it on the visit` });
    } else if (!sizeConfirmed) {
      deferred.push({ room: SIDE_NODE_NAME[side], areaId: id, what: "wall + trim measurements", count: 1, kind: "exterior_width",
        needs: `typical size for a ${t.name.toLowerCase()} (${w} × ${h} m) until the customer checks this side` });
    }
  }

  // Around the house.
  const extras = extrasLines(v2, nextId, deferred);
  if (extras.length) {
    const id = nextId();
    areas.push({
      id, kind: "area", name: "Exterior - Extras", type: "Exterior", areaType: "surface",
      roomType: "exterior", storey: "ground", L: 0, W: 0, H: 0,
      isOption: false, description: "", open: false, media: [],
      origin: "customer_stated", confidence: 0.8, assumedFields: ["exterior_envelope"], extractionSourceId: null,
      surfaces: extras,
    });
    for (const d of deferred) if (d.room === "Exterior - Extras" && d.areaId === null) d.areaId = id;
  }

  return { areas, deferred };
}

const EXTRA_ITEM_CODE: Partial<Record<ExteriorExtra, string>> = { shed: "Shed", side_gate: "Side Gate", meter_box: "Meter Box", security_door: "Security Door" };

function extrasLines(v2: ExteriorV2, nextId: () => number, deferred: Deferral[]): Surface[] {
  const out: Surface[] = [];
  const size = (k: string): number | null => (typeof v2.extraSizes[k] === "number" && v2.extraSizes[k] > 0 ? v2.extraSizes[k] : null);
  const measure = (what: string) => deferred.push({ room: "Exterior - Extras", areaId: null, what: `${what} measurements`, count: 1, kind: "exterior_width",
    needs: "ticked on the painting screen with no size - measure on site and enter it in the builder" });
  for (const e of v2.extras) {
    if (e === "paling_fence" || e === "picket_fence") {
      const m = size("fence");
      out.push(line(nextId, e === "paling_fence" ? FENCE_CODE.paling : FENCE_CODE.picket_hand, { measureL: m, clientLabel: e === "paling_fence" ? "Paling fence" : "Picket fence (brushed)" }));
      if (m == null) measure("Fence");
    } else if (e === "deck") {
      const m2 = size("deck");
      out.push(line(nextId, "Deck Painting", { qtyOverride: m2, clientLabel: "Deck" }));
      if (m2 == null) measure("Deck");
    } else if (e === "pergola") {
      const l = size("pergola_l"), w = size("pergola_w");
      if (l != null && w != null) {
        out.push(line(nextId, "Pergola", { qtyOverride: pergolaItemsForTop(l, w), clientLabel: pergolaTopLabel(l, w), internalLabel: pergolaTopLabel(l, w) }));
      } else {
        out.push(line(nextId, "Pergola", { clientLabel: "Pergola", origin: "ai_assumed", confidence: 0.4, assumedFields: ["exterior_envelope"] }));
        measure("Pergola");
      }
    } else if (e === "wall") {
      const m = size("wall");
      const mat = v2.extraWallMaterial ?? "brick";
      out.push(line(nextId, mat === "render" ? "Render" : "Brick", { measureL: m, measureH: m != null ? BOUNDARY_WALL_H_M : null, clientLabel: "Boundary wall" }));
      if (m == null) measure("Boundary wall");
    } else {
      const code = EXTRA_ITEM_CODE[e];
      if (code) out.push(line(nextId, code, { count: 1 }));
    }
  }
  return out;
}

/**
 * The confirm loop's map for the envelope (§5.3): a side the customer
 * checked with a size answer of "Looks right" or "Adjust" is confirmed; a
 * side answered "Not sure" stays assumed and counts as unconfirmed (⚑ 13);
 * the extras node is never confirmable and stays out of the share.
 */
export function confirmedSidesMap(areas: ReadonlyArray<Pick<DraftArea, "id" | "name">>, v2: ExteriorV2): Map<number, "pending" | "confirmed"> {
  const map = new Map<number, "pending" | "confirmed">();
  for (const side of EXTERIOR_SIDE_KEYS) {
    const a = areas.find((x) => x.name === SIDE_NODE_NAME[side]);
    const s = v2.sides[side];
    if (!a || !s?.paint) continue;
    map.set(a.id, s.checked && (s.size === "yes" || s.size === "adj") ? "confirmed" : "pending");
  }
  return map;
}
