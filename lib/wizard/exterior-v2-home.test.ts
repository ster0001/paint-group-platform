import { afterEach, describe, expect, it, vi } from "vitest";
import { stepsFor } from "./quick-look";
import { exteriorV2On } from "./ui-flags";
import { EXTERIOR_SHAPE_KEYS, EXTERIOR_SIDE_KEYS, typicalFor } from "./exterior-typicals";
import { defaultSides, exteriorV2Answered, partExists, reseedSides } from "./exterior-model";
import { exteriorV2Schema, type ExteriorV2 } from "./state";
import { elevationMarkup, typeThumbMarkup } from "@/app/wizard/pictures/Elevation";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { applyExteriorQuickLook, DEFAULT_EXTERIOR_QUICK_LOOK, exteriorQuickLookFromState } from "./exterior-quick-look";
import { applyExteriorAnswers, type MergedBundle } from "./exteriorAnswers";
import { DEFAULT_QUICK_LOOK, quickLookToState } from "./quick-look";
import { defaultWizardState } from "./state";

/**
 * Exterior wizard v2, S2 — the home step's pure pieces: the flag and the
 * step list, the fresh house per shape, re-seeding on a size or row change,
 * the picture (every shape draws), and the drawn house sizing the OLD
 * scaffold until the Painting step ships.
 */

afterEach(() => vi.unstubAllEnvs());

