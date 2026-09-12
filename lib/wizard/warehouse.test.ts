import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_WAREHOUSE_ANSWERS, WH_SURFACES, warehouseAssumedList, warehouseFloorArea, warehouseRestatement, warehouseRoomList,
  warehouseSurfaceKeys, toggleWarehouseMaterial, type WarehouseAnswers,
} from "./warehouse";
import { DEFAULT_SEGMENTS, commercialAssumedList, commercialRestatement, commercialSurfaceKeys, defaultCommercialAnswers, segmentByKey } from "./segments";
import { DEFAULT_COMMERCIAL_PRICING, commercialPricingFrom, hourLoadingFor, rackingSharePct, warehouseDimensions } from "@/lib/pricing/commercial";
import { computeQuantity, priceSurface, resolveRates, itemIndex, productIndex, jobModifier, type AreaInput, type PricingContext, type SurfaceInput } from "@/lib/pricing/estimate";
import { DEFAULT_QUICK_LOOK, quickLookToState, stepsFor } from "./quick-look";
import { defaultWizardState, wizardStateSchema } from "./state";
import { applyWizardAnswers } from "./merge";

/**
 * C13 golden tests (addendum S6b):
 *   (1) racking=most prices the walls at exactly racking_most of racking=no;
 *   (2) height 4–6 m with lift_on_site=false adds one EWP line, true adds none;
 *   (3) roller doors = count × the per-door-per-face rate, one face on an inside job;
 * and: no beds or storeys key is written for a warehouse session; flagged
 * items appear as "priced on confirmation".
 */

const fixture = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: PricingContext };
const ctx: PricingContext = fixture.reference;
const warehouse = segmentByKey(DEFAULT_SEGMENTS, "warehouse")!;
const office = segmentByKey(DEFAULT_SEGMENTS, "office")!;
const a = (over: Partial<WarehouseAnswers> = {}): WarehouseAnswers => ({ ...DEFAULT_WAREHOUSE_ANSWERS, whSurfaces: ["walls", "roller", "personnel"], materials: ["sheeting"], ...over });
const surfaceInput = (s: { code: string; count: number; sharePct?: number | null; prepHr: number }): SurfaceInput =>
  ({ code: s.code, coats: 2, count: s.count, prepHr: s.prepHr, sharePct: s.sharePct ?? null });

describe("(1) racking", () => {
  it("racking=most paints exactly racking_most of the walls racking=no paints", () => {
    let id = 1;
    const no = warehouseFloorArea(() => id++, a({ racking: "no" })).area;
    const most = warehouseFloorArea(() => id++, a({ racking: "most" })).area;
    const wallNo = no.surfaces.find((s) => s.code === "Colorbond Cladding")!;
    const wallMost = most.surfaces.find((s) => s.code === "Colorbond Cladding")!;
    expect(wallNo.sharePct).toBe(100);
    expect(wallMost.sharePct).toBe(70);
    const item = ctx.rateItems.find((r) => r.code === "Colorbond Cladding")!;
    const qNo = computeQuantity(item, no as unknown as AreaInput, surfaceInput(wallNo));
    const qMost = computeQuantity(item, most as unknown as AreaInput, surfaceInput(wallMost));
    // 2(L+W) × H at the 500–1,000 bracket (30 × 25) and 4–6 m (5 m)
    expect(qNo).toBeCloseTo(2 * (30 + 25) * 5, 6);
    expect(qMost / qNo).toBeCloseTo(DEFAULT_COMMERCIAL_PRICING.racking.most, 9);
    expect(rackingSharePct("some")).toBe(88);
    expect(rackingSharePct("most", commercialPricingFrom({ racking: { most: 0.5 } }))).toBe(50);
  });

  it("the walls price through the engine at the cladding row although the floor is an interior room", () => {
    let id = 1;
    const floor = warehouseFloorArea(() => id++, a()).area;
    const wall = floor.surfaces.find((s) => s.code === "Colorbond Cladding")!;
    const items = itemIndex(ctx.rateItems);
    expect(items.has("Interior::Colorbond Cladding")).toBe(false); // the row is exterior-only
    const adj = { modSel: {}, materials: {} };
    const r = priceSurface(floor as unknown as AreaInput, surfaceInput(wall), ctx, adj, resolveRates(ctx, adj), items, productIndex(ctx.products), jobModifier(ctx.modifiers, {}));
    expect(r.isItem).toBe(false);
    expect(r.qty).toBeGreaterThan(0);
    expect(r.paintingHr).toBeGreaterThan(0);
    expect(r.labourCents).toBeGreaterThan(0);
  });

  it("several materials split the wall evenly, each × the racking share", () => {
    let id = 1;
    const floor = warehouseFloorArea(() => id++, a({ materials: ["precast", "blockwork"], racking: "some" })).area;
    const walls = floor.surfaces.filter((s) => /Walls —/.test(s.internalLabel));
    expect(walls.map((s) => s.code)).toEqual(["Concrete / Tilt Slab", "Brick (Unpainted)"]);
    expect(walls.map((s) => s.sharePct)).toEqual([44, 44]);
  });
});

