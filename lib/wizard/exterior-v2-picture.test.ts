import { describe, expect, it } from "vitest";
import { elevationMarkup } from "@/app/wizard/pictures/Elevation";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { EXTERIOR_SIDE_KEYS, typicalFor, type ExteriorSideKey } from "./exterior-typicals";
import { confirmAllSides, defaultSides, defaultSidesForPart, partsOnSide, setSideCounts } from "./exterior-model";
import type { ExteriorV2 } from "./state";

/**
 * Exterior wizard v2 — Tom's six on the live drawn house (21 Oct 2026):
 *  1. a Gable ends tick on a hip-roof home drew nothing;
 *  2. a bigger size made the house SMALLER; 5. the long sides looked squashed;
 *  3. the windows did not fit in the wall;
 *  4. the window / door counts were only on the walk-around (screen test in
 *     exterior-v2-sides.spec.ts; the model's setter is pinned here);
 *  6. "Looks right — next side" had to be tapped on every side.
 */

const house = (shape: Parameters<typeof houseOfShape>[0], band: ExteriorV2["sizeBand"], parts: ExteriorV2["parts"] = []): ExteriorV2 => {
  const v2 = { ...houseOfShape(shape, null, []), sizeBand: band, parts };
  v2.sides = defaultSides(v2);
  return v2;
};
const num = (m: RegExpMatchArray | null, i = 1) => Number(m?.[i]);
const wallRect = (svg: string) => svg.match(/data-e="walls" data-on="\d"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
const windowRects = (svg: string) => {
  const g = svg.match(/<g class="e e-windows[^"]*" data-e="windows" data-on="\d">([\s\S]*?)<\/g>/)?.[1] ?? "";
  return [...g.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#CFE3EA"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
};
const doorRect = (svg: string) => {
  const g = svg.match(/<g class="e e-doors[^"]*" data-e="doors" data-on="\d">([\s\S]*?)<\/g>/)?.[1] ?? "";
  const m = g.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
};

describe("1 · a gable on a hip-roof home", () => {
  it("lands on the front and is drawn there — a street-facing cross gable", () => {
    const t = typicalFor("wb");
    expect(defaultSidesForPart("gable", t)).toEqual(["front"]);
    const v2 = house("wb", "md", ["walls", "gable"]);
    expect(partsOnSide(v2, "front", t)).toContain("gable");
    const front = elevationMarkup(v2, "front");
    expect(front).toContain('class="e e-gable on');
    expect(elevationMarkup(v2, "right")).not.toContain('data-e="gable"');
    // A gable-roof shape keeps its two gable ends.
    expect(defaultSidesForPart("gable", typicalFor("cal"))).toEqual(["front", "back"]);
  });
});

describe("2 + 5 · the scale", () => {
  it("a bigger house is wider, never shorter — the wall stands the same height at every size", () => {
    const sm = wallRect(elevationMarkup(house("wb", "sm"), "front"))!;
    const xl = wallRect(elevationMarkup(house("wb", "xl"), "front"))!;
    expect(num(xl, 3)).toBeGreaterThan(num(sm, 3));
    expect(num(xl, 4)).toBeCloseTo(num(sm, 4), 5);
    expect(num(sm, 4)).toBeGreaterThan(60); // a single-storey wall is never a sliver
  });
  it("every side of a house stands the same height — the long sides are not squashed", () => {
    for (const shape of ["wb", "cal", "ds", "modern"] as const) {
      const v2 = house(shape, "lg");
      const heights = EXTERIOR_SIDE_KEYS.map((k) => num(wallRect(elevationMarkup(v2, k))!, 4));
      for (const hgt of heights) expect(hgt).toBeCloseTo(heights[0], 5);
    }
  });
  it("the house fills more of the frame than before (the windows need the room), and never leaves it", () => {
    const md = wallRect(elevationMarkup(house("cal", "md"), "front"))!;
    expect(num(md, 3)).toBeGreaterThan(255);
    const xlSide = wallRect(elevationMarkup(house("cal", "xl"), "right"))!;
    expect(num(xlSide, 3)).toBeLessThanOrEqual(316);
    expect(num(xlSide, 1)).toBeGreaterThanOrEqual(42); // room for a downpipe either side
  });
});

describe("3 · the windows fit", () => {
  const inside = (v2: ExteriorV2, side: ExteriorSideKey) => {
    const svg = elevationMarkup(v2, side);
    const wall = wallRect(svg)!;
    const x0 = num(wall, 1), x1 = x0 + num(wall, 3), y0 = num(wall, 2), y1 = y0 + num(wall, 4);
    const wins = windowRects(svg);
    const door = doorRect(svg);
    return { wins, door, x0, x1, y0, y1 };
  };
  it("nine windows and a door on a bungalow's front all sit inside the wall and none overlaps the door or another window", () => {
    const v2 = setSideCounts(house("cal", "md", ["walls", "windows", "doors", "verandah", "posts"]), "front", { windows: 9, doors: 1 });
    const { wins, door, x0, x1, y0, y1 } = inside(v2, "front");
    expect(wins).toHaveLength(9);
    expect(door).not.toBeNull();
    for (const w of wins) {
      expect(w.x).toBeGreaterThanOrEqual(x0);
      expect(w.x + w.w).toBeLessThanOrEqual(x1 + 0.01);
      expect(w.y).toBeGreaterThanOrEqual(y0 - 0.01);
      expect(w.y + w.h).toBeLessThanOrEqual(y1 + 0.01);
      expect(w.x + w.w <= door!.x || w.x >= door!.x + door!.w).toBe(true);
      expect(w.w).toBeGreaterThanOrEqual(4);
    }
    const sorted = [...wins].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
  });
  it("a long side with many windows, a double storey, and a garage front all keep every window in the wall", () => {
    const cases: Array<[ExteriorV2, ExteriorSideKey]> = [
      [setSideCounts(house("wb", "xl", ["walls", "windows"]), "right", { windows: 12 }), "right"],
      [setSideCounts(house("ds", "md", ["walls", "windows", "doors"]), "front", { windows: 11, doors: 2 }), "front"],
      [setSideCounts(house("th", "sm", ["walls", "windows", "doors", "garage"]), "front", { windows: 2, doors: 1 }), "front"],
      [setSideCounts(house("brick", "lg", ["walls", "windows", "doors", "garage"]), "front", { windows: 5, doors: 1 }), "front"],
    ];
    for (const [v2, side] of cases) {
      const { wins, door, x0, x1 } = inside(v2, side);
      expect(wins.length).toBe(v2.sides[side]!.windows);
      for (const w of wins) {
        expect(w.x).toBeGreaterThanOrEqual(x0);
        expect(w.x + w.w).toBeLessThanOrEqual(x1 + 0.01);
        if (door) expect(w.x + w.w <= door.x || w.x >= door.x + door.w || w.y + w.h <= door.y).toBe(true);
      }
      if (door) { expect(door.x).toBeGreaterThanOrEqual(x0); expect(door.x + door.w).toBeLessThanOrEqual(x1 + 0.01); }
    }
  });
});

describe("4 · counts per side", () => {
  it("the setter clamps and keeps the side; the picture draws the new count", () => {
    const v2 = setSideCounts(house("wb", "md", ["walls", "windows"]), "back", { windows: 5 });
    expect(v2.sides.back!.windows).toBe(5);
    expect(windowRects(elevationMarkup(v2, "back"))).toHaveLength(5);
    expect(setSideCounts(v2, "back", { windows: -3 }).sides.back!.windows).toBe(0);
  });
});

describe("6 · no Looks right tap", () => {
  it("Continue confirms every painted side at once and leaves a not-painting side alone", () => {
    const v2 = house("th", "md", ["walls"]);
    expect(v2.sides.left!.paint).toBe(false);
    const all = confirmAllSides(v2);
    expect(all.sides.front!.confirmed).toBe(true);
    expect(all.sides.back!.confirmed).toBe(true);
    expect(all.sides.left!.confirmed).toBe(false);
    expect(all.sides.right!.confirmed).toBe(false);
  });
});
