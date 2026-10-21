import { describe, expect, it } from "vitest";
import { elevationMarkup } from "@/app/wizard/pictures/Elevation";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { typicalFor } from "./exterior-typicals";
import { defaultSides, partExists, setSideCounts } from "./exterior-model";
import { applySideDims, type LooseBlock } from "./sides";
import type { ExteriorV2 } from "./state";

/**
 * Tom's exterior batch, 21 Oct 2026 (the second one) — the pure pieces:
 *  1 + 3. windows and posts share the verandah's bays, never on top of each other;
 *  2.     a weatherboard home has no porch or posts until the verandah is ticked;
 *  4.     shutters sit flush with each window, a pair a window;
 *  12.    a side's new width is the run of its fascias, gutters and eaves.
 * (5–11, 13, 14 are screens — exterior-v2-sides / about / tighten specs.)
 */

const house = (shape: Parameters<typeof houseOfShape>[0], band: ExteriorV2["sizeBand"], parts: ExteriorV2["parts"] = []): ExteriorV2 => {
  const v2 = { ...houseOfShape(shape, null, []), sizeBand: band, parts };
  v2.sides = defaultSides(v2);
  return v2;
};
const group = (svg: string, part: string) => svg.match(new RegExp(`<g class="e e-${part}[^"]*" data-e="${part}" data-on="\\d">([\\s\\S]*?)</g>`))?.[1] ?? "";
const rects = (inner: string, fill?: string) =>
  [...inner.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"([^>]*)>/g)]
    .filter((m) => !fill || m[5].includes(`fill="${fill}"`))
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
const overlaps = (a: { x: number; w: number }, b: { x: number; w: number }) => a.x < b.x + b.w && b.x < a.x + a.w;

describe("2 · a weatherboard home starts without a porch", () => {
  it("draws no verandah or posts until the verandah is ticked; a Californian bungalow keeps its columns", () => {
    const t = typicalFor("wb");
    expect(t.verandah).toBe("none");
    const wb = house("wb", "md", ["walls", "windows", "doors"]);
    expect(partExists(wb, "front", "verandah", t)).toBe(false);
    expect(elevationMarkup(wb, "front")).not.toContain('data-e="verandah"');
    expect(elevationMarkup(wb, "front")).not.toContain('data-e="posts"');
    const ticked = { ...wb, parts: [...wb.parts, "verandah" as const, "posts" as const] };
    expect(elevationMarkup(ticked, "front")).toContain('data-e="posts"');
    expect(partExists(house("cal", "md"), "front", "verandah", typicalFor("cal"))).toBe(true);
  });
});

describe("1 + 3 · windows between the posts", () => {
  it("on a bungalow's front every window sits inside a bay — no window crosses a post or the door", () => {
    const v2 = setSideCounts(house("cal", "md", ["walls", "windows", "doors", "verandah", "posts"]), "front", { windows: 6, doors: 1 });
    const svg = elevationMarkup(v2, "front");
    const posts = rects(group(svg, "posts")).filter((r) => r.h > 20); // the columns, not their plinths
    const wins = rects(group(svg, "windows"), "#CFE3EA");
    const door = rects(group(svg, "doors"))[0];
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(wins).toHaveLength(6);
    for (const w of wins) {
      for (const p of posts) expect(overlaps(w, p), `window at ${w.x} crosses a post at ${p.x}`).toBe(false);
      expect(overlaps(w, door), `window at ${w.x} crosses the door`).toBe(false);
    }
  });
  it("a weatherboard home with its verandah ticked lays the windows out the same way", () => {
    const v2 = setSideCounts(house("wb", "lg", ["walls", "windows", "doors", "verandah", "posts"]), "front", { windows: 5, doors: 1 });
    const svg = elevationMarkup(v2, "front");
    const posts = rects(group(svg, "posts")).filter((r) => r.h > 20);
    const wins = rects(group(svg, "windows"), "#CFE3EA");
    expect(wins).toHaveLength(5);
    for (const w of wins) for (const p of posts) expect(overlaps(w, p)).toBe(false);
  });
});

describe("4 · shutters flush with the windows", () => {
  it("a pair a window, each touching its window's frame", () => {
    const v2 = setSideCounts(house("wb", "md", ["walls", "windows", "shutters"]), "front", { windows: 4, doors: 1 });
    const svg = elevationMarkup(v2, "front");
    const wins = rects(group(svg, "windows"), "#CFE3EA");
    const sh = rects(group(svg, "shutters"));
    expect(sh).toHaveLength(wins.length * 2);
    for (const w of wins) {
      const left = sh.find((s) => Math.abs(s.x + s.w + 1 - w.x) < 0.02);
      const right = sh.find((s) => Math.abs(s.x - (w.x + w.w + 1)) < 0.02);
      expect(left, `no left shutter at ${w.x}`).toBeTruthy();
      expect(right, `no right shutter at ${w.x}`).toBeTruthy();
      expect(left!.y).toBeCloseTo(w.y, 5);
      expect(left!.h).toBeCloseTo(w.h, 5);
    }
  });
});

describe("12 · the width flows to the trims", () => {
  const side = (): LooseBlock => ({
    id: 1, kind: "area", name: "Exterior - Front", type: "Exterior", areaType: "surface",
    L: 12, H: 2.7,
    surfaces: [
      { id: 2, code: "Weatherboards", sharePct: 100, measureL: 12, measureH: 2.7 },
      { id: 3, code: "Fascias", measureL: 12, origin: "customer_stated" }, // the drawn house writes EVERY line customer_stated
      { id: 4, code: "Gutters", measureL: 21.6, origin: "customer_stated" }, // the drawn house's w + 0.8w for a verandah
      { id: 5, code: "Eaves", measureL: 12, origin: "customer_stated", metresTyped: true }, // typed in the editor's metres box
      { id: 6, code: "Fascias", measureL: 13.4, clientLabel: "Barge boards" },
      { id: 7, code: "Hand Rails", measureL: 9.6 },
    ],
    customer: { include: true, size: null, confirmed: false },
  });
  it("every fascia, gutter and eaves line takes the new width — the drawn house's customer_stated lines included; a run typed in the metres box and a handrail stay", () => {
    const r = applySideDims([side()], "front", { lengthM: 15, heightM: 4 });
    expect(r.ok).toBe(true);
    const b = (r as { ok: true; blocks: LooseBlock[] }).blocks[0];
    const m = (id: number) => Number(b.surfaces!.find((s) => Number(s.id) === id)!.measureL);
    expect(b.L).toBe(15);
    expect(b.H).toBe(4);
    expect(m(2)).toBe(15); // the wall follows as it always did
    expect(m(3)).toBe(15);
    expect(m(4)).toBe(15); // was 21.6 — "as standard" the width (Tom)
    expect(m(5)).toBe(12); // typed in the metres box
    expect(m(6)).toBe(15); // the rake too — Tom's rule is the width
    expect(m(7)).toBe(9.6); // a handrail is not a trim
  });
});

describe("vertical timber (Tom, 21 Oct follow-up 3)", () => {
  it("draws brown while stained and the painted blue once About it says Painted", () => {
    const base = house("modern", "md", ["walls"]);
    const stained: ExteriorV2 = { ...base, wall: { ...base.wall, down: "vertical_timber", timberPainted: "no" } };
    const painted: ExteriorV2 = { ...base, wall: { ...base.wall, down: "vertical_timber", timberPainted: "yes" } };
    expect(elevationMarkup(stained, "front")).toContain('fill="#A4683F"');
    expect(elevationMarkup(painted, "front")).not.toContain('fill="#A4683F"');
    expect(elevationMarkup(painted, "front")).toContain('data-e="walls" data-on="1"><rect x="');
    expect(group(elevationMarkup(painted, "front"), "walls")).toContain('fill="#8EE4F0"');
  });
});

describe("winder windows (Tom, 21 Oct follow-up)", () => {
  it("draw as plain square windows — one mullion like a casement, no louvre bars that read as colonial", () => {
    const base = house("wb", "md", ["walls", "windows"]);
    const winder = elevationMarkup({ ...base, windowType: "winder" }, "front");
    const casement = elevationMarkup({ ...base, windowType: "casement" }, "front");
    const colonial = elevationMarkup({ ...base, windowType: "colonial" }, "front");
    const bars = (svg: string) => (group(svg, "windows").match(/<path /g) ?? []).length;
    expect(bars(winder)).toBe(bars(casement));
    expect(bars(winder)).toBeLessThan(bars(colonial));
  });
});
