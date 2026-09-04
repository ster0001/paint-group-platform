import { test, expect } from "vitest";
import { aggregateMaterials, lookupColourEntry, materialColourKey, type MaterialSurfaceRow } from "./materials";

const row = (over: Partial<MaterialSurfaceRow>): MaterialSurfaceRow => ({
  product: "Wash & Wear Low Sheen",
  volume: 3,
  photoUrl: "",
  colourName: "",
  colourHex: "",
  match: null,
  ...over,
});

const opts = {
  roundUpLitres: (n: number) => Math.ceil(n),
  statusFor: () => "tbc" as const,
};

// THE golden test (Tom's ruling 1, 30 Aug): two rooms, same product,
// different colours → two colours survive. The old aggregation kept the
// first colour per product and silently dropped the second.
test("GOLDEN: two rooms, same product, different colours → two material rows", () => {
  const out = aggregateMaterials([
    row({ colourName: "Natural White", colourHex: "#F1EDE4", volume: 4.2 }),
    row({ colourName: "Domino", colourHex: "#2A2E33", volume: 1.4 }),
    row({ colourName: "Natural White", colourHex: "#F1EDE4", volume: 2.1 }),
  ], opts);
  expect(out).toHaveLength(2);
  const white = out.find((m) => m.colourName === "Natural White")!;
  const domino = out.find((m) => m.colourName === "Domino")!;
  expect(white.litres).toBe(Math.ceil(4.2 + 2.1)); // volumes split per colour
  expect(domino.litres).toBe(Math.ceil(1.4));
  expect(white.colourKey).toBe("Wash & Wear Low Sheen||Natural White");
  expect(domino.colourKey).toBe("Wash & Wear Low Sheen||Domino");
});

test("no colour yet → one row keyed by bare product (the legacy shape)", () => {
  const out = aggregateMaterials([row({}), row({ volume: 2 })], opts);
  expect(out).toHaveLength(1);
  expect(out[0].colourKey).toBe("Wash & Wear Low Sheen");
  expect(out[0].litres).toBe(5);
});

test("unknown coverage never fabricates litres, even mixed with known", () => {
  const out = aggregateMaterials([
    row({ colourName: "White", volume: 0 }),
    row({ colourName: "Grey", volume: 3 }),
  ], opts);
  expect(out.find((m) => m.colourName === "White")!.litres).toBeNull();
  expect(out.find((m) => m.colourName === "White")!.coverageMissing).toBe(true);
  expect(out.find((m) => m.colourName === "Grey")!.litres).toBe(3);
});

test("first required colour match in the group carries; photo backfills", () => {
  const out = aggregateMaterials([
    row({ colourName: "White" }),
    row({ colourName: "White", match: { code: "SW1 P4", brand: "Dulux", canSize: "4L" }, photoUrl: "p.jpg" }),
  ], opts);
  expect(out).toHaveLength(1);
  expect(out[0].colourMatch).toEqual({ required: true, code: "SW1 P4", brand: "Dulux", canSize: "4L" });
  expect(out[0].photoUrl).toBe("p.jpg");
});

test("statusFor receives the colour key and the bare product", () => {
  const seen: Array<[string, string]> = [];
  aggregateMaterials([row({ colourName: "White" })], {
    ...opts,
    statusFor: (key, product) => { seen.push([key, product]); return "confirmed"; },
  });
  expect(seen).toEqual([["Wash & Wear Low Sheen||White", "Wash & Wear Low Sheen"]]);
});

test("lookupColourEntry: colour key first, legacy bare-product fallback", () => {
  const map = { "P||White": { status: "confirmed" }, P: { status: "tbc" } };
  expect(lookupColourEntry(map, materialColourKey("P", "White"), "P")).toEqual({ status: "confirmed" });
  expect(lookupColourEntry(map, materialColourKey("P", "Grey"), "P")).toEqual({ status: "tbc" });
  expect(lookupColourEntry(null, "P||White", "P")).toBeUndefined();
});

// ---- the PC Materials section (Tom, 4 Sep) ----------------------------------

import { applyMaterialEdit, materialRowKey, substratesFor } from "./materials";
import type { WorkOrderDoc } from "./snapshot";