describe("(2) the EWP line", () => {
  it("4–6 m without a lift on site adds exactly one; with a lift none; up to 4 m none", () => {
    let id = 1;
    const ewp = (x: WarehouseAnswers) => warehouseFloorArea(() => id++, x).deferred.filter((d) => d.kind === "commercial_ewp");
    expect(ewp(a({ roofHeight: "6", liftOnSite: false }))).toHaveLength(1);
    expect(ewp(a({ roofHeight: "6", liftOnSite: false }))[0].what).toMatch(/Scissor lift for walls to 5 m/);
    expect(ewp(a({ roofHeight: "6", liftOnSite: true }))).toHaveLength(0);
    expect(ewp(a({ roofHeight: "4" }))).toHaveLength(0);
    expect(ewp(a({ roofHeight: "12" }))).toHaveLength(1);
    // The threshold is the Settings value.
    expect(warehouseFloorArea(() => id++, a({ roofHeight: "6" }), commercialPricingFrom({ ewpHeightThresholdM: 6 })).deferred.filter((d) => d.kind === "commercial_ewp")).toHaveLength(0);
  });
});

describe("(3) doors", () => {
  it("roller doors = count × the per-door-per-face row, ONE face on an inside job; personnel doors both sides", () => {
    let id = 1;
    const floor = warehouseFloorArea(() => id++, a({ rollerDoors: 3, personnelDoors: 4 })).area;
    const roller = floor.surfaces.find((s) => s.code === "Garage Door (1 Car)")!;
    const personnel = floor.surfaces.find((s) => s.code === "Standard Door (1 Side)")!;
    expect(roller.count).toBe(3);
    expect(personnel.count).toBe(8);
    const item = ctx.rateItems.find((r) => r.code === "Garage Door (1 Car)")!;
    expect(computeQuantity(item, floor as unknown as AreaInput, surfaceInput(roller))).toBe(3);
    const adj = { modSel: {}, materials: {} };
    const items = itemIndex(ctx.rateItems);
    const one = priceSurface(floor as unknown as AreaInput, surfaceInput({ ...roller, count: 1 }), ctx, adj, resolveRates(ctx, adj), items, productIndex(ctx.products), jobModifier(ctx.modifiers, {}));
    const three = priceSurface(floor as unknown as AreaInput, surfaceInput(roller), ctx, adj, resolveRates(ctx, adj), items, productIndex(ctx.products), jobModifier(ctx.modifiers, {}));
    expect(three.paintingHr).toBeCloseTo(one.paintingHr * 3, 9);
  });

  it("a zero count seeds no door line", () => {
    let id = 1;
    const floor = warehouseFloorArea(() => id++, a({ rollerDoors: 0 })).area;
    expect(floor.surfaces.some((s) => s.code === "Garage Door (1 Car)")).toBe(false);
  });
});

