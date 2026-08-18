import { describe, expect, it } from "vitest";
import { perimeterM, perimeterPlausibility, resolveQuantity, type RoomGeometry } from "./quantities";
import { tilesForRoomType, heightForStorey, type TileRule } from "./presets";

const room: RoomGeometry = { lengthM: 4.2, widthM: 3.6, heightM: 2.4 };

describe("perimeterM", () => {
  it("derives 2(L+W)", () => {
    expect(perimeterM(room)).toBeCloseTo(15.6);
  });
  it("adds extra wall segments for irregular rooms", () => {
    expect(perimeterM({ ...room, extraWallSegmentsM: [1.2, 0.8] })).toBeCloseTo(17.6);
  });
  it("an override wins over the derived value", () => {
    expect(perimeterM({ ...room, perimeterOverrideM: 18 })).toBe(18);
  });
  it("ignores a cleared (null) override", () => {
    expect(perimeterM({ ...room, perimeterOverrideM: null })).toBeCloseTo(15.6);
  });
});

// The brief's resolution table, row by row.
describe("resolveQuantity", () => {
  it("wall_area = perimeter x height", () => {
    expect(resolveQuantity({ basis: "wall_area", geo: room })).toBeCloseTo(37.44);
  });
  it("wall_area deducts openings only when a deduction is configured", () => {
    expect(resolveQuantity({ basis: "wall_area", geo: room, openingsDeductionM2: 3.2 })).toBeCloseTo(34.24);
  });
  it("wall_area clamps to zero rather than going negative", () => {
    expect(resolveQuantity({ basis: "wall_area", geo: room, openingsDeductionM2: 999 })).toBe(0);
  });
  it("ceiling_area = L x W", () => {
    expect(resolveQuantity({ basis: "ceiling_area", geo: room })).toBeCloseTo(15.12);
  });
  it("perimeter passes through, including segments", () => {
    expect(resolveQuantity({ basis: "perimeter", geo: { ...room, extraWallSegmentsM: [2] } })).toBeCloseTo(17.6);
  });
  it("perimeter_less_doors subtracts door widths", () => {
    expect(resolveQuantity({ basis: "perimeter_less_doors", geo: room, doorCount: 2, doorWidthM: 0.8 })).toBeCloseTo(14);
  });
  it("per_item is the tap count", () => {
    expect(resolveQuantity({ basis: "per_item", geo: room, count: 4 })).toBe(4);
  });
  it("manual values pass through and never go negative", () => {
    expect(resolveQuantity({ basis: "manual_m2", geo: room, manualValue: 7.5 })).toBe(7.5);
    expect(resolveQuantity({ basis: "manual_lin", geo: room, manualValue: -3 })).toBe(0);
  });
});

describe("perimeterPlausibility", () => {
  it("a sane room passes", () => {
    expect(perimeterPlausibility(room, false)).toBe("ok");
  });
  it("an overridden perimeter far off the geometry is suspicious", () => {
    expect(perimeterPlausibility({ ...room, perimeterOverrideM: 40 }, false)).toBe("suspicious");
  });
  it("irregular rooms opt out", () => {
    expect(perimeterPlausibility({ ...room, perimeterOverrideM: 40 }, true)).toBeNull();
  });
});

// ---- presets: rules rows -> ordered tiles ----------------------------------

const rule = (over: Partial<TileRule>): TileRule => ({
  room_type: "bedroom",
  surface_type: "Walls",
  is_option: false,
  requires_confirm: false,
  countable: false,
  tile_group: "core",
  sort_order: 10,
  notes: null,
  ...over,
});

describe("tilesForRoomType", () => {
  const rules: TileRule[] = [
    rule({ surface_type: "Windows", tile_group: "openings", sort_order: 60, countable: true }),
    rule({ surface_type: "Walls", sort_order: 10 }),
    rule({ surface_type: "Door & Frame", tile_group: "openings", sort_order: 50, countable: true }),
    rule({ surface_type: "Ceiling", sort_order: 20 }),
    rule({ room_type: "kitchen", surface_type: "Cabinets" }),
  ];

  it("filters to the room type and orders core before openings", () => {
    const tiles = tilesForRoomType("bedroom", rules);
    expect(tiles.map((t) => t.surfaceType)).toEqual(["Walls", "Ceiling", "Door & Frame", "Windows"]);
  });
  it("core measured tiles are pre-selected, countables are offered not selected", () => {
    const tiles = tilesForRoomType("bedroom", rules);
    expect(tiles.find((t) => t.surfaceType === "Walls")?.defaultOn).toBe(true);
    expect(tiles.find((t) => t.surfaceType === "Windows")?.defaultOn).toBe(false);
  });
  it("maps measure bases and falls back to manual for unknown surfaces", () => {
    const tiles = tilesForRoomType("bedroom", rules);
    expect(tiles.find((t) => t.surfaceType === "Walls")?.measureBasis).toBe("wall_area");
    expect(tilesForRoomType("kitchen", [rule({ room_type: "kitchen", surface_type: "Splashback" })])[0].measureBasis).toBe("manual_m2");
  });
});

describe("heightForStorey", () => {
  it("reads the storey, falls back to ground, then the 2.4 default", () => {
    expect(heightForStorey({ ground: 2.4, first: 2.7 }, "first")).toBe(2.7);
    expect(heightForStorey({ ground: 2.55 }, "first")).toBe(2.55);
    expect(heightForStorey(null, "ground")).toBe(2.4);
  });
});