const doc = (): WorkOrderDoc => ({
  version: 1, woRef: "WO-1", status: "issued", jobTitle: "t", jobAddress: "a",
  contactFirstName: "", contactPhone: "", startDate: null, accessNotes: "", crewNotes: "",
  levelOfFinish: "", finishCode: null, contractorName: "", contractorPaymentCents: 0,
  materials: [
    { product: "Wash & Wear", colourKey: "Wash & Wear||White", photoUrl: "", litres: 10, coverageMissing: false,
      colourName: "White", colourHex: "#FFFFFF", colourStatus: "tbc" },
    { product: "Wash & Wear", colourKey: "Wash & Wear||Grey", photoUrl: "", litres: 4, coverageMissing: false,
      colourName: "Grey", colourHex: "#888888", colourStatus: "confirmed" },
    // a legacy row: no colourKey, identity is the bare product
    { product: "Aquanamel", photoUrl: "", litres: null, coverageMissing: true,
      colourName: "", colourHex: "", colourStatus: "tbc" },
  ],
  areas: [
    { id: "a1", title: "Lounge", finishCode: null, finishOverridden: false, photos: [], surfaces: [
      { key: "a1:1", label: "Walls", coats: 2, product: "Wash & Wear", colourKey: "Wash & Wear||White", colourName: "White", colourHex: "#FFFFFF", prep: "", hours: 1, status: "not_started" },
      { key: "a1:2", label: "Ceiling", coats: 2, product: "Wash & Wear", colourKey: "Wash & Wear||Grey", colourName: "Grey", colourHex: "#888888", prep: "", hours: 1, status: "not_started" },
      { key: "a1:3", label: "Doors", coats: 2, product: "Aquanamel", prep: "", hours: 1, status: "not_started" },
    ] },
    { id: "a2", title: "Hall", finishCode: null, finishOverridden: false, photos: [], surfaces: [
      { key: "a2:1", label: "Walls", coats: 3, product: "Wash & Wear", colourKey: "Wash & Wear||White", colourName: "White", colourHex: "#FFFFFF", prep: "", hours: 1, status: "not_started" },
    ] },
  ],
  exclusions: [], company: { name: "", phone: "", logoUrl: "" },
});

test("materialRowKey: colourKey when present, bare product on legacy rows", () => {
  expect(materialRowKey({ colourKey: "P||White", product: "P" })).toBe("P||White");
  expect(materialRowKey({ product: "P" })).toBe("P");
});

test("substratesFor lists every surface painted in that product×colour, by area", () => {
  expect(substratesFor(doc(), "Wash & Wear||White")).toEqual([
    { area: "Lounge", label: "Walls", coats: 2 },
    { area: "Hall", label: "Walls", coats: 3 },
  ]);
  expect(substratesFor(doc(), "Wash & Wear||Grey")).toEqual([{ area: "Lounge", label: "Ceiling", coats: 2 }]);
  // legacy surfaces (no colourKey) match on product
  expect(substratesFor(doc(), "Aquanamel")).toEqual([{ area: "Lounge", label: "Doors", coats: 2 }]);
  expect(substratesFor(doc(), "nope")).toEqual([]);
});

test("applyMaterialEdit rewrites ONE row and every surface carrying its key — nothing else", () => {
  const out = applyMaterialEdit(doc(), "Wash & Wear||White", {
    colourName: " Natural White ", colourHex: "#F1EDE4", colourStatus: "confirmed", litres: 15,
  });
  expect(out.materials[0]).toMatchObject({
    colourName: "Natural White", colourHex: "#F1EDE4", colourStatus: "confirmed", litres: 15, coverageMissing: false,
    colourKey: "Wash & Wear||White", // the identity stays what the sheet was issued with
  });
  expect(out.materials[1]).toEqual(doc().materials[1]); // the grey row untouched
  expect(out.areas[0].surfaces[0]).toMatchObject({ colourName: "Natural White", colourHex: "#F1EDE4" });
  expect(out.areas[1].surfaces[0]).toMatchObject({ colourName: "Natural White", colourHex: "#F1EDE4" });
  expect(out.areas[0].surfaces[1]).toMatchObject({ colourName: "Grey" });
  expect(out.areas[0].surfaces[2].colourName).toBeUndefined();
});

test("applyMaterialEdit: null litres leaves the frozen quantity alone; legacy rows edit by product", () => {
  const out = applyMaterialEdit(doc(), "Aquanamel", { colourName: "Black", colourHex: "", colourStatus: "tbc", litres: null });
  expect(out.materials[2]).toMatchObject({ colourName: "Black", litres: null, coverageMissing: true });
  expect(out.areas[0].surfaces[2]).toMatchObject({ colourName: "Black", colourHex: "" });
});

test("applyMaterialEdit: an unknown row returns the same document, so the caller can refuse", () => {
  const d = doc();
  expect(applyMaterialEdit(d, "Ghost", { colourName: "x", colourHex: "", colourStatus: "tbc", litres: null })).toBe(d);
});
