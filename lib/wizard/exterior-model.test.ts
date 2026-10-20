import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeQuantity, type PricingContext } from "@/lib/pricing/estimate";
import {
  confirmedSidesMap, defaultDoorCount, defaultSides, defaultWindowCount, exteriorV2Nodes, gableRake, partsOnSide,
  postCount, sharedSidesAfterRow, wallCode, worstCondition, SIDE_NODE_NAME,
} from "./exterior-model";
import { EXTERIOR_TYPICALS, EXTERIOR_TYPICALS_VERSION, rowFromTypical, scaledLengths, typicalFor, typicalFromRow } from "./exterior-typicals";
import { exteriorV2Schema, type ExteriorV2 } from "./state";

/**
 * Exterior wizard v2, S1 — the model (brief §5, acceptance 1–5a, 7).
 *
 * The GOLDEN BUNGALOW: a Californian bungalow 12 m across, 16 m deep, 3.0 m
 * walls, 2.4 m gable rise, all four sides, 9 casement windows, 2 doors, a
 * front verandah with columns, ceiling and handrail, weatherboards with a
 * stucco gable. Every line's quantity is asserted as the ENGINE reads it
 * (`computeQuantity`), not as the model wrote it.
 */

type Refs = { rateItems: PricingContext["rateItems"] };
const refs = JSON.parse(readFileSync(new URL("../agent/__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const items = new Map(refs.rateItems.filter((r) => r.category === "Exterior").map((r) => [r.code, r]));
const codes = new Set(items.keys());

const ids = () => { let n = 1; return () => n++; };

function bungalow(over: Partial<ExteriorV2> = {}): ExteriorV2 {
  const sides = defaultSides({ propertyType: "cal", sizeBand: "md", rowPosition: null });
  // The golden sizes, as the tighten step would adjust them.
  for (const k of ["front", "back"] as const) sides[k] = { ...sides[k], w: 12, h: 3.0, size: "adj", adjusted: true, checked: true, cond: "good" };
  for (const k of ["right", "left"] as const) sides[k] = { ...sides[k], w: 16, h: 3.0, size: "adj", adjusted: true, checked: true, cond: "good" };
  sides.front.windows = 3; sides.right.windows = 2; sides.back.windows = 2; sides.left.windows = 2; // 9
  sides.front.doors = 1; sides.back.doors = 1; sides.right.doors = 0; sides.left.doors = 0; // 2
  return exteriorV2Schema.parse({
    propertyType: "cal", sizeBand: "md", rowPosition: null,
    wall: { down: "weatherboards", up: null, brickPainted: null, timberPainted: null },
    gableFill: "stucco", windowType: "casement", garageCars: null, postKind: "columns",
    parts: ["walls", "gable", "fascias", "gutters", "downpipes", "eaves", "windows", "doors", "verandah", "posts", "ceiling", "handrail"],
    extras: [], extraSizes: {}, sides,
    ...over,
  });
}

/** code → engine quantity for one side node. */
function quantities(areas: ReturnType<typeof exteriorV2Nodes>["areas"], name: string): Array<[string, number]> {
  const a = areas.find((x) => x.name === name);
  if (!a) throw new Error(`no node ${name}`);
  return a.surfaces.map((s) => [s.code, Math.round(computeQuantity(items.get(s.code), a, s) * 100) / 100]);
}

describe("the golden bungalow (12 × 16 × 3.0, gable 2.4, 9 windows, 2 doors, verandah)", () => {
  const { areas, deferred } = exteriorV2Nodes(bungalow(), ids(), [], codes);
  const rake = Math.round(gableRake(12, 2.4) * 100) / 100; // 2 × √(6² + 2.4²) = 12.92

  it("prices four sides and nothing else; every side is confirmed", () => {
    expect(areas.map((a) => a.name)).toEqual(["Exterior - Front", "Exterior - Right", "Exterior - Rear", "Exterior - Left"]);
    for (const a of areas) {
      expect(a.assumedFields).not.toContain("L");
      expect(a.assumedFields).not.toContain("H");
      expect(a.isOption).toBe(false);
    }
    expect(deferred.filter((d) => d.kind === "exterior_width")).toHaveLength(0);
  });

  it("the front: walls, the gable, barge boards, the verandah's gutter, 2 downpipes, eaves, 3 windows, the front door, 5 columns, the ceiling, the handrail", () => {
    expect(quantities(areas, "Exterior - Front")).toEqual([
      ["Weatherboards", 36],                 // 12 × 3.0
      ["Stucco", 14.4],                      // ½ × 12 × 2.4
      ["Fascias", rake],                     // the rake only — a full-gable side
      ["Gutters", 9.6],                      // none on the gable side; the verandah's 0.8w
      ["Downpipes", 2],                      // w > 10
      ["Eaves", 12],
      ["Awning / Casement Window", 3],
      ["Front Door", 1],
      ["Columns", 5],                        // max(2, round(9.6 ÷ 2.6) + 1)
      ["Soffits / Exterior Ceilings", 23.04], // 0.8 × 12 × 2.4
      ["Hand Rails", 9.6],                   // 0.8 × 12
    ]);
  });

  it("the back: the same gable, no verandah, 2 windows and a standard door", () => {
    expect(quantities(areas, "Exterior - Rear")).toEqual([
      ["Weatherboards", 36],
      ["Stucco", 14.4],
      ["Fascias", rake],
      ["Downpipes", 2],
      ["Eaves", 12],
      ["Awning / Casement Window", 2],
      ["Standard Door (1 Side)", 1],
    ]);
  });

  it("the long sides: eave sides — fascias and gutters at the width, no gable", () => {
    for (const name of ["Exterior - Right", "Exterior - Left"]) {
      expect(quantities(areas, name)).toEqual([
        ["Weatherboards", 48],               // 16 × 3.0
        ["Fascias", 16],
        ["Gutters", 16],
        ["Downpipes", 2],
        ["Eaves", 16],
        ["Awning / Casement Window", 2],
      ]);
    }
  });

  it("acceptance 1: the front at 10 m moves the front wall, fascia, gutter and eaves and nothing else", () => {
    const v2 = bungalow();
    v2.sides.front = { ...v2.sides.front!, w: 10 };
    const narrow = exteriorV2Nodes(v2, ids(), [], codes).areas;
    const before = Object.fromEntries(quantities(areas, "Exterior - Front"));
    const after = Object.fromEntries(quantities(narrow, "Exterior - Front"));
    expect(after.Weatherboards).toBe(30);
    expect(after.Fascias).toBe(Math.round(gableRake(10, 2.4) * 100) / 100);
    expect(after.Gutters).toBe(8);
    expect(after.Eaves).toBe(10);
    expect(after.Downpipes).toBe(1); // 10 m is not over 10
    for (const code of ["Stucco", "Awning / Casement Window", "Front Door", "Hand Rails", "Soffits / Exterior Ceilings"]) {
      if (code === "Stucco" || code === "Hand Rails" || code === "Soffits / Exterior Ceilings") continue; // scale with w by rule
      expect(after[code]).toBe(before[code]);
    }
    for (const name of ["Exterior - Right", "Exterior - Rear", "Exterior - Left"]) {
      expect(quantities(narrow, name)).toEqual(quantities(areas, name));
    }
  });

  it("every line the golden tree prices has a row on the card (nothing silently at $0)", () => {
    for (const a of areas) for (const s of a.surfaces) expect(codes.has(s.code), s.code).toBe(true);
  });
});

describe("acceptance 2: storeys and materials", () => {
  it("a double storey with two materials has two rows of w × h ÷ 2; the same material has one row", () => {
    const sides = defaultSides({ propertyType: "ds", sizeBand: "md", rowPosition: null });
    const two = exteriorV2Schema.parse({ propertyType: "ds", sizeBand: "md", parts: ["walls"], wall: { down: "render", up: "weatherboards" }, sides });
    const front = exteriorV2Nodes(two, ids(), [], codes).areas[0];
    const walls = front.surfaces.filter((s) => s.code === "Render" || s.code === "Weatherboards");
    expect(walls.map((s) => s.code)).toEqual(["Render", "Weatherboards"]);
    const w = sides.front.w, h = sides.front.h;
    for (const s of walls) expect(computeQuantity(items.get(s.code), front, s)).toBeCloseTo((w * h) / 2, 5);
    expect(walls.map((s) => s.sharePct)).toEqual([50, 50]);
    const one = exteriorV2Schema.parse({ ...two, wall: { down: "render", up: null } });
    const oneFront = exteriorV2Nodes(one, ids(), [], codes).areas[0];
    expect(oneFront.surfaces.filter((s) => s.code === "Render")).toHaveLength(1);
    expect(computeQuantity(items.get("Render"), oneFront, oneFront.surfaces[0])).toBeCloseTo(w * h, 5);
  });

  it("a side with its own material prices that material on that side only (5a)", () => {
    const v2 = bungalow();
    v2.sides.right = { ...v2.sides.right!, material: "render" };
    const { areas } = exteriorV2Nodes(v2, ids(), [], codes);
    expect(quantities(areas, "Exterior - Right")[0]).toEqual(["Render", 48]);
    for (const name of ["Exterior - Front", "Exterior - Rear", "Exterior - Left"]) expect(quantities(areas, name)[0][0]).toBe("Weatherboards");
  });

  it("acceptance 4: vertical timber stains at Cutek unless painted; bare brick is its own row", () => {
    const wall = (over: Partial<ExteriorV2["wall"]>) => ({ down: null, up: null, brickPainted: null, timberPainted: null, ...over });
    expect(wallCode("vertical_timber", wall({ down: "vertical_timber" }))).toBe("Cutek");
    expect(wallCode("vertical_timber", wall({ down: "vertical_timber", timberPainted: "yes" }))).toBe("Weatherboards");
    expect(wallCode("brick", wall({ down: "brick", brickPainted: "no" }))).toBe("Brick (Unpainted)");
    expect(wallCode("brick", wall({ down: "brick", brickPainted: "yes" }))).toBe("Brick");
    expect(items.get("Brick (Unpainted)")?.default_coats).toBe(3);
    const stained = exteriorV2Nodes(bungalow({ wall: wall({ down: "vertical_timber" }) }), ids(), [], codes);
    expect(stained.deferred.some((d) => d.kind === "exterior_timber_stain")).toBe(true);
  });
});

describe("acceptance 3: shared sides and the row position (⚑ 10)", () => {
  it("a townhouse starts left and right not painting; those sides are absent from the tree", () => {
    const sides = defaultSides({ propertyType: "th", sizeBand: "md", rowPosition: "mid" });
    expect(sides.left.paint).toBe(false); expect(sides.left.shared).toBe(true);
    expect(sides.right.paint).toBe(false);
    expect(sides.front.paint).toBe(true); expect(sides.back.paint).toBe(true);
    const v2 = exteriorV2Schema.parse({ propertyType: "th", sizeBand: "md", rowPosition: "mid", parts: ["walls"], wall: { down: "render" }, sides });
    expect(exteriorV2Nodes(v2, ids(), [], codes).areas.map((a) => a.name)).toEqual(["Exterior - Front", "Exterior - Rear"]);
    // Added back → on the tree.
    v2.sides.left = { ...v2.sides.left!, paint: true };
    expect(exteriorV2Nodes(v2, ids(), [], codes).areas.map((a) => a.name)).toContain("Exterior - Left");
  });
  it("an end of terrace with the left side open paints the left and not the right; stands alone paints all four", () => {
    const t = typicalFor("terrace");
    expect(sharedSidesAfterRow(t, "left")).toEqual(["right"]);
    expect(sharedSidesAfterRow(t, "right")).toEqual(["left"]);
    expect(sharedSidesAfterRow(t, "both")).toEqual([]);
    expect(sharedSidesAfterRow(t, "mid")).toEqual(["left", "right"]);
    const open = defaultSides({ propertyType: "terrace", sizeBand: "sm", rowPosition: "left" });
    expect(open.left.paint).toBe(true); expect(open.right.paint).toBe(false);
    const alone = defaultSides({ propertyType: "terrace", sizeBand: "sm", rowPosition: "both" });
    expect(Object.values(alone).every((s) => s.paint)).toBe(true);
    // A unit shares the left wall only.
    expect(sharedSidesAfterRow(typicalFor("unit"), "mid")).toEqual(["left"]);
    expect(sharedSidesAfterRow(typicalFor("unit"), "left")).toEqual([]);
    // A free-standing shape ignores the answer.
    expect(sharedSidesAfterRow(typicalFor("wb"), "mid")).toEqual([]);
  });
  it("a terrace front carries the parapet in its wall height and the cornice as the fascia line", () => {
    const sides = defaultSides({ propertyType: "terrace", sizeBand: "sm", rowPosition: "mid" });
    const v2 = exteriorV2Schema.parse({ propertyType: "terrace", sizeBand: "sm", rowPosition: "mid", parts: ["walls", "fascias", "gutters", "eaves"], wall: { down: "render" }, sides });
    const front = exteriorV2Nodes(v2, ids(), [], codes).areas[0];
    expect(front.H).toBeCloseTo(sides.front.h + 0.9, 5);
    expect(front.surfaces.find((s) => s.code === "Fascias")?.clientLabel).toBe("Cornice and mouldings");
    expect(computeQuantity(items.get("Render"), front, front.surfaces[0])).toBeCloseTo(sides.front.w * (3.6 + 0.9), 5);
  });
});

describe("parts land on their default sides and can be added to any side (5a)", () => {
  it("a gable added on the right of a bungalow adds one Stucco line there and changes nothing elsewhere", () => {
    const base = exteriorV2Nodes(bungalow(), ids(), [], codes).areas;
    const v2 = bungalow();
    v2.sides.right = { ...v2.sides.right!, add: ["gable"] };
    const after = exteriorV2Nodes(v2, ids(), [], codes).areas;
    const q0 = quantities(base, "Exterior - Right"), q1 = quantities(after, "Exterior - Right");
    expect(q1.length).toBe(q0.length + 1);
    expect(q1).toContainEqual(["Stucco", 7.6]); // ½ × (0.5 × 16) × 1.9
    // The barge boards of the cross gable ride the fascia line (⚑ 7); the rest is untouched.
    expect(q1.find(([c]) => c === "Fascias")?.[1]).toBe(Math.round((16 + gableRake(8, 1.9)) * 100) / 100);
    expect(q1.filter(([c]) => c !== "Stucco" && c !== "Fascias")).toEqual(q0.filter(([c]) => c !== "Fascias"));
    for (const name of ["Exterior - Front", "Exterior - Rear", "Exterior - Left"]) expect(quantities(after, name)).toEqual(quantities(base, name));
  });
  it("a porch added at the back brings the verandah's gutter run; a part taken off a side leaves that side only", () => {
    const v2 = bungalow();
    v2.sides.back = { ...v2.sides.back!, add: ["verandah", "posts"] };
    v2.sides.left = { ...v2.sides.left!, off: ["eaves"] };
    const t = typicalFor("cal");
    expect(partsOnSide(v2, "back", t)).toContain("verandah");
    expect(partsOnSide(v2, "left", t)).not.toContain("eaves");
    expect(partsOnSide(v2, "right", t)).toContain("eaves");
    const { areas } = exteriorV2Nodes(v2, ids(), [], codes);
    expect(quantities(areas, "Exterior - Rear")).toContainEqual(["Gutters", 9.6]);
    expect(quantities(areas, "Exterior - Rear")).toContainEqual(["Columns", 5]);
    expect(quantities(areas, "Exterior - Left").some(([c]) => c === "Eaves")).toBe(false);
    expect(quantities(areas, "Exterior - Right").some(([c]) => c === "Eaves")).toBe(true);
  });
  it("whole-house defaults: the verandah family, garage and shutters land on the front; a gable on the gable sides only", () => {
    const v2 = bungalow({ parts: ["walls", "gable", "windows", "garage", "shutters"], garageCars: 2 });
    const { areas } = exteriorV2Nodes(v2, ids(), [], codes);
    expect(quantities(areas, "Exterior - Front")).toContainEqual(["Garage Door (2 Car)", 1]);
    expect(quantities(areas, "Exterior - Front")).toContainEqual(["Wood Shutters", 6]); // 2 × 3 windows
    expect(quantities(areas, "Exterior - Right").some(([c]) => /Garage|Shutters|Stucco/.test(c))).toBe(false);
    expect(quantities(areas, "Exterior - Rear").some(([c]) => c === "Stucco")).toBe(true);
  });
});

describe("acceptance 7: nothing prices silently at $0 or at a guessed rate", () => {
  it("shingles, something else, aluminium windows, winder / not-sure windows and a not-sure size each raise a deferral", () => {
    const v2 = bungalow({ propertyType: "other", gableFill: "shingles", windowType: "alu" });
    v2.sides.left = { ...v2.sides.left!, size: "ns", checked: true };
    v2.parts = [...v2.parts, "gable"];
    v2.sides.front = { ...v2.sides.front!, add: ["gable"] }; // a cross gable on a hip shape
    const { areas, deferred } = exteriorV2Nodes(v2, ids(), [], codes);
    const kinds = deferred.map((d) => d.kind);
    expect(kinds).toContain("exterior_type_unsure");
    expect(kinds).toContain("exterior_shingles");
    expect(kinds).toContain("exterior_windows_alu");
    expect(kinds).toContain("exterior_size_unsure:left");
    const shingles = areas[0].surfaces.find((s) => /Gable end/.test(s.clientLabel));
    expect(shingles?.priceOverride).toBe(0);
    expect(areas[0].surfaces.some((s) => /Window/.test(s.code))).toBe(false);
    const left = areas.find((a) => a.name === SIDE_NODE_NAME.left)!;
    expect(left.assumedFields).toEqual(expect.arrayContaining(["L", "H"]));
    for (const wt of ["winder", "unsure"] as const) {
      expect(exteriorV2Nodes(bungalow({ windowType: wt }), ids(), [], codes).deferred.map((d) => d.kind)).toContain("exterior_window_style");
    }
    // The walls ticked with no material: a placeholder line, flagged.
    const bare = exteriorV2Nodes(bungalow({ wall: { down: null, up: null, brickPainted: null, timberPainted: null } }), ids(), [], codes);
    expect(bare.deferred.map((d) => d.kind)).toContain("exterior_material");
    expect(bare.areas[0].surfaces[0].assumedFields).toContain("material");
    // Iron lace: posts priced at Posts, the lacework deferred (⚑ 8).
    const lace = exteriorV2Nodes(bungalow({ postKind: "lace" }), ids(), [], codes);
    expect(lace.areas[0].surfaces.find((s) => s.code === "Posts")?.count).toBe(5);
    expect(lace.deferred.map((d) => d.kind)).toContain("exterior_lacework");
  });
});

describe("around the house", () => {
  it("fences by metres, deck by m², pergola on its top, shed and the small items; a missing size is a measurement deferral", () => {
    const v2 = bungalow({ parts: ["fascias"], extras: ["paling_fence", "deck", "pergola", "shed", "wall", "side_gate", "meter_box", "security_door"], extraSizes: { fence: 20, deck: 30, pergola_l: 6, pergola_w: 4, wall: 10 }, extraWallMaterial: "render" });
    const { areas, deferred } = exteriorV2Nodes(v2, ids(), [], codes);
    const extras = areas.find((a) => a.name === "Exterior - Extras")!;
    const q = extras.surfaces.map((s) => [s.code, Math.round(computeQuantity(items.get(s.code), extras, s) * 100) / 100]);
    expect(q).toEqual([
      ["Paling Fence", 20], ["Deck Painting", 30], ["Pergola", 2.4], ["Shed", 1], ["Render", 18], ["Side Gate", 1], ["Meter Box", 1], ["Security Door", 1],
    ]);
    expect(deferred.filter((d) => d.room === "Exterior - Extras")).toHaveLength(0);
    const unsized = exteriorV2Nodes(bungalow({ parts: ["fascias"], extras: ["picket_fence", "deck"], extraSizes: {} }), ids(), [], codes);
    expect(unsized.deferred.filter((d) => d.room === "Exterior - Extras").map((d) => d.what)).toEqual(["Fence measurements", "Deck measurements"]);
    expect(unsized.areas.find((a) => a.name === "Exterior - Extras")!.surfaces[0].code).toBe("Picket Fence (Hand Paint)");
  });
});

describe("the typicals and the defaults", () => {
  it("nine shapes, every one round-trips through the database row shape, every usual wall is a rate row", () => {
    expect(EXTERIOR_TYPICALS.map((t) => t.key)).toEqual(["wb", "cal", "brick", "ds", "th", "unit", "terrace", "modern", "other"]);
    for (const t of EXTERIOR_TYPICALS) {
      expect(typicalFromRow(rowFromTypical(t, EXTERIOR_TYPICALS_VERSION))).toEqual(t);
      expect(t.source).toBe("proposed"); // ⚑ 2
    }
    expect(typicalFromRow({ ...rowFromTypical(EXTERIOR_TYPICALS[0]), roof: "dome" })).toBeNull();
    // A loaded row beats the built-in list; a missing one falls back.
    const row = { ...rowFromTypical(typicalFor("wb")), front_m: 9, source: "tom" };
    expect(typicalFor("wb", [row]).frontM).toBe(9);
    expect(typicalFor("wb", [row]).source).toBe("tom");
    expect(typicalFor("cal", [row]).frontM).toBe(12);
  });
  it("the size band scales the lengths by footprint, to the half metre, keeping the shape's ratio", () => {
    expect(scaledLengths(typicalFor("cal"), "md")).toEqual({ frontM: 11, sideM: 14.5 });   // 160 m² at 16:12
    expect(scaledLengths(typicalFor("th"), "sm")).toEqual({ frontM: 5, sideM: 10 });       // 100 ÷ 2 storeys at 14:7
    expect(scaledLengths(typicalFor("wb"), "xl").frontM).toBeGreaterThan(scaledLengths(typicalFor("wb"), "lg").frontM);
    expect(scaledLengths(typicalFor("wb"), "ns")).toEqual(scaledLengths(typicalFor("wb"), "md"));
  });
  it("⚑ 11, ⚑ 12, ⚑ 8: downpipes, window and door defaults, posts", () => {
    expect(defaultWindowCount("front", 12, 1)).toBe(3);
    expect(defaultWindowCount("right", 16, 1)).toBe(3);
    expect(defaultWindowCount("front", 7, 2)).toBe(4);
    expect(defaultDoorCount("front")).toBe(1); expect(defaultDoorCount("left")).toBe(0);
    expect(postCount(12)).toBe(5); expect(postCount(5)).toBe(3); expect(postCount(2)).toBe(2);
    const sides = defaultSides({ propertyType: "wb", sizeBand: "md", rowPosition: null });
    expect(sides.front.w).toBe(scaledLengths(typicalFor("wb"), "md").frontM);
    expect(sides.left.w).toBe(scaledLengths(typicalFor("wb"), "md").sideM);
    expect(sides.front.h).toBe(2.7);
    expect(Object.values(sides).every((s) => !s.confirmed && !s.checked && s.size == null && s.cond == null)).toBe(true);
  });
  it("the worst condition across the painted sides, null until every painted side has answered", () => {
    const v2 = bungalow();
    expect(worstCondition(v2)).toBe("good");
    v2.sides.back = { ...v2.sides.back!, cond: "peeling" };
    expect(worstCondition(v2)).toBe("peeling");
    v2.sides.left = { ...v2.sides.left!, cond: null };
    expect(worstCondition(v2)).toBeNull();
    v2.sides.left = { ...v2.sides.left!, paint: false };
    expect(worstCondition(v2)).toBe("peeling"); // a side not painting is not asked
  });
  it("the confirm map for the envelope: checked + sized = confirmed; not sure stays pending (⚑ 13)", () => {
    const v2 = bungalow();
    v2.sides.left = { ...v2.sides.left!, size: "ns" };
    const { areas } = exteriorV2Nodes(v2, ids(), [], codes);
    const map = confirmedSidesMap(areas, v2);
    expect([...map.values()]).toEqual(["confirmed", "confirmed", "confirmed", "pending"]);
  });
});
