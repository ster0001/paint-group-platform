import { test, expect } from "vitest";
import {
  classifySurfaceType,
  linkSupersedence,
  melbourneDate,
  reconstructRows,
  sheenFromProduct,
  type ReconstructInput,
} from "./reconstruct";

const base = (over: Partial<ReconstructInput>): ReconstructInput => ({
  areas: [],
  materials: [],
  liveColours: null,
  doneTicks: [],
  signedOn: null,
  ...over,
});

test("classifySurfaceType: most-specific keyword wins, unknown labels keep themselves", () => {
  expect(classifySurfaceType("Walls")).toBe("wall");
  expect(classifySurfaceType("Ceiling")).toBe("ceiling");
  expect(classifySurfaceType("Skirting & architraves")).toBe("trim");
  expect(classifySurfaceType("Front door (exterior face)")).toBe("door");
  expect(classifySurfaceType("Window sills")).toBe("window");
  expect(classifySurfaceType("Fascia & bargeboards")).toBe("fascia");
  expect(classifySurfaceType("Letterbox")).toBe("letterbox");
});

test("sheenFromProduct mirrors the display rule, lowercased", () => {
  expect(sheenFromProduct("Wash & Wear Low Sheen")).toBe("low sheen");
  expect(sheenFromProduct("Aquanamel Semi Gloss")).toBe("semi gloss");
  expect(sheenFromProduct("Weathershield")).toBe("");
});

test("melbourneDate buckets by Melbourne calendar day, not UTC", () => {
  // 2026-08-29 22:30 UTC = 08:30 on the 30th in Melbourne (AEST +10).
  expect(melbourneDate("2026-08-29T22:30:00Z")).toBe("2026-08-30");
  expect(melbourneDate("2026-08-30T10:00:00Z")).toBe("2026-08-30");
});

test("TBC never becomes a row: no colour name anywhere → nothing", () => {
  const rows = reconstructRows(base({
    areas: [{ title: "Bedroom 1", surfaces: [{ label: "Walls", product: "Wash & Wear", coats: 2 }] }],
    materials: [{ product: "Wash & Wear", colourName: "", colourHex: "" }],
  }));
  expect(rows).toEqual([]);
});

test("job-sheet colour (work_orders.colours name) wins over the frozen estimate name", () => {
  const rows = reconstructRows(base({
    areas: [{ title: "Hallway", surfaces: [{ label: "Walls", product: "Wash & Wear", coats: 2 }] }],
    materials: [{ product: "Wash & Wear", colourName: "Natural White", colourHex: "#F1EDE4" }],
    liveColours: { "Wash & Wear": { name: "Lexicon Quarter", hex: "#F4F2EC", status: "confirmed" } },
  }));
  expect(rows).toHaveLength(1);
  expect(rows[0].colour_name).toBe("Lexicon Quarter");
  expect(rows[0].swatch_hex).toBe("#f4f2ec");
});

test("groups by area × surface type; coats keep the max; match code and brand carried", () => {
  const rows = reconstructRows(base({
    areas: [{
      title: "Front elevation",
      surfaces: [
        { label: "Weatherboard walls", product: "Weathershield", coats: 2 },
        { label: "Render walls", product: "Weathershield", coats: 3 },
        { label: "Fascia & bargeboards", product: "Aquanamel Semi Gloss", coats: 2 },
      ],
    }],
    materials: [
      { product: "Weathershield", colourName: "Domino", colourHex: "#2A2E33", colourMatch: { code: "SN4 G8", brand: "Dulux" } },
      { product: "Aquanamel Semi Gloss", colourName: "Vivid White", colourHex: "#FFFFFF" },
    ],
  }));
  expect(rows).toHaveLength(2);
  const walls = rows.find((r) => r.surface_type === "wall")!;
  expect(walls.coats).toBe(3);
  expect(walls.colour_code).toBe("SN4 G8");
  expect(walls.brand).toBe("Dulux");
  const fascia = rows.find((r) => r.surface_type === "fascia")!;
  expect(fascia.sheen).toBe("semi gloss");
});

