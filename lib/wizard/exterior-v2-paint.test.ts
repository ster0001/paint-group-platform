import { describe, expect, it } from "vitest";
import { aboutMissing, anyBrick, anyVerticalTimber, exteriorV2Answered, paintedSides, partsOnSide, setSidePaint, toggleExtra, togglePart, PART_GROUPS, VERANDAH_PARTS } from "./exterior-model";
import { EXTERIOR_PARTS, EXTERIOR_EXTRAS, type ExteriorV2 } from "./state";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { defaultSides } from "./exterior-model";
import { typicalFor } from "./exterior-typicals";
import { applyExteriorQuickLook, DEFAULT_EXTERIOR_QUICK_LOOK, exteriorQuickLookFromState, exteriorRestatement } from "./exterior-quick-look";
import { applyExteriorAnswers, type MergedBundle } from "./exteriorAnswers";
import { DEFAULT_QUICK_LOOK, quickLookToState } from "./quick-look";
import { defaultWizardState, wizardStateSchema } from "./state";

/**
 * Exterior wizard v2, S3 — the Painting and About-it pure pieces: the groups
 * cover every part once, the verandah family rides with the verandah, the
 * extras toggle, the About gate, and the moment the Painting step is
 * answered the drawn house takes over the v1 fields and the tree.
 */

function house(shape: Parameters<typeof houseOfShape>[0] = "cal"): ExteriorV2 {
  const v2 = { ...houseOfShape(shape, null, []), sizeBand: "md" as const };
  return { ...v2, sides: defaultSides(v2) };
}

describe("the Painting step", () => {
  it("the four groups name every part exactly once, and the verandah family is the verandah's", () => {
    const all = PART_GROUPS.flatMap((g) => g.parts);
    expect([...all].sort()).toEqual([...EXTERIOR_PARTS].sort());
    expect(new Set(all).size).toBe(EXTERIOR_PARTS.length);
    expect(VERANDAH_PARTS).toEqual(["posts", "ceiling", "handrail"]);
  });
  it("nothing is ticked for anyone; a tick toggles; unticking the verandah takes its family; ticking a family member brings the verandah", () => {
    const v2 = house();
    expect(v2.parts).toEqual([]);
    expect(exteriorV2Answered(v2)).toBe(false);
    const walls = togglePart(v2, "walls");
    expect(walls.parts).toEqual(["walls"]);
    expect(exteriorV2Answered(walls)).toBe(true);
    expect(togglePart(walls, "walls").parts).toEqual([]);
    const ver = togglePart(togglePart(walls, "verandah"), "posts");
    expect(ver.parts).toEqual(["walls", "verandah", "posts"]);
    expect(togglePart(ver, "verandah").parts).toEqual(["walls"]);
    expect(togglePart(walls, "ceiling").parts).toEqual(["verandah", "walls", "ceiling"]);
    const fence = toggleExtra(v2, "paling_fence");
    expect(fence.extras).toEqual(["paling_fence"]);
    expect(exteriorV2Answered(fence)).toBe(true);
    expect(toggleExtra(fence, "paling_fence").extras).toEqual([]);
    expect(EXTERIOR_EXTRAS).toHaveLength(9);
  });
  it("a whole-house tick lands on its default sides: the verandah family and garage on the front, the gable on the gable sides", () => {
    const t = typicalFor("cal");
    const v2 = ["walls", "gable", "verandah", "posts", "garage", "fascias"].reduce((acc, p) => togglePart(acc, p as never), house());
    expect(partsOnSide(v2, "front", t)).toEqual(expect.arrayContaining(["walls", "gable", "verandah", "posts", "garage", "fascias"]));
    expect(partsOnSide(v2, "back", t)).toEqual(expect.arrayContaining(["walls", "gable", "fascias"]));
    expect(partsOnSide(v2, "back", t)).not.toContain("verandah");
    expect(partsOnSide(v2, "right", t)).not.toContain("gable");
  });
  it("Which sides? drives the drawn house: a side set not painting leaves the painted list and un-confirms", () => {
    const v2 = house();
    const off = setSidePaint(v2, "right", false);
    expect(paintedSides(off)).toEqual(["front", "back", "left"]);
    expect(off.sides.right!.paint).toBe(false);
    expect(paintedSides(setSidePaint(off, "right", true))).toEqual(["front", "right", "back", "left"]);
  });
});

