import { test, expect } from "vitest";
import { buildDraft, reviewQueue, ASSUMED_CEILING_HEIGHT } from "./draft.ts";
import { resolveRoomType, planSurfaces, type ScopeRule, type Alias } from "./scope.ts";
import { validateExtraction } from "./validate.ts";
import { extractionSchema, type Extraction } from "./schema.ts";

// A trimmed copy of what the seed script loads, so these tests describe the
// same rules the live system runs on.
const RULES: ScopeRule[] = [
  { room_type: "bedroom", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Skirting Boards", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Windows", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Cornices", is_option: false, requires_confirm: true, notes: "not universal" },
  { room_type: "bathroom", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bathroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bathroom", surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
  { room_type: "kitchen", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "kitchen", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
];
const ALIASES: Alias[] = [
  { alias: "bedroom", room_type: "bedroom" }, { alias: "main bedroom", room_type: "bedroom" },
  { alias: "bath", room_type: "bathroom" }, { alias: "kitchen", room_type: "kitchen" },
  { alias: "dining kitchen", room_type: "dining" }, { alias: "robe", room_type: "storage" },
  { alias: "walk in robe", room_type: "storage" }, { alias: "alfresco", room_type: "exterior_excluded" },
];

const room = (over: Partial<Extraction["rooms"][0]> = {}) => ({
  name_on_plan: "Bedroom 1", normalised_type: "bedroom" as const, storey: "Ground",
  length_m: 4.1, width_m: 3.7, dimension_source: "read" as const, dimension_confidence: 0.9,
  area_m2_printed: null, irregular: false,
  doors: [{ type: "internal_hinged" as const, width_m: 0.82, confidence: 0.9 }],
  windows: [{ size_class: "medium" as const, confidence: 0.8 }],
  openings_no_door: 0, wet_area: false, notes_read_from_plan: "", ...over,
});

const extraction = (rooms: Extraction["rooms"], over: Partial<Extraction> = {}): Extraction =>
  extractionSchema.parse({
    storeys: [{ label: "Ground", kind: "ground", stated_area_m2: null }],
    scale: { method: "labelled_dimensions", stated_total_area_m2: null, not_to_scale_disclaimer: false, confidence: 0.9 },
    ceiling_height_m: null, rooms, has_site_plan: false, unreadable_regions: [], ...over,
  });

// ---- room naming ------------------------------------------------------------

test("real room names off real plans resolve to types", () => {
  expect(resolveRoomType("Bedroom 3", ALIASES)).toBe("bedroom");
  expect(resolveRoomType("MAIN BEDROOM", ALIASES)).toBe("bedroom");
  expect(resolveRoomType("Bath", ALIASES)).toBe("bathroom");
  expect(resolveRoomType("Alfresco", ALIASES)).toBe("exterior_excluded");
});

test("the longest matching alias wins, so compound names are not miscounted", () => {
  // "Dining Kitchen" is a dining room, not a kitchen — it appears in the real
  // PaintScout data and the naive substring match gets it wrong.
  expect(resolveRoomType("Dining Kitchen", ALIASES)).toBe("dining");
  expect(resolveRoomType("Walk in Robe", ALIASES)).toBe("storage");
});

test("an unrecognised name is 'unknown', never a guess", () => {
  expect(resolveRoomType("Upper board Room", ALIASES)).toBe("unknown");
  expect(resolveRoomType(null, ALIASES)).toBe("unknown");
});

// ---- scope ------------------------------------------------------------------

test("a bedroom generates the surfaces the real jobs show", () => {
  const planned = planSurfaces("bedroom", { doors: 1, windows: 2, openings: 0 }, RULES);
  expect(planned.map((p) => p.surfaceType).sort()).toEqual(
    ["Ceiling", "Cornices", "Door & Frame", "Skirting Boards", "Walls", "Windows"],
  );
  expect(planned.find((p) => p.surfaceType === "Windows")!.count).toBe(2);
});

test("no door drawn means no door line — a per-item rate is real money", () => {
  const planned = planSurfaces("bedroom", { doors: 0, windows: 0, openings: 0 }, RULES);
  expect(planned.map((p) => p.surfaceType)).not.toContain("Door & Frame");
  expect(planned.map((p) => p.surfaceType)).not.toContain("Windows");
  expect(planned.map((p) => p.surfaceType)).toContain("Walls");
});

test("bathrooms and kitchens get no skirting, per the 11 real jobs", () => {
  for (const type of ["bathroom", "kitchen"]) {
    const planned = planSurfaces(type, { doors: 1, windows: 0, openings: 0 }, RULES);
    expect(planned.map((p) => p.surfaceType)).not.toContain("Skirting Boards");
  }
});

test("an unknown room type generates nothing at all", () => {
  expect(planSurfaces("unknown", { doors: 2, windows: 2, openings: 1 }, RULES)).toEqual([]);
});

// ---- the draft tree ---------------------------------------------------------

test("a read room becomes an area the builder can price as-is", () => {
  const { areas } = buildDraft(extraction([room()]), RULES, ALIASES);
  expect(areas).toHaveLength(1);
  const a = areas[0];
  expect(a.kind).toBe("area");
  expect(a.areaType).toBe("room");
  expect(a.type).toBe("Interior");
  expect(a.L).toBe(4.1);
  expect(a.W).toBe(3.7);
  expect(a.H).toBe(ASSUMED_CEILING_HEIGHT);
  // Quantities are NOT set here: the pricing engine derives them from L/W/H.
  for (const s of a.surfaces) {
    expect(s.qtyOverride).toBeNull();
    expect(s.measureL).toBeNull();
    expect(s.priceOverride).toBeNull();
  }
});

test("surfaces carry real rate-card codes, or are not generated", () => {
  const { areas } = buildDraft(extraction([room()]), RULES, ALIASES);
  const codes = areas[0].surfaces.map((s) => s.code);
  expect(codes).toContain("Walls");
  expect(codes).toContain("Ceilings");
  expect(codes).toContain("Skirting Boards");
  expect(codes.every((c) => c.length > 0)).toBe(true);
});

test("an undimensioned wet area is generated at zero, not at an invented size", () => {
  const { areas } = buildDraft(
    extraction([room({ name_on_plan: "Bath", normalised_type: "bathroom", length_m: null, width_m: null, dimension_source: "not_dimensioned", dimension_confidence: 0.2 })]),
    RULES, ALIASES,
  );
  const a = areas[0];
  expect(a.L).toBe(0);
  expect(a.W).toBe(0);
  expect(a.origin).toBe("ai_assumed");
  expect(a.assumedFields).toContain("L");
  // It still exists — priced at nothing and impossible to miss in review.
  expect(a.surfaces.length).toBeGreaterThan(0);
});

test("provenance is on every node, and a confirmed cornice is flagged", () => {
  const { areas } = buildDraft(extraction([room()]), RULES, ALIASES);
  const cornice = areas[0].surfaces.find((s) => s.internalLabel === "Cornices")!;
  expect(cornice.origin).toBe("ai_assumed");
  expect(cornice.assumedFields).toContain("included");
  const walls = areas[0].surfaces.find((s) => s.internalLabel === "Walls")!;
  expect(walls.origin).toBe("ai_derived");
});

test("skipped rooms are reported, never dropped", () => {
  const { areas, skipped } = buildDraft(
    extraction([
      room({ name_on_plan: "Alfresco", normalised_type: "unknown" }),
      room({ name_on_plan: "Upper board Room", normalised_type: "unknown" }),
    ]),
    RULES, ALIASES,
  );
  expect(areas).toHaveLength(0);
  expect(skipped).toHaveLength(2);
  expect(skipped.map((s) => s.name)).toContain("Upper board Room");
  expect(skipped[1].reason).toMatch(/classify/);
});

test("ids are unique across areas and their surfaces", () => {
  const { areas } = buildDraft(extraction([room(), room({ name_on_plan: "Bedroom 2" })]), RULES, ALIASES);
  const ids = areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)]);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the review queue leads with rooms that have no size", () => {
  const { areas } = buildDraft(
    extraction([room({ name_on_plan: "Bath", normalised_type: "bathroom", length_m: null, width_m: null, dimension_source: "not_dimensioned", dimension_confidence: 0.2 })]),
    RULES, ALIASES,
  );
  const q = reviewQueue(areas);
  expect(q[0].needs).toMatch(/size/);
});

