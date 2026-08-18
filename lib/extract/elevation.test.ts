import { describe, expect, it } from "vitest";
import { elevationReadSchema, mergeSitePlanWidths, sitePlanReadSchema, type SitePlanRead } from "./elevation";
import { computeEnvelope, type ElevationRead } from "./exterior";

const seg = (over: Partial<ElevationRead["cladding"][number]> = {}): ElevationRead["cladding"][number] => ({
  material: "weatherboard",
  widthM: null,
  widthBasis: "none",
  heightM: 2.4,
  heightBasis: "board_count",
  confidence: 0.8,
  ...over,
});

const read = (elevation: ElevationRead["elevation"], cladding: ElevationRead["cladding"]): ElevationRead => ({
  elevation, cladding, trims: [], confidence: 0.8,
});

const sitePlan = (over: Partial<SitePlanRead> = {}): SitePlanRead => ({
  kind: "site_plan_read",
  edges: [
    { side: "front", lengthM: 9.5, basis: "printed_dimension", confidence: 0.9, reasoning: "printed 9500" },
    { side: "left", lengthM: 14, basis: "scale_bar", confidence: 0.7, reasoning: "scale bar" },
    { side: "rear", lengthM: null, basis: "none", confidence: 0.2, reasoning: "not dimensioned" },
  ],
  perimeterM: null,
  storeys: 1,
  confidence: 0.7,
  notes: "",
  ...over,
});

describe("mergeSitePlanWidths", () => {
  it("fills unmeasured widths from the matching side's edge", () => {
    const merged = mergeSitePlanWidths([read("front", [seg()])], sitePlan());
    expect(merged[0].cladding[0].widthM).toBe(9.5);
    expect(merged[0].cladding[0].widthBasis).toBe("site_plan_edge");
  });

  it("never overwrites a photo's own referenced width — the closer source wins", () => {
    const merged = mergeSitePlanWidths(
      [read("front", [seg({ widthM: 8.2, widthBasis: "reference_in_photo" })])],
      sitePlan(),
    );
    expect(merged[0].cladding[0].widthM).toBe(8.2);
    expect(merged[0].cladding[0].widthBasis).toBe("reference_in_photo");
  });

  it("edges without a real basis or confidence contribute nothing", () => {
    const merged = mergeSitePlanWidths([read("rear", [seg()])], sitePlan());
    expect(merged[0].cladding[0].widthM).toBeNull();

    const lowConf = sitePlan({
      edges: [{ side: "front", lengthM: 9.5, basis: "printed_dimension", confidence: 0.3, reasoning: "smudged" }],
    });
    expect(mergeSitePlanWidths([read("front", [seg()])], lowConf)[0].cladding[0].widthM).toBeNull();
  });

  it("a null site plan passes reads through untouched", () => {
    const reads = [read("front", [seg()])];
    expect(mergeSitePlanWidths(reads, null)).toEqual(reads);
  });

  it("merged widths flow through computeEnvelope into priced m²", () => {
    const merged = mergeSitePlanWidths([
      read("front", [seg()]),
      read("left", [seg()]),
      read("right", [seg({ widthM: 14, widthBasis: "reference_in_photo" })]),
    ], sitePlan());
    const env = computeEnvelope(merged);
    const front = env.elevations.find((e) => e.name === "front");
    expect(front?.surfaces[0]?.m2).toBe(22.8); // 9.5 × 2.4
    // three measured elevations — no whole-house site-check flag for count
    expect(env.requiresSiteCheck.some((s) => /only \d elevation/.test(s))).toBe(false);
  });

  it("rule 2: room_sum edges fill widths and the elevation is flagged width-from-plan", () => {
    const footprint = sitePlan({
      edges: [{ side: "front", lengthM: 9.2, basis: "room_sum", confidence: 0.75, reasoning: "living 4.0 + bed 3.2 + bath 1.5 (standard) + walls" }],
    });
    const merged = mergeSitePlanWidths([read("front", [seg()])], footprint);
    expect(merged[0].cladding[0].widthBasis).toBe("site_plan_edge");
    const env = computeEnvelope(merged);
    const front = env.elevations.find((e) => e.name === "front");
    expect(front?.widthFromPlan).toBe(true);
    expect(front?.surfaces[0]?.m2).toBeCloseTo(22.1, 1); // 9.2 × 2.4
    // A photo-referenced width does NOT flag.
    const photoOnly = computeEnvelope([read("rear", [seg({ widthM: 8, widthBasis: "reference_in_photo" })])]);
    expect(photoOnly.elevations.find((e) => e.name === "rear")?.widthFromPlan).toBe(false);
  });
});

describe("schemas", () => {
  it("accepts a real elevation reading and slices long reasoning", () => {
    const r = elevationReadSchema.safeParse({
      kind: "elevation_read",
      elevation: "front",
      cladding: [{
        material: "brick", widthM: null, widthBasis: "none", heightM: 2.06,
        heightBasis: "brick_course", confidence: 0.85, reasoning: "x".repeat(400),
      }],
      trims: [{ kind: "gutter", linealM: 9.5, confidence: 0.8 }],
      confidence: 0.8,
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cladding[0].reasoning).toHaveLength(200);
  });

  it("rejects a proportion-flavoured basis the schema does not know", () => {
    const r = sitePlanReadSchema.safeParse({
      kind: "site_plan_read",
      edges: [{ side: "front", lengthM: 9, basis: "looks_about_right", confidence: 0.9, reasoning: "" }],
      perimeterM: null, storeys: null, confidence: 0.5, notes: "",
    });
    expect(r.success).toBe(false);
  });
});