describe("the flags — priced on confirmation, never guessed", () => {
  it("roof, steel, bollards, line marking and the mezzanine are flagged lines with no surface", () => {
    let id = 1;
    const r = warehouseFloorArea(() => id++, a({ whSurfaces: ["walls", "roof", "steel", "bollards", "lines", "mezz"] }));
    const flagged = r.deferred.filter((d) => d.kind === "commercial_flagged").map((d) => d.what);
    expect(flagged).toEqual(["Underside of the roof", "Structural steel and columns", "Bollards and safety yellow", "Line marking", "Mezzanine — walls and balustrade"]);
    expect(r.area.surfaces.filter((s) => !/Walls —/.test(s.internalLabel))).toHaveLength(0);
    for (const o of WH_SURFACES.filter((x) => x.flagged)) expect(flagged.join(" ")).toMatch(new RegExp(o.label.split(" ")[0]));
  });

  it("precast and blockwork name their prep as a crew note and a flag — no invented hours", () => {
    let id = 1;
    const r = warehouseFloorArea(() => id++, a({ materials: ["precast", "blockwork"] }));
    const walls = r.area.surfaces.filter((s) => /Walls —/.test(s.internalLabel));
    expect(walls[0].crewNote).toMatch(/sealer/);
    expect(walls[1].crewNote).toMatch(/block filler/);
    for (const w of walls) expect(w.prepHr).toBe(0);
    expect(r.deferred.filter((d) => d.kind === "commercial_prep")).toHaveLength(2);
    // Not told = the tilt-slab placeholder, flagged.
    const unsure = warehouseFloorArea(() => id++, a({ materials: [] }));
    expect(unsure.area.surfaces[0].code).toBe("Concrete / Tilt Slab");
    expect(unsure.deferred.some((d) => d.kind === "commercial_material")).toBe(true);
  });

  it("racking other than 'no' is flagged for the person who confirms the share", () => {
    let id = 1;
    expect(warehouseFloorArea(() => id++, a({ racking: "some" })).deferred.some((d) => d.kind === "commercial_racking")).toBe(true);
    expect(warehouseFloorArea(() => id++, a({ racking: "no" })).deferred.some((d) => d.kind === "commercial_racking")).toBe(false);
  });
});

