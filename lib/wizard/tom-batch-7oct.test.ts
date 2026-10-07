import { describe, expect, it } from "vitest";
import { buildDraft, PLAN_NEVER_PAINTED } from "@/lib/extract/draft";
import type { Extraction } from "@/lib/extract/schema";
import type { ScopeRule } from "@/lib/extract/scope";
import { FALLBACK_TYPICALS, typicalSize } from "./starter";
import { applyCupboardDefaults, applyRoomDims, roomLoopViews, type LooseBlock } from "./rooms-loop";

/**
 * Tom, 7 Oct 2026 — the estimator wizard batch:
 *  2. off a plan, a carport, a sauna or anything written store / storage never comes in;
 *  4 + 6. cupboards start answered — kitchen / vanity / laundry No, robe doors Yes;
 *  5. a walk-in robe sizes at 2 × 1.25 m;
 *  8. a room can take its own ceiling height, and the job-wide chip leaves it alone.
 */

const RULES: ScopeRule[] = [
  { room_type: "storage", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "garage", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bathroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
];
const room = (name: string, type: Extraction["rooms"][0]["normalised_type"]): Extraction["rooms"][0] => ({
  name_on_plan: name, normalised_type: type, storey: "Ground",
  length_m: 3, width_m: 2.5, dimension_source: "read", dimension_confidence: 0.9,
  area_m2_printed: null, irregular: false, cornice: "unknown",
  doors: [], windows: [], openings_no_door: 0, wet_area: false, notes_read_from_plan: "",
});
const extraction = (rooms: Extraction["rooms"]): Extraction => ({
  storeys: [{ label: "Ground", kind: "ground" }], ceiling_height_m: null, rooms,
} as unknown as Extraction);

describe("2 · plan rooms that are never painted", () => {
  const rooms = [room("Carport", "garage"), room("Sauna", "bathroom"), room("Store", "storage"), room("Storage", "storage"), room("Storeroom", "storage"), room("WIR", "storage"), room("Bed 1", "bedroom")];

  it("off a PLAN they are skipped by the printed name, whatever the model classified them as", () => {
    const d = buildDraft(extraction(rooms), RULES, [], { planRead: true });
    expect(d.areas.map((a) => a.name)).toEqual(["WIR", "Bed 1"]);
    expect(d.skipped.map((s) => s.name)).toEqual(["Carport", "Sauna", "Store", "Storage", "Storeroom"]);
    expect(d.skipped[0].reason).toMatch(/not painted/);
  });

  it("a room the customer named themselves is theirs — the rule is off without planRead", () => {
    const d = buildDraft(extraction([room("Storage", "storage")]), RULES, []);
    expect(d.areas.map((a) => a.name)).toEqual(["Storage"]);
  });

  it("the pattern matches the words, not fragments of other rooms", () => {
    for (const n of ["Carport", "Double carport", "Sauna", "Store", "STORAGE", "Store 2", "Storeroom", "Stores"]) expect(PLAN_NEVER_PAINTED.test(n), n).toBe(true);
    for (const n of ["Restored dining", "Living", "WIR", "Walk in robe", "Pantry", "Bedroom"]) expect(PLAN_NEVER_PAINTED.test(n), n).toBe(false);
  });
});

describe("5 · a walk-in robe is 2 × 1.25 m", () => {
  it("storage-type rooms size from the new typical, Settings row or fallback", () => {
    expect(FALLBACK_TYPICALS.storage).toEqual({ L: 2.0, W: 1.25 });
    expect(typicalSize("storage", [])).toEqual({ L: 2.0, W: 1.25 });
    expect(typicalSize("storage", [{ room_type: "storage", typical_length_m: 2.2, typical_width_m: 1.4 }])).toEqual({ L: 2.2, W: 1.4 });
  });
});

const kitchen = (): LooseBlock => ({ id: 1, kind: "area", type: "Interior", roomType: "kitchen", name: "Kitchen", L: 4, W: 3, H: 2.4, surfaces: [] });
const bath = (): LooseBlock => ({ id: 2, kind: "area", type: "Interior", roomType: "bathroom", name: "Bathroom", L: 2, W: 1.5, H: 2.4, surfaces: [] });
const bed = (): LooseBlock => ({ id: 3, kind: "area", type: "Interior", roomType: "bedroom", name: "Bed 1", L: 3.5, W: 3.25, H: 2.4, surfaces: [] });
const ALL = new Set(["Kitchen Cupboard Front", "Robe Door", "Vanity Door"]);

describe("4 + 6 · cupboards start answered", () => {
  it("kitchen and vanity No, robe doors Yes with the standard count — tagged as an assumption", () => {
    let id = 10;
    const out = applyCupboardDefaults([kitchen(), bath(), bed()], ALL, () => id++);
    const views = roomLoopViews(out, ALL);
    expect(views.map((v) => v.cupboard?.on)).toEqual([false, false, true]);
    expect(views[2].cupboard?.count).toBe(2);
    const robe = out[2].surfaces?.find((s) => s.code === "Robe Door");
    expect(robe).toMatchObject({ count: 2, origin: "ai_assumed", assumedFields: ["included"] });
    expect(out[0].surfaces).toEqual([]);
  });

  it("an answer already given is left alone, and a card without the code asks nothing", () => {
    let id = 10;
    const answered: LooseBlock = { ...bed(), customer: { size: null, cup: false, confirmed: false } };
    const out = applyCupboardDefaults([answered, kitchen()], new Set(["Robe Door"]), () => id++);
    expect(out[0].customer?.cup).toBe(false);
    expect(out[0].surfaces).toEqual([]);
    expect(out[1].customer?.cup ?? null).toBeNull(); // no Kitchen Cupboard Front on this card
  });
});

describe("8 · a room's own ceiling height", () => {
  it("room_dims with a height sets H on that room only, clears the H assumption, and marks it adjusted", () => {
    const blocks = [{ ...bed(), assumedFields: ["L", "W", "H"] }, kitchen()];
    const r = applyRoomDims(blocks, 3, 4, 3.5, 2.7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.blocks.find((x) => x.id === 3)!;
    expect(b.H).toBe(2.7);
    expect(b.assumedFields).toEqual([]);
    expect(b.customer).toMatchObject({ size: "adjusted", heightAdjusted: true });
    expect(r.blocks.find((x) => x.id === 1)!.H).toBe(2.4);
    const view = roomLoopViews(r.blocks, ALL).find((v) => v.areaId === 3)!;
    expect(view.heightM).toBe(2.7);
    expect(view.heightAdjusted).toBe(true);
  });

  it("without a height the size adjust leaves H and the H assumption as they were; heights clamp to 2–6 m", () => {
    const r = applyRoomDims([{ ...bed(), assumedFields: ["H"] }], 3, 4, 3.5);
    expect(r.ok && r.blocks[0].H).toBe(2.4);
    expect(r.ok && r.blocks[0].assumedFields).toEqual(["H"]);
    expect(r.ok && r.blocks[0].customer?.heightAdjusted).toBeUndefined();
    const hi = applyRoomDims([bed()], 3, 4, 3.5, 9);
    expect(hi.ok && hi.blocks[0].H).toBe(6);
  });
});