// ---- validation -------------------------------------------------------------

test("a plan with nothing to measure from is refused, not guessed at", () => {
  const r = validateExtraction(extraction(
    [room({ length_m: null, width_m: null, dimension_source: "not_dimensioned" })],
    { scale: { method: "none", stated_total_area_m2: null, not_to_scale_disclaimer: false, confidence: 0.3 } },
  ));
  expect(r.usable).toBe(false);
  expect(r.flags.some((f) => f.code === "no_scale" && f.blocking)).toBe(true);
});

test('"not to scale" is surfaced, because it forbids measuring off the drawing', () => {
  const r = validateExtraction(extraction([room()], {
    scale: { method: "labelled_dimensions", stated_total_area_m2: null, not_to_scale_disclaimer: true, confidence: 0.9 },
  }));
  expect(r.flags.some((f) => f.code === "not_to_scale")).toBe(true);
  expect(r.usable).toBe(true); // the printed dimensions are still good
});

test("an implausible room size is flagged rather than priced", () => {
  const r = validateExtraction(extraction([room({ length_m: 41, width_m: 37 })]));
  expect(r.flags.some((f) => f.code === "implausible_size" && f.blocking)).toBe(true);
});

test("rooms that add up wrong against a stated area are caught", () => {
  const r = validateExtraction(extraction([room({ length_m: 4, width_m: 3 })], {
    scale: { method: "stated_total_area", stated_total_area_m2: 142, not_to_scale_disclaimer: false, confidence: 0.9 },
  }));
  expect(r.flags.some((f) => f.code === "area_reconciliation")).toBe(true);
  expect(r.areaDeltaPct).toBeLessThan(-50);
});

test("undimensioned rooms are counted and named", () => {
  const r = validateExtraction(extraction([
    room(),
    room({ name_on_plan: "Bath", length_m: null, width_m: null, dimension_source: "not_dimensioned" }),
  ]));
  expect(r.undimensionedRooms).toBe(1);
  expect(r.dimensionedRooms).toBe(1);
  expect(r.flags.find((f) => f.code === "undimensioned_rooms")?.message).toMatch(/Bath/);
});

test("an assumed ceiling height is always said out loud", () => {
  const r = validateExtraction(extraction([room()]));
  expect(r.flags.some((f) => f.code === "assumed_ceiling_height")).toBe(true);
});