describe("the flag and the step list", () => {
  it("is on by default and off only when NEXT_PUBLIC_EXTERIOR_V2 is exactly 0; on, the exterior and both lists gain the home step before the outside questions", () => {
    vi.stubEnv("NEXT_PUBLIC_EXTERIOR_V2", "0");
    expect(exteriorV2On()).toBe(false);
    expect(stepsFor("exterior")).toEqual(["start", "place", "outside", "sides"]);
    vi.unstubAllEnvs();
    expect(exteriorV2On()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_EXTERIOR_V2", "1");
    expect(exteriorV2On()).toBe(true);
    expect(stepsFor("exterior")).toEqual(["start", "place", "home", "paint", "about", "sides"]);
    expect(stepsFor("exterior", "house", "areas", "range", "whole", true)).toEqual(["start", "place", "home", "paint", "about", "sides", "gate"]);
    expect(stepsFor("both")).toEqual(["start", "both", "place", "job", "rooms", "condition", "home", "paint", "about", "sides"]);
    expect(stepsFor("exterior")).not.toContain("outside"); // S3: the old screen is off the path (kept for resume)
    expect(stepsFor("interior")).toEqual(["start", "place", "job", "rooms", "condition"]);
    expect(stepsFor("exterior", "commercial")).not.toContain("home");
    vi.stubEnv("NEXT_PUBLIC_EXTERIOR_V2", "true");
    expect(exteriorV2On()).toBe(true); // only "0" turns it off
  });
});

describe("a fresh house per shape", () => {
  it("every shape gives four sides at the shape's typicals, the shared ones not painting, with no size until picked", () => {
    for (const k of EXTERIOR_SHAPE_KEYS) {
      const v2 = houseOfShape(k, null, []);
      const t = typicalFor(k);
      expect(v2.propertyType).toBe(k);
      expect(v2.sizeBand).toBeNull();
      expect(v2.rowPosition).toBe(t.sharedSides.length ? "mid" : null);
      expect(v2.parts).toEqual([]);
      expect(exteriorV2Answered(v2)).toBe(false);
      for (const side of EXTERIOR_SIDE_KEYS) {
        const s = v2.sides[side]!;
        expect(s.shared).toBe(t.sharedSides.includes(side));
        expect(s.paint).toBe(!t.sharedSides.includes(side));
        expect(s.h).toBe(t.wallHM);
      }
      expect(() => exteriorV2Schema.parse(v2)).not.toThrow();
    }
    // A size already picked rides to the next shape.
    const sized = houseOfShape("th", { ...houseOfShape("wb", null, []), sizeBand: "lg" }, []);
    expect(sized.sizeBand).toBe("lg");
  });
  it("re-seeding on a size change keeps a hand-adjusted side and everything said about it; the row answer re-opens a side", () => {
    const v2: ExteriorV2 = { ...houseOfShape("th", null, []), sizeBand: "md" };
    v2.sides = defaultSides(v2);
    v2.sides.front = { ...v2.sides.front!, w: 9, adjusted: true, off: ["eaves"], material: "render", cond: "weathered" };
    const bigger = reseedSides({ ...v2, sizeBand: "xl" });
    expect(bigger.front!.w).toBe(9);
    expect(bigger.front!.off).toEqual(["eaves"]);
    expect(bigger.front!.material).toBe("render");
    expect(bigger.front!.cond).toBe("weathered");
    expect(bigger.back!.w).toBeGreaterThan(v2.sides.back!.w);
    expect(bigger.left!.paint).toBe(false);
    const endOfRow = reseedSides({ ...v2, rowPosition: "left" });
    expect(endOfRow.left!.paint).toBe(true);
    expect(endOfRow.left!.shared).toBe(false);
    expect(endOfRow.right!.paint).toBe(false);
    // Back to the middle: the left side closes again.
    expect(reseedSides({ ...v2, sides: endOfRow, rowPosition: "mid" }).left!.paint).toBe(false);
  });
});

describe("the picture", () => {
  it("every shape draws every side: the parts as data-e groups, all grey, the neighbours on the shared sides, the shape's roof", () => {
    for (const k of EXTERIOR_SHAPE_KEYS) {
      const v2 = { ...houseOfShape(k, null, []), sizeBand: "md" as const };
      v2.sides = defaultSides(v2);
      const t = typicalFor(k);
      for (const side of EXTERIOR_SIDE_KEYS) {
        const svg = elevationMarkup(v2, side, { build: true });
        expect(svg).toContain('data-e="walls"');
        expect(svg).toContain('data-e="windows"');
        expect(svg).toContain('data-e="fascias"');
        expect(svg).not.toContain('data-on="1"');
        expect(svg.match(/data-on="0"/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
        const neighbours = (svg.match(/pic-nextdoor/g) ?? []).length;
        const long = side === "left" || side === "right";
        expect(neighbours).toBe(long ? 0 : t.sharedSides.length);
        if (!t.sharedSides.includes(side)) expect(svg).not.toContain("Not painting this side");
        else expect(svg).toContain("Not painting this side");
      }
      const front = elevationMarkup(v2, "front");
      if (t.roof === "gable") expect(front).toContain('data-e="gable"');
      if (t.roof === "parapet") expect(front).toContain("p-render");
      if (t.verandah !== "none") expect(front).toContain('data-e="verandah"');
      expect(typeThumbMarkup(t).length).toBeGreaterThan(100);
    }
  });
  it("a ticked part lights up; a bigger house draws wider walls", () => {
    const v2 = { ...houseOfShape("cal", null, []), sizeBand: "md" as const };
    v2.sides = defaultSides(v2);
    const grey = elevationMarkup(v2, "front");
    const lit = elevationMarkup({ ...v2, parts: ["walls", "gable"] }, "front");
    expect(lit).toContain('class="e e-walls on');
    expect(lit).toContain('class="e e-gable on');
    expect(grey).not.toContain('class="e e-walls on');
    const wallWidth = (svg: string) => Number(svg.match(/data-e="walls" data-on="\d"><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/)?.[1]);
    const xl = { ...v2, sizeBand: "xl" as const }; xl.sides = defaultSides(xl);
    const sm = { ...v2, sizeBand: "sm" as const }; sm.sides = defaultSides(sm);
    expect(wallWidth(elevationMarkup(xl, "front"))).toBeGreaterThan(wallWidth(elevationMarkup(sm, "front")));
    expect(partExists(v2, "front", "verandah", typicalFor("cal"))).toBe(true);
    expect(partExists(v2, "back", "verandah", typicalFor("cal"))).toBe(false);
  });
});

describe("until the Painting step ships, the drawn house sizes the old scaffold", () => {
  const base = () => quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "exterior" }, { ...defaultWizardState(), mode: "customer" as const });
  it("a house with no parts rides along untouched, reads back for resume, and the v1 screen's own answers stay", () => {
    const v2 = { ...houseOfShape("th", null, []), sizeBand: "sm" as const };
    v2.sides = defaultSides(v2);
    const s1 = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, v2 }, base());
    expect(s1.exterior?.v2).toEqual(v2);
    expect(s1.exterior?.painting.body).toBe(false); // the v1 defaults, not derived from an empty parts list
    const s2 = applyExteriorQuickLook({ ...exteriorQuickLookFromState(s1.exterior), elements: ["body", "fascias"], materials: ["render"] }, s1);
    expect(s2.exterior?.v2).toEqual(v2);
    expect(s2.exterior?.painting.body).toBe(true);
    expect(s2.exterior?.substrates).toEqual(["render"]);
    const back = exteriorQuickLookFromState(s2.exterior);
    expect(back.v2).toEqual(v2);
    expect(back.elements).toEqual(["body", "fascias"]);
  });
  it("the v1 scaffold's sides take the drawn house's widths and height instead of 12 / 14 × 2.6", () => {
    const v2 = { ...houseOfShape("th", null, []), sizeBand: "sm" as const };
    v2.sides = defaultSides(v2);
    const s = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, elements: ["body", "fascias"], materials: ["render"], v2 }, base());
    const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };
    let n = 1;
    applyExteriorAnswers(merged, s, () => n++, new Set(s.surfaces));
    const front = merged.areas.find((a) => a.name === "Exterior - Front")!;
    const left = merged.areas.find((a) => a.name === "Exterior - Left")!;
    expect(front.L).toBe(v2.sides.front!.w);
    expect(front.H).toBe(5.6);
    expect(left.L).toBe(v2.sides.left!.w);
    expect(front.assumedFields).toEqual(expect.arrayContaining(["L", "H"]));
    // Still the v1 lines: the walls from the materials ticked, the fascias from the tick.
    expect(front.surfaces.map((x) => x.code)).toEqual(["Render", "Fascias"]);
  });
});
