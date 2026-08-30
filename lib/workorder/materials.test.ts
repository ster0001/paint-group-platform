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