test("applied dates: per-surface tick beats area tick beats sign-off fallback", () => {
  const rows = reconstructRows(base({
    areas: [
      { title: "Bedroom 1", surfaces: [{ label: "Walls", product: "P", coats: 2 }] },
      { title: "Bedroom 2", surfaces: [{ label: "Walls", product: "P", coats: 2 }] },
      { title: "Study", surfaces: [{ label: "Walls", product: "P", coats: 2 }] },
    ],
    materials: [{ product: "P", colourName: "Natural White", colourHex: "#F1EDE4" }],
    doneTicks: [
      { heading: "Bedroom 1", label: "Walls", state: "done", stateChangedAt: "2026-08-27T03:00:00Z" },
      { heading: "Bedroom 1", label: "Walls", state: "done", stateChangedAt: "2026-08-28T03:00:00Z" },
      { heading: "Bedroom 2", label: "Ceiling", state: "done", stateChangedAt: "2026-08-29T03:00:00Z" },
    ],
    signedOn: "2026-08-31",
  }));
  const bed1 = rows.find((r) => r.area_label === "Bedroom 1")!;
  expect(bed1.applied_from).toBe("2026-08-27");
  expect(bed1.applied_to).toBe("2026-08-28");
  // Bedroom 2 walls have no walls tick — the area-level tick date applies.
  expect(rows.find((r) => r.area_label === "Bedroom 2")!.applied_from).toBe("2026-08-29");
  // Study has no ticks at all — sign-off day stands in.
  expect(rows.find((r) => r.area_label === "Study")!.applied_from).toBe("2026-08-31");
});

test("a prepped-but-not-done tick contributes no date", () => {
  const rows = reconstructRows(base({
    areas: [{ title: "Kitchen", surfaces: [{ label: "Walls", product: "P", coats: 2 }] }],
    materials: [{ product: "P", colourName: "White" }],
    doneTicks: [{ heading: "Kitchen", label: "Walls", state: "prepped", stateChangedAt: "2026-08-27T03:00:00Z" }],
  }));
  expect(rows[0].applied_from).toBeNull();
});

test("the product-keyed collapse is visible: two rooms, one product, one snapshot colour → one colour (lossy)", () => {
  // This is exactly what ruling 1 fixes at source in session 2. The backfill
  // cannot recover the second room's colour; this test documents that the
  // reconstruction is honest about it rather than inventing anything.
  const rows = reconstructRows(base({
    areas: [
      { title: "Living room", surfaces: [{ label: "Walls", product: "Wash & Wear", coats: 2 }] },
      { title: "Study", surfaces: [{ label: "Walls", product: "Wash & Wear", coats: 2 }] },
    ],
    materials: [{ product: "Wash & Wear", colourName: "Natural White", colourHex: "#F1EDE4" }],
  }));
  expect(rows).toHaveLength(2); // one per area — but both carry the same colour
  expect(new Set(rows.map((r) => r.colour_name)).size).toBe(1);
});

test("linkSupersedence chains same-group rows oldest → newest, leaves other groups alone", () => {
  const rows = [
    { area_label: "Walls — all rooms", surface_type: "wall", jobOrder: 1 },
    { area_label: "Walls — all rooms", surface_type: "wall", jobOrder: 3 },
    { area_label: "Walls — all rooms", surface_type: "wall", jobOrder: 2 },
    { area_label: "Ceilings", surface_type: "ceiling", jobOrder: 1 },
  ];
  const links = linkSupersedence(rows);
  expect(links[0]).toBe(2); // job 1 → superseded by job 2
  expect(links[2]).toBe(1); // job 2 → superseded by job 3
  expect(links[1]).toBeNull(); // newest stays current
  expect(links[3]).toBeNull(); // ceilings never repainted
});
