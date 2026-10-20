import { describe, expect, it } from "vitest";
import {
  allSidesConfirmed, confirmSide, defaultSides, nextUnconfirmedSide, partsOnSide, setSideMaterial, setSidePaint, sideAddableParts, sideListParts,
  sideMaterial, togglePart, toggleSidePart, exteriorV2Nodes, SIDE_NODE_NAME,
} from "./exterior-model";
import { typicalFor } from "./exterior-typicals";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { sideTileState } from "@/app/wizard/ExteriorSides";
import { notInThisNumber } from "@/app/wizard/ExteriorRangeRows";
import type { ExteriorV2 } from "./state";

/**
 * Exterior wizard v2, S4 — the per-side confirm's pure pieces: the side's
 * chip list, taking a part off a side, adding one from the full list, a
 * side's own material, confirm / un-confirm, the tiles — and that each
 * change lands on that side's node alone (acceptance 5a, 5b).
 */

function bungalow(): ExteriorV2 {
  let v2: ExteriorV2 = { ...houseOfShape("cal", null, []), sizeBand: "md" };
  v2 = { ...v2, sides: defaultSides(v2) };
  v2 = ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"].reduce<ExteriorV2>((acc, p) => togglePart(acc, p as never), v2);
  return { ...v2, wall: { ...v2.wall, down: "weatherboards" }, gableFill: "stucco" };
}
const t = typicalFor("cal");
const ids = () => { let n = 1; return () => n++; };
const codesOn = (v2: ExteriorV2, side: "front" | "right" | "back" | "left") =>
  exteriorV2Nodes(v2, ids(), [], null).areas.find((a) => a.name === SIDE_NODE_NAME[side])?.surfaces.map((s) => s.clientLabel) ?? [];

describe("the side's list", () => {
  it("shows the whole-house parts that land there, and the ones added here; the rest are addable", () => {
    const v2 = bungalow();
    expect(sideListParts(v2, "front", t)).toEqual(["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"]);
    expect(sideListParts(v2, "right", t)).toEqual(["walls", "fascias", "gutters", "eaves", "windows", "doors"]);
    expect(sideAddableParts(v2, "right", t)).toEqual(["gable", "downpipes", "garage", "shutters", "verandah"]); // the family waits for a verandah here
    const withPorch = toggleSidePart(v2, "back", "verandah", t);
    expect(sideAddableParts(withPorch, "back", t)).toEqual(expect.arrayContaining(["posts", "ceiling", "handrail"]));
  });
  it("taking a part off a side and adding one changes that side's node alone (5a); taking the verandah off takes its posts", () => {
    const v2 = bungalow();
    const before = { front: codesOn(v2, "front"), right: codesOn(v2, "right"), back: codesOn(v2, "back") };
    const gableRight = toggleSidePart(v2, "right", "gable", t);
    expect(gableRight.sides.right!.add).toEqual(["gable"]);
    expect(codesOn(gableRight, "right")).toContain("Gable end — stucco");
    expect(codesOn(gableRight, "front")).toEqual(before.front);
    expect(codesOn(gableRight, "back")).toEqual(before.back);
    expect(toggleSidePart(gableRight, "right", "gable", t).sides.right!.add).toEqual([]);
    const noEaves = toggleSidePart(v2, "right", "eaves", t);
    expect(noEaves.sides.right!.off).toEqual(["eaves"]);
    expect(codesOn(noEaves, "right")).not.toContain("Eaves");
    expect(codesOn(noEaves, "front")).toEqual(before.front);
    expect(toggleSidePart(noEaves, "right", "eaves", t).sides.right!.off).toEqual([]);
    const noVerandah = toggleSidePart(v2, "front", "verandah", t);
    expect(partsOnSide(noVerandah, "front", t)).not.toContain("posts");
    expect(codesOn(noVerandah, "front")).not.toContain("Columns");
  });
  it("a side's own material prices on that side only (5b); null means the house's", () => {
    const v2 = setSideMaterial(bungalow(), "right", "render");
    expect(sideMaterial(v2, "right", t)).toBe("render");
    expect(sideMaterial(v2, "front", t)).toBe("weatherboards");
    const nodes = exteriorV2Nodes(v2, ids(), [], null).areas;
    expect(nodes.find((a) => a.name === "Exterior - Right")!.surfaces[0].code).toBe("Render");
    expect(nodes.find((a) => a.name === "Exterior - Front")!.surfaces[0].code).toBe("Weatherboards");
    expect(sideMaterial(setSideMaterial(v2, "right", null), "right", t)).toBe("weatherboards");
  });
});

describe("confirming", () => {
  it("Looks right confirms a side and the next unconfirmed painted side follows; every painted side confirmed is the gate; a change un-confirms", () => {
    let v2 = bungalow();
    expect(allSidesConfirmed(v2)).toBe(false);
    expect(nextUnconfirmedSide(v2, "front")).toBe("right");
    v2 = confirmSide(v2, "front");
    expect(v2.sides.front!.confirmed).toBe(true);
    expect(sideTileState(v2, "front", "right")).toBe("ok");
    expect(sideTileState(v2, "right", "right")).toBe("cur");
    v2 = setSidePaint(v2, "left", false);
    expect(sideTileState(v2, "left", "right")).toBe("skip");
    v2 = confirmSide(confirmSide(v2, "right"), "back");
    expect(nextUnconfirmedSide(v2, "back")).toBeNull();
    expect(allSidesConfirmed(v2)).toBe(true);
    expect(toggleSidePart(v2, "front", "eaves", t).sides.front!.confirmed).toBe(false);
    expect(setSideMaterial(v2, "back", "render").sides.back!.confirmed).toBe(false);
    expect(allSidesConfirmed(toggleSidePart(v2, "front", "eaves", t))).toBe(false);
    // A side added back is unconfirmed until Looks right.
    const back = setSidePaint(v2, "left", true);
    expect(back.sides.left!.confirmed).toBe(false);
    expect(nextUnconfirmedSide(back, "back")).toBe("left");
  });
  it("nothing painted is not confirmed", () => {
    let v2 = bungalow();
    for (const k of ["front", "right", "back", "left"] as const) v2 = setSidePaint(v2, k, false);
    expect(allSidesConfirmed(v2)).toBe(false);
  });
});

describe("the range's not-in-this-number line", () => {
  it("names scaffolding and rotten timber, and the shingles when a gable is shingled", () => {
    const v2 = bungalow();
    expect(notInThisNumber(v2)).toBe("scaffolding or a lift, rotten timber replacement");
    expect(notInThisNumber({ ...v2, gableFill: "shingles" })).toContain("the shingles (priced by your estimator)");
  });
});
