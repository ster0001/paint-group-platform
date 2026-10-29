import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_LOOK, stepsFor, type QuickLook } from "./quick-look";
import { applyColourChoice, applyJobChoice, mobileScreensFor, toggleSurface } from "./mobileScreens";
import { DEFAULT_EXTERIOR_QUICK_LOOK } from "./exterior-quick-look";
import { elevationCaption, outsideSheetChips, pictureStateFor, ribbonFor, WALL_TINT } from "./mobilePicture";
import type { ExteriorV2 } from "./state";

const q = (over: Partial<QuickLook> = {}): QuickLook => ({ ...DEFAULT_QUICK_LOOK, ...over });
const screensOf = (quick: QuickLook) => mobileScreensFor(stepsFor(quick.jobType, quick.propertyKind, "areas", "range", quick.scope, true), quick);
const v2 = (over: Partial<ExteriorV2> = {}): ExteriorV2 => ({
  propertyType: "wb", sizeBand: "md", rowPosition: null, wall: { down: null, up: null, brickPainted: null, timberPainted: null }, gableFill: null, windowType: "unsure",
  garageCars: null, postKind: null, parts: [], extras: [], extraSizes: {}, extraWallMaterial: null, sides: {}, ...over,
} as ExteriorV2);

describe("the picture state (wizard mobile v5 §3.1)", () => {
  it("inside is the room; unpainted before the surfaces screen, the ticks after it", () => {
    const before = pictureStateFor(q(), null, false);
    expect(before).toMatchObject({ kind: "room", property: "house", two: false, colour: "new", condition: "wear", painted: null });
    const after = pictureStateFor(q(applyJobChoice("whole", [])), null, true);
    expect(after.painted).toEqual({ walls: true, ceilings: true, skirting: true, doors: true, windows: true });
    const unticked = pictureStateFor(q({ ...applyJobChoice("whole", []), ...toggleSurface(q(), "ceilings") }), null, true);
    expect(unticked.painted?.ceilings).toBe(false);
    expect(unticked.painted?.walls).toBe(true);
  });
  it("the variants: unit, townhouse, two storeys, the three tints, the condition marks", () => {
    expect(pictureStateFor(q({ propertyKind: "unit_apartment" }), null, false).property).toBe("unit_apartment");
    expect(pictureStateFor(q({ propertyKind: "townhouse" }), null, false).property).toBe("townhouse");
    expect(pictureStateFor(q({ storeys: "double" }), null, false).two).toBe(true);
    expect(pictureStateFor(q(applyColourChoice(q(), "same")), null, false).colour).toBe("same");
    expect(pictureStateFor(q(applyColourChoice(q(), "deciding")), null, false).colour).toBe("deciding");
    expect(pictureStateFor(q({ condition: "needs_work" }), null, false).condition).toBe("needs_work");
    expect(WALL_TINT).toEqual({ new: "#cfe3d6", same: "#f1efe9", deciding: "#dcecef" });
  });
  it("outside is the house, drawn from the exterior brief's parts (§2.4): shape → variant, parts → surfaces", () => {
    const outside = { ...DEFAULT_EXTERIOR_QUICK_LOOK, v2: v2({ propertyType: "ds", parts: ["walls", "gutters", "posts"] }) };
    const s = pictureStateFor(q({ jobType: "exterior" }), outside, false);
    expect(s).toMatchObject({ kind: "house", property: "house", two: true });
    expect(s.painted).toEqual({ walls: true, eaves: false, gutters: true, windows: false, doors: false, verandah: true });
    expect(pictureStateFor(q({ jobType: "exterior" }), { ...outside, v2: v2({ propertyType: "unit" }) }, false)).toMatchObject({ property: "unit_apartment", painted: null });
    expect(pictureStateFor(q({ jobType: "exterior" }), { ...outside, v2: v2({ propertyType: "terrace" }) }, false).property).toBe("townhouse");
    // no drawn house yet: the place answer stands in
    expect(pictureStateFor(q({ jobType: "exterior", propertyKind: "townhouse" }), null, false)).toMatchObject({ kind: "house", property: "townhouse", painted: null });
  });
  it("the sheet's outside chips are the Painting screens' parts in order (the verandah family once the verandah is ticked), each toggling itself (S2)", () => {
    const chips = outsideSheetChips(v2({ parts: ["gable"] }));
    expect(chips.map((c) => `${c.key}:${c.part}:${c.on ? 1 : 0}`)).toEqual([
      "walls:walls:0", "gable:gable:1", "fascias:fascias:0", "gutters:gutters:0", "downpipes:downpipes:0", "eaves:eaves:0",
      "windows:windows:0", "doors:doors:0", "garage:garage:0", "shutters:shutters:0", "verandah:verandah:0",
    ]);
    expect(outsideSheetChips(v2({ parts: ["verandah"] })).map((c) => c.key)).toContain("posts");
    expect(outsideSheetChips(null)).toEqual([]);
  });
});

