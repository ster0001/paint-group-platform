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
  { room_type: "bedroom", surface_type: "Cornices", is_option: false, requires_confirm: false, notes: "never standard" },
  // Tom's rule: wet areas are ceiling and door only.
  { room_type: "bathroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bathroom", surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bathroom", surface_type: "Cornices", is_option: false, requires_confirm: false, notes: "never standard" },
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
  cornice: "unknown" as const,
  doors: [{ type: "internal_hinged" as const, style: "unknown" as const, style_confidence: 0.1, width_m: 0.82, confidence: 0.9 }],
  windows: [{ size_class: "medium" as const, style: "unknown" as const, style_confidence: 0.1, confidence: 0.8 }],
  openings_no_door: 0, wet_area: false, notes_read_from_plan: "", ...over,
});
const flatDoor = { type: "internal_hinged" as const, style: "flat" as const, style_confidence: 0.9, width_m: 0.82, confidence: 0.9 };
const awningWindow = { size_class: "medium" as const, style: "awning_casement" as const, style_confidence: 0.9, confidence: 0.9 };

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

test("a door of UNKNOWN style is not priced — it becomes a question", () => {
  const { surfaces, deferred } = planSurfaces("bedroom", {
    doors: [{ style: "unknown" }, { style: "unknown" }],
    windows: [], openings: 0, cornice: "unknown",
  }, RULES);
  expect(surfaces.map((s) => s.surfaceType)).not.toContain("Flat door & frame");
  expect(deferred.find((d) => d.what.includes("door"))?.count).toBe(2);
  expect(deferred.find((d) => d.what.includes("door"))?.needs).toMatch(/flat or panel/i);
});

test("once a photo gives the style, the right rate code is used", () => {
  const { surfaces } = planSurfaces("bedroom", {
    doors: [{ style: "flat" }, { style: "panel" }],
    windows: [{ style: "awning_casement" }], openings: 0, cornice: "unknown",
  }, RULES);
  const codes = surfaces.map((s) => s.rateCode);
  expect(codes).toContain("Flat Door and Frame (1 Side)");
  expect(codes).toContain("4-6 Panel Door and Frame (1 Side)");
  expect(codes).toContain("Awning / Casement Window");
});

test("mixed door styles in one room become separate lines with their own counts", () => {
  const { surfaces } = planSurfaces("bedroom", {
    doors: [{ style: "flat" }, { style: "flat" }, { style: "panel" }],
    windows: [], openings: 0, cornice: "unknown",
  }, RULES);
  expect(surfaces.find((s) => s.rateCode === "Flat Door and Frame (1 Side)")!.count).toBe(2);
  expect(surfaces.find((s) => s.rateCode === "4-6 Panel Door and Frame (1 Side)")!.count).toBe(1);
});

test("CORNICES ARE NEVER STANDARD — only a photo adds one", () => {
  const unknown = planSurfaces("bedroom", { doors: [], windows: [], openings: 0, cornice: "unknown" }, RULES);
  expect(unknown.surfaces.map((s) => s.surfaceType)).not.toContain("Cornices");
  expect(unknown.deferred.some((d) => d.what === "cornice")).toBe(true);

  const absent = planSurfaces("bedroom", { doors: [], windows: [], openings: 0, cornice: "absent" }, RULES);
  expect(absent.surfaces.map((s) => s.surfaceType)).not.toContain("Cornices");
  expect(absent.deferred.some((d) => d.what === "cornice")).toBe(false); // settled: there isn't one

  const present = planSurfaces("bedroom", { doors: [], windows: [], openings: 0, cornice: "present" }, RULES);
  expect(present.surfaces.find((s) => s.surfaceType === "Cornices")?.rateCode).toBe("Standard Cornices");
});

test("BATHROOMS GET CEILING AND DOOR ONLY — no walls, no skirting", () => {
  const { surfaces } = planSurfaces("bathroom", {
    doors: [{ style: "flat" }], windows: [], openings: 0, cornice: "unknown",
  }, RULES);
  const types = surfaces.map((s) => s.surfaceType);
  expect(types).toContain("Ceiling");
  expect(types).toContain("Flat door & frame");
  expect(types).not.toContain("Walls");
  expect(types).not.toContain("Skirting Boards");
});

test("an unknown room type generates nothing at all", () => {
  const { surfaces } = planSurfaces("unknown", {
    doors: [{ style: "flat" }], windows: [{ style: "awning_casement" }], openings: 1, cornice: "present",
  }, RULES);
  expect(surfaces).toEqual([]);
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
  const { areas } = buildDraft(extraction([room({ doors: [flatDoor], windows: [awningWindow] })]), RULES, ALIASES);
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

test("provenance is on every node", () => {
  const { areas } = buildDraft(extraction([room()]), RULES, ALIASES);
  const walls = areas[0].surfaces.find((s) => s.internalLabel === "Walls")!;
  expect(walls.origin).toBe("ai_derived");
  expect(walls.confidence).toBeGreaterThan(0);
});

test("what was seen but not priced is reported as a decision, not lost", () => {
  const { deferred } = buildDraft(extraction([room()]), RULES, ALIASES);
  expect(deferred.some((d) => d.room === "Bedroom 1" && d.what.includes("door"))).toBe(true);
  expect(deferred.some((d) => d.what === "cornice")).toBe(true);
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
