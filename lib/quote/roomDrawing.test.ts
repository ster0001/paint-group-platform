import { describe, expect, it } from "vitest";
import { layoutOpenings, overlaps, prepKeyFor, quotePictureFrom } from "./roomDrawing";
import type { QuoteRoom } from "./cards";

describe("quote stage v10 §4 — the room drawing as data", () => {
  it("windows first, then doors, spread along the back wall", () => {
    const o = layoutOpenings(1, 1, "M");
    expect(o.map((x) => [x.kind, x.wall])).toEqual([["win", "back"], ["door", "back"]]);
    expect(o[0].x).toBeLessThan(o[1].x);
  });
  it("3 windows + 3 doors never overlap: the extras spill to the side walls", () => {
    for (const size of ["S", "M", "L"] as const) {
      const o = layoutOpenings(3, 3, size);
      expect(o).toHaveLength(6);
      for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) expect(overlaps(o[i], o[j]), `${size}: ${o[i].key} vs ${o[j].key}`).toBe(false);
      expect(o.some((x) => x.wall !== "back")).toBe(true);
      expect(o.filter((x) => x.kind === "door" && x.wall === "right").length).toBeGreaterThan(0);
    }
    const big = layoutOpenings(6, 6, "L");
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) expect(overlaps(big[i], big[j])).toBe(false);
  });
  it("S / M / L resizes and gives each window a new key (so it sweeps in again)", () => {
    expect(layoutOpenings(0, 1, "S")[0].w).toBeLessThan(layoutOpenings(0, 1, "L")[0].w);
    expect(layoutOpenings(0, 1, "S")[0].key).not.toBe(layoutOpenings(0, 1, "L")[0].key);
  });
  it("prep marks read off the platform's labels", () => {
    expect(prepKeyFor("Repair — Crack (a couple of spots)")).toBe("crack");
    expect(prepKeyFor("Hole or dent")).toBe("hole");
    expect(prepKeyFor("Water damage")).toBe("water");
    expect(prepKeyFor("Something else")).toBeNull();
  });
  it("quotePictureFrom: unticked trims absent, walls grey when not painting, the share, the robe, the feature tint", () => {
    const tile = (key: string, on: boolean, extra: Partial<QuoteRoom["tiles"][number]> = {}) => ({ key, label: key, on, countable: false, longTail: false, ...extra });
    const r: QuoteRoom = {
      areaId: 1, name: "Bed 1", lengthM: 3, widthM: 3, heightM: 2.4, size: null, confirmed: false,
      tiles: [tile("walls", true, { wallsPct: 50 }), tile("ceilings", true), tile("cornices", false), tile("skirting", true), tile("architraves", false), tile("doors", true, { count: 2, countable: true }), tile("windows", true, { count: 1, countable: true })],
      windows: [{ id: 9, label: "Windows", count: 3, sizeBand: "L" }],
      cupboard: { question: "Paint the built-in robe doors?", on: true }, cupboardInterior: { question: "Inside?", on: false },
      spots: [{ surfaceId: 5, label: "Repair — Crack (patches)", prepHr: 1, fromCustomer: true, crewNote: "" }],
      extras: { featureWalls: 1, wallpaper: true, other: "" }, garagePending: false,
    };
    expect(quotePictureFrom(r)).toEqual({ wallsPct: 50, ceiling: true, cornices: false, skirting: true, architraves: false, doors: 2, windows: 3, winSize: "L", robe: { doors: true, inside: false }, prep: ["crack", "wallpaper"], featureWall: true });
    const off: QuoteRoom = { ...r, tiles: [tile("walls", false), tile("doors", false)], windows: [], cupboard: null, cupboardInterior: null, spots: [], extras: { featureWalls: 0, wallpaper: false, other: "" } };
    expect(quotePictureFrom(off)).toMatchObject({ wallsPct: null, doors: 0, windows: 0, robe: null, prep: [], featureWall: false });
  });
});