describe("the ribbon (§2.2)", () => {
  it("joins the answers given so far with ' · ', and counts the surfaces once they exist", () => {
    const quick = q({ bedrooms: 3, storeys: "double", ...applyJobChoice("whole", []) });
    const screens = screensOf(quick);
    const at = (id: string) => screens.findIndex((s) => s.id === id);
    expect(ribbonFor({ quick, outside: null, screens, index: 0, roomsTicked: 8 })).toEqual({ line1: "Your place", line2: "Updates as you answer · tap to see" });
    expect(ribbonFor({ quick, outside: null, screens, index: at("beds"), roomsTicked: 8 }).line1).toBe("Inside · House");
    expect(ribbonFor({ quick, outside: null, screens, index: at("surfaces"), roomsTicked: 8 })).toEqual({ line1: "Inside · House · 3 bed · Two storeys · Whole interior", line2: "5 surfaces ticked · tap to see" });
    const full = ribbonFor({ quick, outside: null, screens, index: at("details"), roomsTicked: 8 });
    expect(full.line1).toBe("Inside · House · 3 bed · Two storeys · Whole interior · 8 rooms · New colours · Some wear");
    expect(ribbonFor({ quick: q({ ...quick, ...toggleSurface(quick, "walls") }), outside: null, screens, index: at("colours"), roomsTicked: 1 }).line2).toBe("4 surfaces ticked · tap to see");
    expect(ribbonFor({ quick: q({ ...quick, bedrooms: 5 }), outside: null, screens, index: at("storeys"), roomsTicked: 1 }).line1).toBe("Inside · House · 5+ bed");
  });
  it("on an outside job the second line counts the parts once the painting screen is reached", () => {
    const quick = q({ jobType: "exterior" });
    const screens = screensOf(quick);
    const outside = { ...DEFAULT_EXTERIOR_QUICK_LOOK, v2: v2({ parts: ["walls", "doors"] }) };
    const paintAt = screens.findIndex((s) => s.step === "paint");
    expect(ribbonFor({ quick, outside, screens, index: paintAt - 1, roomsTicked: 0 }).line2).toBe("Updates as you answer · tap to see");
    // exterior on mobile v5 (S1): past the shape and size screens the ribbon names the home in place of "House"
    expect(ribbonFor({ quick, outside, screens, index: paintAt, roomsTicked: 0 })).toEqual({ line1: "Outside · Weatherboard home · Medium", line2: "2 parts ticked · tap to see" });
  });
});

/** Exterior on mobile v5, session 1 (plan §3): the ribbon names the shape and the size; the sheet's caption says the typical sizes. */
describe("exterior on mobile v5 — the ribbon and the drawn house's caption", () => {
  it("the ribbon reads Outside · <shape> · <size> once those screens are passed, the place's kind dropped", () => {
    const quick = q({ jobType: "exterior" });
    const screens = mobileScreensFor(stepsFor("exterior", "house", "areas", "range", "whole", true), quick, { v2: v2({ propertyType: "th" }) });
    const at = (id: string) => screens.findIndex((s) => s.id === id);
    const outside = { ...DEFAULT_EXTERIOR_QUICK_LOOK, v2: v2({ propertyType: "th", sizeBand: "sm" }) };
    expect(ribbonFor({ quick, outside, screens, index: at("shape"), roomsTicked: 0 }).line1).toBe("Outside · House");
    expect(ribbonFor({ quick, outside, screens, index: at("size"), roomsTicked: 0 }).line1).toBe("Outside · Townhouse");
    expect(ribbonFor({ quick, outside, screens, index: at("row"), roomsTicked: 0 }).line1).toBe("Outside · Townhouse · Small");
    expect(ribbonFor({ quick, outside: { ...outside, v2: null }, screens, index: at("size"), roomsTicked: 0 }).line1).toBe("Outside · House");
  });
  it("the caption: shape · size · storeys · about N m across, H m to the gutter (the parapet on a terrace)", () => {
    expect(elevationCaption(v2({ propertyType: "cal", sizeBand: "sm" }))).toBe("Californian bungalow · Small · single storey · about 8.5 m across, 3 m to the gutter");
    expect(elevationCaption(v2({ propertyType: "th", sizeBand: null }))).toBe("Townhouse · two storeys · about 6.5 m across, 5.6 m to the gutter");
    expect(elevationCaption(v2({ propertyType: "terrace", sizeBand: "md" }))).toContain("to the parapet");
  });
});
