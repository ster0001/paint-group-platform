import { describe, expect, it } from "vitest";
import golden from "@/lib/pricing/__fixtures__/golden-estimates.json";
import {
  SUBSTRATE_DEFS,
  defaultSurfacesFor,
  substrateKeyForRateCode,
  substrateOptionsFromRates,
} from "./substrates";

/** Every rate item the golden fixtures know about — the closest thing to the
 * live rate card the tests can hold. */
function goldenRateItems(): Array<{ code: string; category: string }> {
  const seen = new Map<string, string>();
  JSON.stringify(golden, (_k, v) => {
    if (v && typeof v === "object" && "code" in v && "category" in v && typeof v.code === "string") {
      seen.set(v.code, String(v.category));
    }
    return v;
  });
  return [...seen].map(([code, category]) => ({ code, category }));
}

describe("substrate registry ↔ rate card alignment", () => {
  const items = goldenRateItems();
  const codes = new Set(items.map((i) => i.code));

  it("every registry code exists in the rate card (the two brick rows excepted until their migrations run)", () => {
    const missing = SUBSTRATE_DEFS.flatMap((d) => d.codes).filter((c) => !codes.has(c));
    // 'Brick' arrives with 20260919, 'Brick (Unpainted)' with 20260925 —
    // the golden card predates both. A substrate whose code the loaded card
    // doesn't carry is simply not offered, which is the point of the test.
    expect(missing).toEqual(["Brick", "Brick (Unpainted)"]);
  });

  it("no two substrates claim the same rate code", () => {
    const all = SUBSTRATE_DEFS.flatMap((d) => d.codes);
    expect(new Set(all).size).toBe(all.length);
  });

  it("resolves rate codes to their governing tick", () => {
    expect(substrateKeyForRateCode("Walls")).toBe("walls");
    expect(substrateKeyForRateCode("Skirting Boards MDF")).toBe("skirting");
    expect(substrateKeyForRateCode("Weatherboards")).toBe("weatherboards");
    expect(substrateKeyForRateCode("Fixed / Picture Window")).toBe("exterior_windows");
    expect(substrateKeyForRateCode("Fixed / Picture / Window Reveal")).toBe("windows");
    expect(substrateKeyForRateCode("Roof")).toBe(null); // no tick governs the roof
  });
});

describe("substrateOptionsFromRates", () => {
  const items = goldenRateItems();
  const groups = substrateOptionsFromRates(items);

  it("splits sides from rate_items.category, not from anything hardcoded", () => {
    const interiorKeys = groups.interior.map((o) => o.key);
    const exteriorKeys = groups.exterior.map((o) => o.key);
    expect(interiorKeys).toContain("walls");
    expect(interiorKeys).toContain("staircase"); // no rate rows, rides with interior
    expect(interiorKeys).not.toContain("weatherboards");
    expect(exteriorKeys).toEqual(expect.arrayContaining([
      "weatherboards", "render", "eaves", "fascias", "gutters", "downpipes",
      "exterior_windows", "exterior_doors", "garage_doors", "deck", "fence", "pergola", "balustrade",
    ]));
    expect(exteriorKeys).not.toContain("walls");
    // Brick has no rate row yet — a tick that cannot price is not offered.
    expect(exteriorKeys).not.toContain("brick");
    expect(exteriorKeys).not.toContain("brick_unpainted");
  });

  it("offers brick once its rate exists", () => {
    const withBrick = substrateOptionsFromRates([...items, { code: "Brick", category: "Exterior" }]);
    expect(withBrick.exterior.map((o) => o.key)).toContain("brick");
    // …and painted brick alone does NOT bring the unpainted (3-coat) row in.
    expect(withBrick.exterior.map((o) => o.key)).not.toContain("brick_unpainted");
    const withBoth = substrateOptionsFromRates([...items,
      { code: "Brick", category: "Exterior" }, { code: "Brick (Unpainted)", category: "Exterior" }]);
    expect(withBoth.exterior.map((o) => o.key)).toContain("brick_unpainted");
  });

  it("offers nothing from an empty rate card", () => {
    expect(substrateOptionsFromRates([])).toEqual({ interior: [], exterior: [] });
  });
});

describe("defaultSurfacesFor", () => {
  const groups = substrateOptionsFromRates(goldenRateItems());

  it("interior default = the usual full repaint", () => {
    expect(defaultSurfacesFor("interior", groups)).toEqual([
      "walls", "ceilings", "cornices", "doors", "architraves", "skirting",
    ]);
  });

  it("exterior default = body + trims + openings, extras off", () => {
    const d = defaultSurfacesFor("exterior", groups);
    expect(d).toEqual(expect.arrayContaining([
      "weatherboards", "render", "eaves", "fascias", "gutters", "downpipes", "exterior_windows", "exterior_doors",
    ]));
    for (const off of ["garage_doors", "deck", "fence", "pergola", "balustrade", "walls"]) {
      expect(d).not.toContain(off);
    }
  });

  it("both = union of the two", () => {
    const d = defaultSurfacesFor("both", groups);
    expect(d).toContain("walls");
    expect(d).toContain("weatherboards");
  });
});