describe("the About step", () => {
  it("needs the walls' material when the walls are ticked, and a ticked pergola's top; nothing else", () => {
    const v2 = togglePart(house(), "fascias");
    expect(aboutMissing(v2)).toBeNull();
    const walls = togglePart(v2, "walls");
    expect(aboutMissing(walls)).toMatch(/walls made of/);
    expect(aboutMissing({ ...walls, wall: { ...walls.wall, down: "render" } })).toBeNull();
    const pergola = toggleExtra(v2, "pergola");
    expect(aboutMissing(pergola)).toMatch(/pergola top/);
    expect(aboutMissing({ ...pergola, extraSizes: { pergola_l: 6, pergola_w: 4 } })).toBeNull();
  });
  it("brick anywhere asks painted-before; vertical timber anywhere says stained", () => {
    const v2 = togglePart(house(), "walls");
    expect(anyBrick(v2)).toBe(false);
    expect(anyBrick({ ...v2, wall: { ...v2.wall, up: "brick" } })).toBe(true);
    expect(anyBrick({ ...v2, sides: { ...v2.sides, left: { ...v2.sides.left!, material: "brick" } } })).toBe(true);
    expect(anyVerticalTimber({ ...v2, wall: { ...v2.wall, down: "vertical_timber" } })).toBe(true);
  });
});

describe("once Painting is answered, the drawn house is the job", () => {
  const base = () => quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "exterior" }, { ...defaultWizardState(), mode: "customer" as const });
  it("the v1 fields derive from v2 (elements, materials, counts, storeys, sides), the words read as outside, and the state parses", () => {
    let v2 = ["walls", "fascias", "windows", "doors"].reduce((acc, p) => togglePart(acc, p as never), house("ds"));
    v2 = toggleExtra(v2, "paling_fence");
    v2 = { ...v2, wall: { ...v2.wall, down: "render", up: "weatherboards" }, windowType: "colonial", extraSizes: { fence: 20 } };
    v2 = setSidePaint(v2, "right", false);
    const s = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, colour: "bold", access: ["steep"], v2 }, base());
    const ext = s.exterior!;
    expect(ext.painting.body).toBe(true);
    expect(ext.substrates).toEqual(["render", "weatherboards"]);
    expect(ext.windowType).toBe("colonial");
    expect(ext.storeys).toBe("double");
    expect(ext.sides).toEqual(["front", "left", "back"]); // the v1 field keeps its own order; the words read front, back, left
    expect(ext.sidesAnswered).toBe(true);
    expect(ext.extras.fence).toBe(true);
    expect(ext.extras.fenceMetres).toBe(20);
    expect(ext.colour).toBe("bold");
    expect(ext.access).toEqual(["steep"]);
    expect(s.condition.tier).toBe("dark_to_light");
    expect(() => wizardStateSchema.parse(JSON.parse(JSON.stringify(s)))).not.toThrow();
    const back = exteriorQuickLookFromState(ext);
    expect(back.v2).toEqual(v2);
    expect(back.elements).toEqual(["body", "windows", "doors", "fascias"]);
    expect(exteriorRestatement(back)).toMatch(/^Based on the walls, windows, doors, fascias and paling fence \(render and weatherboard\), \d+ colonial windows, \d+ doors, the front, back and left side, going much lighter, the paintwork priced from good to peeling, double storey\./);
  });
  it("the tree is the model's: one node per painted side with the ticked parts, the extras node, no 12 × 14 scaffold", () => {
    let v2 = ["walls", "fascias", "gable"].reduce((acc, p) => togglePart(acc, p as never), house("cal"));
    v2 = { ...v2, wall: { ...v2.wall, down: "weatherboards" }, gableFill: "stucco" };
    v2 = setSidePaint(v2, "left", false);
    const s = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, v2 }, base());
    const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };
    let n = 1;
    applyExteriorAnswers(merged, s, () => n++, new Set(s.surfaces));
    const names = merged.areas.map((a) => a.name);
    expect(names).toEqual(["Exterior - Front", "Exterior - Right", "Exterior - Rear"]);
    const front = merged.areas[0];
    expect(front.L).toBe(v2.sides.front!.w);
    expect(front.H).toBe(3);
    expect(front.surfaces.map((x) => x.code)).toEqual(["Weatherboards", "Stucco", "Fascias"]);
    expect(merged.areas.some((a) => a.isOption)).toBe(false);
  });
});
