import type { QuoteRoom } from "./cards";

/**
 * QUOTE STAGE v10 §4 — THE ROOM DRAWING, as data (R5: the drawing redraws
 * with every answer). Pure: what the picture shows for a room (which
 * layers, how many openings and where, the robe, the prep marks, the
 * feature tint) and the layout rule for the openings. `MobilePicture`
 * draws it; this module never touches the DOM.
 */
export type WinSize = "S" | "M" | "L";
export type PrepKey = "crack" | "hole" | "flaking" | "water" | "mould" | "wallpaper";

export type QuoteRoomPicture = {
  /** The share of the walls being painted; null = walls not painted (grey). */
  wallsPct: number | null;
  ceiling: boolean;
  cornices: boolean;
  skirting: boolean;
  architraves: boolean;
  doors: number;
  windows: number;
  winSize: WinSize;
  /** A built-in robe on the right wall, once the room says it has one; which of its faces are painted. */
  robe: { doors: boolean; inside: boolean } | null;
  prep: PrepKey[];
  featureWall: boolean;
};

export type Opening = { kind: "door" | "win"; key: string; wall: "back" | "left" | "right"; x: number; y: number; w: number; h: number };

/** The drawn size of a window at each size band (200 × 120 picture). */
export const WIN_SIZE: Record<WinSize, [number, number]> = { S: [16, 13], M: [24, 20], L: [34, 26] };
const DOOR_W = 16, DOOR_H = 40, GAP = 6, BACK_X0 = 54, BACK_W = 92;

/**
 * §4 — the layout rule: windows first, then doors, spread evenly along the
 * back wall; when the back wall is full, extra doors go to the right wall
 * and extra windows to the left wall (drawn with the perspective skew),
 * never overlapping.
 */
export function layoutOpenings(doors: number, windows: number, winSize: WinSize, robe = false): Opening[] {
  const [ww, wh] = WIN_SIZE[winSize];
  const items: Array<{ kind: "door" | "win"; w: number; h: number; key: string }> = [];
  for (let k = 0; k < windows; k++) items.push({ kind: "win", w: ww, h: wh, key: `win-${k}-${winSize}` });
  for (let k = 0; k < doors; k++) items.push({ kind: "door", w: DOOR_W, h: DOOR_H, key: `door-${k}` });
  const back: typeof items = [], left: typeof items = [], right: typeof items = [];
  let used = 0;
  for (const it of items) {
    if (used + it.w <= BACK_W) { back.push(it); used += it.w + GAP; }
    // a robe sits on the right wall: the overflow goes left first (S7 independent check, defect 9)
    else if (it.kind === "door" && !robe && right.length < 2) right.push(it);
    else if (left.length < 3) left.push(it);
    else right.push(it);
  }
  const out: Opening[] = [];
  const total = back.reduce((a, b) => a + b.w, 0);
  const free = BACK_W - total;
  const g = back.length > 1 ? free / (back.length + 1) : free / 2;
  let x = BACK_X0 + g;
  for (const it of back) {
    out.push({ kind: it.kind, key: it.key, wall: "back", x: round(x), y: it.kind === "door" ? 50 : 42, w: it.w, h: it.h });
    x += it.w + g;
  }
  let lx = 8;
  for (const it of left) { out.push({ kind: it.kind, key: it.key, wall: "left", x: lx, y: it.kind === "door" ? 50 : 38, w: it.w, h: it.h }); lx += it.w + GAP; }
  let rx = 192;
  for (const it of right) { rx -= it.w; out.push({ kind: it.kind, key: it.key, wall: "right", x: rx, y: it.kind === "door" ? 50 : 38, w: it.w, h: it.h }); rx -= GAP; }
  return out;
}
const round = (n: number) => Math.round(n * 100) / 100;

/** True when two openings on the same wall overlap (the layout rule's invariant, tested). */
export function overlaps(a: Opening, b: Opening): boolean {
  if (a.wall !== b.wall) return false;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The prep mark for a repair line, read from the platform's own label for it. */
export function prepKeyFor(label: string): PrepKey | null {
  const l = label.toLowerCase();
  if (/crack/.test(l)) return "crack";
  if (/hole|dent/.test(l)) return "hole";
  if (/flak|peel/.test(l)) return "flaking";
  if (/water/.test(l)) return "water";
  if (/mould|mold/.test(l)) return "mould";
  if (/wallpaper/.test(l)) return "wallpaper";
  return null;
}

/** What the picture shows for a room — from the one room model the stage keeps (`quoteRoomsFrom`). */
export function quotePictureFrom(r: QuoteRoom): QuoteRoomPicture {
  const tile = (key: string) => r.tiles.find((t) => String(t.key) === key);
  const on = (key: string) => tile(key)?.on === true;
  const walls = tile("walls");
  const doors = tile("doors");
  const windows = tile("windows");
  const winCount = windows?.on ? (r.windows.length ? r.windows.reduce((n, w) => n + w.count, 0) : (windows.count ?? 1)) : 0;
  const winSize = (r.windows[0]?.sizeBand ?? "M") as WinSize;
  const robeOn = r.cupboard?.on === true || r.cupboardInterior?.on === true;
  const prep = Array.from(new Set(r.spots.map((s) => prepKeyFor(s.label)).filter((k): k is PrepKey => k != null)));
  if (r.extras.wallpaper && !prep.includes("wallpaper")) prep.push("wallpaper");
  return {
    wallsPct: walls?.on ? (walls.wallsPct ?? 100) : null,
    ceiling: on("ceilings"),
    cornices: on("cornices"),
    skirting: on("skirting"),
    architraves: on("architraves"),
    doors: doors?.on ? (doors.count ?? 1) : 0,
    windows: winCount,
    winSize,
    robe: robeOn ? { doors: r.cupboard?.on === true, inside: r.cupboardInterior?.on === true } : null,
    prep,
    featureWall: r.extras.featureWalls > 0,
  };
}
