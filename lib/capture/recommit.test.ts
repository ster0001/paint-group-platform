/**
 * A5's regression guard: capture opens ANY estimate's rooms — wizard-drafted,
 * plan-read or hand-built — and a recommit is non-destructive: builder-only
 * detail survives, lines capture can't express survive, and an untouched
 * surface round-trips to identical pricing (the parity rule).
 */
import { describe, expect, it } from "vitest";
import { draftToAreaNode, emptyDraft } from "./commit";
import { mergeRecommittedNode } from "./recommit";
import { expandCaptureTiles, storeyHeightsFromBlocks, tilesForRoomType, DEFAULT_STOREY_HEIGHTS, type TileRule } from "./presets";
import {
  priceArea,
  resolveRates,
  type Adjustments,
  type AreaInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import type { Product, RateItem } from "@/lib/pricing/types";

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
    item({ code: "Flat Door and Frame (1 Side)", unit: "Hours Per Item", sub_category: "Doors", rate_2_coat: 0.75 }),
    item({ code: "Staircase Custom", unit: "Hours Per Item", sub_category: "Other", rate_2_coat: 6 }),
  ],
  products: [] as unknown as Product[],
  modifiers: [],
  settings: [
    { key: "Materials markup", value: { value: 0.1 } },
    { key: "GST", value: { value: 0.1 } },
  ],
};
const adj: Adjustments = { modSel: {}, materials: {} };
resolveRates(ctx, adj);

const rule = (surface_type: string, tile_group: string, sort_order: number, countable: boolean): TileRule =>
  ({ room_type: "bedroom", surface_type, is_option: false, requires_confirm: false, countable, tile_group, sort_order, notes: null });

const tiles = expandCaptureTiles(tilesForRoomType("bedroom", [
  rule("Walls", "core", 10, false),
  rule("Ceiling", "core", 20, false),
  rule("Door & Frame", "openings", 50, true),
]));

/** A wizard-shaped node: ai_assumed provenance, no capture metadata, one
 * line ("Staircase Custom") no bedroom tile can produce. */
function wizardBlock() {
  const surface = (id: number, code: string, over: Record<string, unknown> = {}) => ({
    id, code, internalLabel: code, clientLabel: code, coats: 2, count: 1,
    hidden: false, media: [], measureL: null, measureH: null,
    qtyOverride: null, rateOverride: null, paintingHrOverride: null,
    prepHr: 0, priceOverride: null, productName: null, color: "", colorHex: "",
    coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
    crewNote: "", hideQty: false, showCoats: false, showPrice: false,
    useCustomRate: false, customRate: null, open: false,
    origin: "ai_assumed", confidence: 0.5, assumedFields: ["L", "W"],
    ...over,
  });
  return {
    id: 7, kind: "area", name: "Bed 1", type: "Interior", areaType: "room",
    roomType: "bedroom", storey: "ground", L: 3.5, W: 3.25, H: 2.4,
    isOption: false, description: "", open: false, media: [],
    origin: "ai_assumed", confidence: 0.5, assumedFields: ["L", "W"],
    extractionSourceId: "src-123",
    surfaces: [
      surface(8, "Walls", { productName: "Dulux Wash&Wear", color: "Natural White", rateOverride: 9 }),
      surface(9, "Ceilings"),
      surface(10, "Flat Door and Frame (1 Side)", { count: 2, paintingHrOverride: 2.5 }),
      surface(11, "Staircase Custom", { useCustomRate: true, customRate: 6 }),
    ],
  };
}

function captureDraftFor(block: ReturnType<typeof wizardBlock>) {
  const d = emptyDraft("local-1", block.name, block.roomType, block.storey, block.H);
  d.areaId = block.id;
  d.lengthM = block.L;
  d.widthM = block.W;
  // The lossy rebuild's selections, as CaptureApp derives them from surfaces.
  d.selections = { "bedroom:Walls": 4, "bedroom:Ceiling": 1, "bedroom:Door & Frame:flat": 2 };
  return d;
}

describe("mergeRecommittedNode (A5)", () => {
  it("keeps builder-only detail, unmappable lines and provenance on an untouched recommit", () => {
    const block = wizardBlock();
    let next = 100;
    const node = draftToAreaNode(captureDraftFor(block), tiles, () => next++, {});
    mergeRecommittedNode(block, node, tiles);

    const walls = node.surfaces.find((s) => s.code === "Walls")!;
    expect(walls.productName).toBe("Dulux Wash&Wear");
    expect(walls.color).toBe("Natural White");
    expect(walls.rateOverride).toBe(9);

    // Untouched door count → its absolute hour override survives.
    const door = node.surfaces.find((s) => s.code === "Flat Door and Frame (1 Side)")!;
    expect(door.count).toBe(2);
    expect(door.paintingHrOverride).toBe(2.5);

    // The line no tile can express is preserved verbatim.
    const stairs = node.surfaces.find((s) => s.code === "Staircase Custom")!;
    expect(stairs).toBeTruthy();
    expect((stairs as unknown as { customRate: number }).customRate).toBe(6);

    // Provenance the node type doesn't model rides along.
    expect((node as unknown as { extractionSourceId: string }).extractionSourceId).toBe("src-123");
  });

  it("drops the absolute overrides when capture re-measured the surface", () => {
    const block = wizardBlock();
    const d = captureDraftFor(block);
    d.selections["bedroom:Door & Frame:flat"] = 3; // the edit: one more door
    let next = 100;
    const node = draftToAreaNode(d, tiles, () => next++, {});
    mergeRecommittedNode(block, node, tiles);

    const door = node.surfaces.find((s) => s.code === "Flat Door and Frame (1 Side)")!;
    expect(door.count).toBe(3);
    expect(door.paintingHrOverride).toBeNull(); // re-measured → reprice honestly
  });

  it("parity: an untouched wizard room prices the same after a capture round-trip", () => {
    const block = wizardBlock();
    // Builder-side price of the wizard node as it stands (minus the door
    // hour-override surface, which capture round-trips exactly anyway).
    const before = priceArea(block as unknown as AreaInput, ctx, adj);

    let next = 100;
    const node = draftToAreaNode(captureDraftFor(block), tiles, () => next++, {});
    mergeRecommittedNode(block, node, tiles);
    const after = priceArea(node as unknown as AreaInput, ctx, adj);

    expect(after).toBe(before);
  });

  it("a deselected tile'd surface is removed — that IS the edit", () => {
    const block = wizardBlock();
    const d = captureDraftFor(block);
    delete d.selections["bedroom:Ceiling"];
    let next = 100;
    const node = draftToAreaNode(d, tiles, () => next++, {});
    mergeRecommittedNode(block, node, tiles);
    expect(node.surfaces.some((s) => s.code === "Ceilings")).toBe(false);
    expect(node.surfaces.some((s) => s.code === "Staircase Custom")).toBe(true);
  });
});

describe("storeyHeightsFromBlocks (A5)", () => {
  it("derives one height per storey from interior nodes", () => {
    const blocks = [
      { kind: "area", type: "Interior", storey: "ground", H: 2.7 },
      { kind: "area", type: "Interior", storey: "first", H: 2.4 },
      { kind: "area", type: "Exterior", storey: "ground", H: 6 }, // ignored
    ];
    expect(storeyHeightsFromBlocks(blocks)).toEqual({ ground: 2.7, first: 2.4 });
  });

  it("falls back to the default map when nothing derives", () => {
    expect(storeyHeightsFromBlocks([])).toEqual(DEFAULT_STOREY_HEIGHTS);
  });
});
