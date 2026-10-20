import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PricingContext } from "@/lib/pricing/estimate";
import {
  allSidesChecked, canCheckSide, checkSide, confirmedSidesMap, defaultSides, exteriorV2Nodes, isModelDeferral, nextUncheckedSide, peelingSidesOf,
  rebuildExteriorNodes, setSideCond, setSideCounts, setSidePaint, setSideSize, togglePart, worstCondition, SIDE_NODE_NAME,
} from "./exterior-model";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import { walkTileState } from "@/app/wizard/ExteriorWalk";
import { isWallLine } from "./sides";
import { envelopeFor } from "./envelope";
import { DEFAULT_BANDS } from "./policy";
import { applyExteriorQuickLook, DEFAULT_EXTERIOR_QUICK_LOOK } from "./exterior-quick-look";
import { applyExteriorAnswers, applyConditionPricing, type MergedBundle } from "./exteriorAnswers";
import { DEFAULT_QUICK_LOOK, quickLookToState } from "./quick-look";
import { defaultWizardState, type ExteriorV2 } from "./state";

/**
 * Exterior wizard v2, S5 — the tighten step's pure pieces: counts, the size
 * answer, the condition per side, "Check this side" (only after the size
 * answer — acceptance 11), the rebuild of the exterior nodes from the drawn
 * house (ids and the customer's words kept), the gable end out of the wall
 * share, and the envelope narrowing to Detailed as sides are checked.
 */

