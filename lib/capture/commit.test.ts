/**
 * The parity test the room-loop brief calls the guard on rule 2: a room built
 * through capture prices IDENTICALLY to the same room built by hand in the
 * builder. Plus the badge model: four taps = one row at qty 4, never four rows.
 */
import { describe, expect, it } from "vitest";
import { defectHours, defectSummary, draftToAreaNode, emptyDraft, type DefectRate } from "./commit";
import { expandCaptureTiles, tilesForRoomType, type TileRule } from "./presets";
import {
  priceArea,
  priceSurface,
  resolveRates,
  type Adjustments,
  type AreaInput,
  type PricingContext,
  type SurfaceInput,
} from "@/lib/pricing/estimate";
import type { Product, RateItem } from "@/lib/pricing/types";

// ---- pricing fixture (same shape as lib/pricing's own tests, v7-style codes) --

const item = (over: Partial<Record<string, unknown>>) => ({
  category: "Interior", unit: "M2", sub_category: "Walls",
  rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, rate_4_coat: null,
  charge_out_cents: 8500, default_product: null, metres_per_litre: null,
  litres_per_item_per_coat: null, default_coats: 2, ...over,
}) as unknown as RateItem;

const ctx: PricingContext = {
  rateItems: [
    item({ code: "Walls" }),
    item({ code: "Ceilings", sub_category: "Ceilings", rate_2_coat: 10 }),
    item({ code: "Standard Cornices", unit: "Lineal Metres", sub_category: "Cornices", rate_2_coat: 20 }),
    item({ code: "Skirting Boards", unit: "Lineal Metres", sub_category: "Skirting", rate_2_coat: 15 }),
    item({ code: "Flat Door and Frame (1 Side)", unit: "Hours Per Item", sub_category: "Doors", rate_2_coat: 0.75 }),
    item({ code: "Double Hung Sash", unit: "Hours Per Item", sub_category: "Windows", rate_2_coat: 1.2 }),
  ],
  products: [] as unknown as Product[],
  modifiers: [],
  settings: [
    { key: "Materials markup", value: { value: 0.1 } },
    { key: "GST", value: { value: 0.1 } },
  ],
};
const adj: Adjustments = { modSel: {}, materials: {} };
const rates = resolveRates(ctx, adj);

// ---- the bedroom rules as they exist at version 3 ---------------------------

const rule = (surface_type: string, tile_group: string, sort_order: number, countable: boolean): TileRule =>
  ({ room_type: "bedroom", surface_type, is_option: false, requires_confirm: false, countable, tile_group, sort_order, notes: null });

const bedroomTiles = expandCaptureTiles(tilesForRoomType("bedroom", [
  rule("Walls", "core", 10, false),
  rule("Ceiling", "core", 20, false),
  rule("Cornices", "core", 30, false),
  rule("Skirting Boards", "core", 40, false),
  rule("Door & Frame", "openings", 50, true),
  rule("Windows", "openings", 60, true),
]));

const tileId = (label: string) => bedroomTiles.find((t) => t.label === label)!.id;

/** A hand-built builder surface — QuoteBuilder.newSurface() defaults. */
const handSurface = (code: string, over: Partial<SurfaceInput> = {}): SurfaceInput =>
  ({ code, coats: 2, count: 1, prepHr: 0, hidden: false, measureL: null, measureH: null,
     qtyOverride: null, rateOverride: null, paintingHrOverride: null, useCustomRate: false,
     customRate: null, coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
     priceOverride: null, productName: null, ...over });