describe("the rest of the tree, the ticks, the loading", () => {
  it("offices inside are priced like an office — the office row's typicals; amenities from its also-size", () => {
    const rooms = warehouseRoomList(a({ whSurfaces: ["walls", "offices", "amenities"], offices: 2 }), office);
    expect(rooms.map((r) => r.name)).toEqual(["Office 1", "Office 2", "Amenities"]);
    expect(rooms[0]).toMatchObject({ roomType: "study", L: 3.5, W: 4 });
    expect(rooms[2]).toMatchObject({ roomType: "bathroom", L: 3, W: 2.5 });
    expect(warehouseRoomList(a({ whSurfaces: ["walls"] }), office)).toEqual([]);
  });

  it("the ticks follow the surfaces and materials, and the merge keeps the floor's lines", () => {
    const keys = warehouseSurfaceKeys(a({ whSurfaces: ["walls", "roller", "personnel", "offices"], materials: ["precast", "plasterboard"] }));
    expect(keys).toEqual(expect.arrayContaining(["concrete", "walls", "garage_doors", "exterior_doors", "ceilings"]));
    expect(commercialSurfaceKeys(warehouse, { ...defaultCommercialAnswers(warehouse), materials: ["sheeting"] }).keys).toContain("colorbond");
    // Through the merge: the wall, roller and personnel lines survive the tick filter.
    const state = quickLookToState({ ...DEFAULT_QUICK_LOOK, propertyKind: "commercial" }, { ...defaultWizardState(), mode: "customer" as const });
    state.surfaces = keys as typeof state.surfaces;
    let id = 1;
    const floor = warehouseFloorArea(() => id++, a({ materials: ["precast", "plasterboard"] }));
    const merged = applyWizardAnswers({ areas: [floor.area], skipped: [], deferred: floor.deferred, assumedCount: 0 }, state, () => id++);
    expect(merged.areas[0].surfaces.map((s) => s.code)).toEqual(["Concrete / Tilt Slab", "Walls", "Garage Door (1 Car)", "Standard Door (1 Side)"]);
  });

  it("operating during the works is the operating loading, on top of hours and occupied", () => {
    expect(hourLoadingFor({ hours: "business", occ: null, operating: true })).toBe(1.15);
    expect(hourLoadingFor({ hours: "after", occ: null, operating: true })).toBe(1.5525);
    expect(hourLoadingFor({ hours: "business", occ: null, operating: false })).toBe(1);
  });

  it("typed L × W beats the bracket", () => {
    expect(warehouseDimensions("2500", null, null)).toEqual({ L: 45, W: 40, typed: false });
    expect(warehouseDimensions("2500", 60, 30)).toEqual({ L: 60, W: 30, typed: true });
    expect(warehouseDimensions("2500", 60, null).typed).toBe(false);
    let id = 1;
    expect(warehouseFloorArea(() => id++, a({ lengthM: 60, widthM: 30 })).area).toMatchObject({ L: 60, W: 30, assumedFields: ["H"] });
  });

  it("'not sure' on the materials is exclusive", () => {
    expect(toggleWarehouseMaterial(["precast"], "unsure")).toEqual(["unsure"]);
    expect(toggleWarehouseMaterial(["unsure"], "blockwork")).toEqual(["blockwork"]);
  });
});

describe("no beds or storeys on a warehouse session", () => {
  it("the walk has no place-screen basics, no exterior block, and the state parses", () => {
    expect(stepsFor("interior", "commercial", "warehouse")).toEqual(["start", "place", "segment", "com_warehouse", "com_job"]);
    const base = quickLookToState({ ...DEFAULT_QUICK_LOOK, propertyKind: "commercial" }, { ...defaultWizardState(), mode: "customer" as const });
    const answers = { ...defaultCommercialAnswers(warehouse), whSurfaces: ["walls" as const], materials: ["precast" as const] };
    const s = { ...base, basics: null, commercial: answers, surfaces: warehouseSurfaceKeys(answers) as typeof base.surfaces, customer: { ...base.customer!, suburb: "Murrumbeena", postcode: "3163", propertyKind: "commercial" as const, commercialSegment: "warehouse" } };
    expect(s.basics).toBeNull();
    expect(s.exterior).toBeNull();
    const parsed = wizardStateSchema.safeParse({ ...s, contact: { ...s.contact, name: "A", email: "a@example.com", phone: "0400000000" } });
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(JSON.stringify(parsed.data?.commercial)).not.toMatch(/beds|storeys/);
  });

  it("the reveal's words come from the warehouse answers", () => {
    const answers = { ...defaultCommercialAnswers(warehouse), areaBracket: "2500" as const, roofHeight: "6" as const, racking: "some" as const, operating: true };
    expect(commercialRestatement(warehouse, answers, DEFAULT_QUICK_LOOK)).toMatch(/^Based on a large warehouse, 4–6 m high, racking against some walls, new colours, some wear, operating during the works\./);
    const keys = commercialAssumedList(warehouse, answers, 0).map((x) => x.key);
    expect(keys).toEqual(["rooms", "height", "racking", "material", "operating", "excluded"]);
    expect(warehouseAssumedList(answers).find((x) => x.key === "height")!.what).toMatch(/Scissor lift hire allowed for/);
    expect(warehouseRestatement({ ...answers, lengthM: 60, widthM: 30 }, "same", "good")).toMatch(/^Based on a 60 × 30 m warehouse/);
  });
});