type Refs = { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("../agent/__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };

function bungalow(): ExteriorV2 {
  let v2: ExteriorV2 = { ...houseOfShape("cal", null, []), sizeBand: "md" };
  v2 = { ...v2, sides: defaultSides(v2) };
  v2 = ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors"].reduce<ExteriorV2>((acc, p) => togglePart(acc, p as never), v2);
  return { ...v2, wall: { ...v2.wall, down: "weatherboards" }, gableFill: "stucco" };
}

describe("the per-side answers", () => {
  it("counts clamp and un-check; the size answer keeps or writes the numbers; Not sure keeps the typical", () => {
    let v2 = bungalow();
    v2 = setSideCounts(v2, "front", { windows: 5, doors: 2 });
    expect(v2.sides.front!.windows).toBe(5);
    expect(v2.sides.front!.doors).toBe(2);
    expect(setSideCounts(v2, "front", { windows: 99 }).sides.front!.windows).toBe(60);
    const typical = v2.sides.front!.w;
    expect(setSideSize(v2, "front", "yes").sides.front!).toMatchObject({ size: "yes", w: typical, adjusted: false });
    expect(setSideSize(v2, "front", "adj", { w: 10.2, h: 3.33 }).sides.front!).toMatchObject({ size: "adj", w: 10, h: 3.3, adjusted: true });
    expect(setSideSize(v2, "front", "ns").sides.front!).toMatchObject({ size: "ns", w: typical, adjusted: false });
    expect(setSideCond(v2, "back", "peeling").sides.back!.cond).toBe("peeling");
  });
  it("Check this side waits for the size answer, turns the tile, and the next unchecked side follows; a change un-checks", () => {
    let v2 = bungalow();
    expect(canCheckSide(v2, "front")).toBe(false);
    expect(checkSide(v2, "front").sides.front!.checked).toBe(false);
    v2 = setSideSize(v2, "front", "yes");
    expect(canCheckSide(v2, "front")).toBe(true);
    v2 = checkSide(v2, "front");
    expect(v2.sides.front!.checked).toBe(true);
    expect(v2.sides.front!.confirmed).toBe(true);
    expect(walkTileState(v2, "front", "right")).toBe("ok");
    expect(nextUncheckedSide(v2, "front")).toBe("right");
    v2 = setSidePaint(v2, "left", false);
    for (const k of ["right", "back"] as const) v2 = checkSide(setSideSize(v2, k, "yes"), k);
    expect(allSidesChecked(v2)).toBe(true);
    expect(nextUncheckedSide(v2, "back")).toBeNull();
    expect(setSideCounts(v2, "front", { windows: 1 }).sides.front!.checked).toBe(false);
    expect(allSidesChecked(setSideCond(v2, "front", "good"))).toBe(false);
    // The worst side's condition is the job's; the peeling sides are named for the work order.
    v2 = setSideCond(setSideCond(setSideCond(v2, "front", "good"), "right", "peeling"), "back", "weathered");
    expect(worstCondition(v2)).toBe("peeling");
    expect(peelingSidesOf(v2)).toEqual(["right"]);
  });
});

describe("the rebuild from the drawn house", () => {
  it("replaces the side and extras nodes, keeps each side's id and the customer's words, leaves the access node, and swaps the model's deferrals", () => {
    const v2 = bungalow();
    let n = 1;
    const first = exteriorV2Nodes(v2, () => n++, [], null);
    const access = { id: 900, kind: "area", name: "Exterior - Access", type: "Exterior", areaType: "surface", surfaces: [] };
    const blocks = [...first.areas.map((a) => ({ ...a })), access] as Array<Record<string, unknown> & { id?: unknown; name?: unknown; surfaces?: unknown }>;
    const frontId = Number(blocks[0].id);
    blocks[0].customerNote = "the bay window is rotten";
    blocks[0].customerLabel = "Street";
    const walked = checkSide(setSideSize(setSideCounts(v2, "front", { windows: 7 }), "front", "adj", { w: 10, h: 3 }), "front");
    const { blocks: out, nodes } = rebuildExteriorNodes(blocks, walked, [], null);
    const front = out.find((b) => String(b.name) === SIDE_NODE_NAME.front)!;
    expect(front.id).toBe(frontId);
    expect(front.customerNote).toBe("the bay window is rotten");
    expect(front.customerLabel).toBe("Street");
    expect((front as { L?: number }).L).toBe(10);
    expect((front as { surfaces: Array<{ code: string; count: number }> }).surfaces.find((s) => /Window/.test(s.code))!.count).toBe(7);
    expect((front as { customer?: { confirmed?: boolean; size?: string } }).customer).toMatchObject({ confirmed: true, size: "adjusted" });
    expect(out.map((b) => b.name)).toEqual(["Exterior - Front", "Exterior - Right", "Exterior - Rear", "Exterior - Left", "Exterior - Access"]);
    expect(out.find((b) => b.id === 900)).toBeTruthy();
    expect(nodes.deferred.some((d) => d.areaId === frontId)).toBe(false); // the front is confirmed — no measurement deferral
    expect(nodes.deferred.some((d) => d.kind === "exterior_width")).toBe(true); // the others are still typical
    expect(isModelDeferral({ room: "Exterior - Front", kind: "exterior_width" })).toBe(true);
    expect(isModelDeferral({ room: "Exterior", what: "scaffold / platform access" })).toBe(false);
  });
  it("a gable end is not a wall line for the editor's share", () => {
    expect(isWallLine({ code: "Stucco", clientLabel: "Gable end — stucco" })).toBe(false);
    expect(isWallLine({ code: "Stucco", clientLabel: "Walls" })).toBe(true);
    expect(isWallLine({ code: "Weatherboards" })).toBe(true);
  });
});

describe("the range turns Detailed as the sides are checked (§5.3)", () => {
  const base = () => quickLookToState({ ...DEFAULT_QUICK_LOOK, jobType: "exterior" }, { ...defaultWizardState(), mode: "customer" as const });
  const envelope = (v2: ExteriorV2) => {
    const s = applyExteriorQuickLook({ ...DEFAULT_EXTERIOR_QUICK_LOOK, access: ["none"], v2 }, base());
    const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };
    let n = 1;
    applyExteriorAnswers(merged, s, () => n++, new Set(s.surfaces));
    const modSel = applyConditionPricing(merged, s, () => 900, ctx);
    return envelopeFor({ blocks: merged.areas as never, state: s, ctx, adj: { modSel, materials: {} }, bands: DEFAULT_BANDS, confirmed: confirmedSidesMap(merged.areas, v2) });
  };
  it("Guide at the gate; Detailed once every painted side is checked with its condition; wider with one Not sure", () => {
    const v2 = bungalow();
    expect(envelope(v2).bandPct).toBeGreaterThan(DEFAULT_BANDS.midPct);
    let walked = v2;
    for (const k of ["front", "right", "back", "left"] as const) walked = checkSide(setSideCond(setSideSize(walked, k, "yes"), k, "good"), k);
    const done = envelope(walked);
    expect(done.open).not.toContain("condition");
    expect(done.bandPct).toBeLessThanOrEqual(DEFAULT_BANDS.midPct);
    const ns = checkSide(setSideSize(walked, "left", "ns"), "left");
    expect(envelope(ns).bandPct).toBeGreaterThan(done.bandPct);
    const nsAreas = exteriorV2Nodes(ns, (() => { let i = 1; return () => i++; })(), [], null).areas;
    const left = nsAreas.find((a) => a.name === SIDE_NODE_NAME.left)!;
    expect(confirmedSidesMap(nsAreas, ns).get(left.id)).toBe("pending");
  });
});