describe("capture -> builder parity", () => {
  it("a plain bedroom prices identically to the same room built by hand", () => {
    const draft = emptyDraft("r1", "Bedroom 2", "bedroom", "ground", 2.4);
    draft.lengthM = 4.2; draft.widthM = 3.6;
    draft.selections = {
      [tileId("Walls")]: 1,
      [tileId("Ceiling")]: 1,
      [tileId("Cornices")]: 1,
      [tileId("Skirting Boards")]: 1,
      [tileId("Flat Door + Frame")]: 1,
      [tileId("Sash Window")]: 2,
    };
    let id = 100;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);

    const hand: AreaInput = {
      kind: "area", type: "Interior", areaType: "room", L: 4.2, W: 3.6, H: 2.4,
      surfaces: [
        handSurface("Walls"),
        handSurface("Ceilings"),
        handSurface("Standard Cornices"),
        handSurface("Skirting Boards"),
        handSurface("Flat Door and Frame (1 Side)", { count: 1 }),
        handSurface("Double Hung Sash", { count: 2 }),
      ],
    };

    expect(priceArea(node as unknown as AreaInput, ctx, adj)).toBe(priceArea(hand, ctx, adj));
    // and per-surface, not just in aggregate:
    node.surfaces.forEach((s, i) => {
      const a = priceSurface(node as unknown as AreaInput, s as unknown as SurfaceInput, ctx, adj, rates);
      const b = priceSurface(hand, hand.surfaces[i], ctx, adj, rates);
      expect(a).toEqual(b);
    });
    // no overrides leak in for a plain rectangle
    expect(node.surfaces.every((s) => s.qtyOverride === null && s.measureL === null)).toBe(true);
    expect(node.perimeterOverridden).toBe(false);
  });

  it("four taps on a countable tile = ONE row at qty 4, never four rows", () => {
    const draft = emptyDraft("r2", "Hallway", "bedroom", "ground", 2.4);
    draft.lengthM = 5; draft.widthM = 1.2;
    draft.selections = { [tileId("Flat Door + Frame")]: 4 };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    expect(node.surfaces).toHaveLength(1);
    expect(node.surfaces[0].count).toBe(4);
  });

  it("an L-shaped room's extra segment flows through qtyOverride for walls and measureL for lineal runs", () => {
    const draft = emptyDraft("r3", "Lounge", "bedroom", "ground", 2.4);
    draft.lengthM = 4; draft.widthM = 3; draft.extraWallSegmentsM = [2];
    draft.selections = { [tileId("Walls")]: 1, [tileId("Skirting Boards")]: 1 };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    const walls = node.surfaces.find((s) => s.code === "Walls")!;
    const skirting = node.surfaces.find((s) => s.code === "Skirting Boards")!;
    expect(walls.qtyOverride).toBeCloseTo(16 * 2.4);
    expect(skirting.measureL).toBe(16);
    expect(node.irregular).toBe(true);
    // the override is what lib/pricing actually prices
    const priced = priceSurface(node as unknown as AreaInput, walls as unknown as SurfaceInput, ctx, adj, rates);
    expect(priced.qty).toBeCloseTo(38.4);
  });

  it("excluded and untapped tiles produce nothing; prep, coats and notes ride the row", () => {
    const draft = emptyDraft("r4", "Kitchen", "bedroom", "ground", 2.4);
    draft.lengthM = 4; draft.widthM = 3;
    draft.selections = { [tileId("Walls")]: 1, [tileId("Ceiling")]: 1 };
    draft.exclusions = [tileId("Ceiling")];
    draft.prepHours = { [tileId("Walls")]: 1.5 };
    draft.coats = { [tileId("Walls")]: 3 };
    draft.crewNotes = { [tileId("Walls")]: "water stain above window" };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    expect(node.surfaces).toHaveLength(1);
    expect(node.surfaces[0]).toMatchObject({ code: "Walls", prepHr: 1.5, coats: 3, crewNote: "water stain above window" });
  });

  it("defect observations become server-priced prep hours + a named crew note", () => {
    const rates: DefectRate[] = [
      { defect_type: "peeling", unit: "m2", hours_sev1: 0.1, hours_sev2: 0.18, hours_sev3: 0.3 },
      { defect_type: "holes_dents", unit: "each", hours_sev1: 0.15, hours_sev2: 0.25, hours_sev3: 0.45 },
    ];
    expect(defectHours({ type: "peeling", severity: 2, qty: 3 }, rates)).toBeCloseTo(0.54);
    expect(defectHours({ type: "holes_dents", severity: 3, qty: 4 }, rates)).toBeCloseTo(1.8);
    expect(defectHours({ type: "unknown_thing", severity: 1, qty: 9 }, rates)).toBe(0);
    expect(defectHours({ type: "peeling", severity: 1, qty: 0 }, rates)).toBe(0);

    const draft = emptyDraft("r6", "Lounge", "bedroom", "ground", 2.4);
    draft.lengthM = 4; draft.widthM = 3;
    draft.selections = { [tileId("Walls")]: 1 };
    draft.prepHours = { [tileId("Walls")]: 0.5 };
    draft.crewNotes = { [tileId("Walls")]: "south wall" };
    draft.defects = { [tileId("Walls")]: [{ type: "peeling", severity: 2, qty: 3 }, { type: "holes_dents", severity: 1, qty: 2 }] };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++, { defectRates: rates });
    const walls = node.surfaces[0];
    expect(walls.prepHr).toBeCloseTo(0.5 + 0.54 + 0.3); // manual + defects
    expect(walls.crewNote).toContain("south wall");
    expect(walls.crewNote).toContain("Peeling sev2 3 m2 (0.54h)");
    expect(walls.crewNote).toMatch(/Holes \/ dents sev1 2x? \(0\.3h\)/); // each-unit renders "2x"
    // summary helper is what the note embeds
    expect(defectSummary(draft.defects[tileId("Walls")], rates)).toContain("Peeling sev2");
  });

  it("without a rates table defects cost nothing and parity is untouched", () => {
    const draft = emptyDraft("r7", "Bed", "bedroom", "ground", 2.4);
    draft.lengthM = 4; draft.widthM = 3;
    draft.selections = { [tileId("Walls")]: 1 };
    draft.defects = { [tileId("Walls")]: [{ type: "peeling", severity: 3, qty: 10 }] };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    expect(node.surfaces[0].prepHr).toBe(0);
  });

  it("re-committing a room keeps its area id so the builder edits in place", () => {
    const draft = emptyDraft("r5", "Bed 3", "bedroom", "ground", 2.4);
    draft.areaId = 42; draft.lengthM = 3; draft.widthM = 3;
    draft.selections = { [tileId("Walls")]: 1 };
    let id = 900;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    expect(node.id).toBe(42);
  });

  it("the committed node carries its exact draft for lossless re-entry", () => {
    const draft = emptyDraft("r8", "Bath", "bedroom", "ground", 2.4);
    draft.lengthM = 2; draft.widthM = 1.5;
    draft.selections = { [tileId("Walls")]: 2 }; // fractional state and all maps must survive
    draft.labels = { [tileId("Walls")]: "Half walls" };
    draft.hoursOverride = { [tileId("Walls")]: 3.5 };
    let id = 1;
    const node = draftToAreaNode(draft, bedroomTiles, () => id++);
    expect(node.captureDraft.selections).toEqual(draft.selections);
    expect(node.captureDraft.labels).toEqual(draft.labels);
    expect(node.captureDraft.hoursOverride).toEqual(draft.hoursOverride);
    expect(node.captureDraft.status).toBe("complete");
  });
});
