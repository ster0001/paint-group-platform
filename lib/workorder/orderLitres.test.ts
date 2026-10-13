import { test, expect } from "vitest";
import { cansFor, cansLabel, litresLabel, orderLitres } from "./snapshot";
import { aggregateMaterials, areaMaterials, rowEstimatedLitres, type MaterialSurfaceRow } from "./materials";
import type { WOArea, WOMaterial } from "./snapshot";

// Tom, 13 Oct 2026: "Materials should be marked conservatively and rounded
// down rather than up. The can sizes for paint come in 1, 2, 4, 10 or 15."

test("order litres round DOWN to whole litres — never up to the next tin", () => {
  expect(orderLitres(4.1)).toBe(4);   // was a 10 L can
  expect(orderLitres(15.5)).toBe(15); // was a 20 L drum
  expect(orderLitres(13.8)).toBe(13);
  expect(orderLitres(10)).toBe(10);
  expect(orderLitres(9.99)).toBe(9);
  expect(orderLitres(0.1 * 3 * 100 / 3)).toBe(10); // float noise under 10 is 10
});

test("a row that needs any paint orders at least one 1 L can; none needs none", () => {
  expect(orderLitres(0.3)).toBe(1);
  expect(orderLitres(0)).toBe(0);
  expect(orderLitres(-2)).toBe(0);
  expect(orderLitres(Number.NaN)).toBe(0);
});

test("cans: fewest cans that add up exactly, from 15 / 10 / 4 / 2 / 1 L", () => {
  expect(cansFor(13)).toEqual([{ size: 10, count: 1 }, { size: 2, count: 1 }, { size: 1, count: 1 }]);
  expect(cansFor(20)).toEqual([{ size: 10, count: 2 }]); // not 15 + 4 + 1
  expect(cansFor(23)).toEqual([{ size: 15, count: 1 }, { size: 4, count: 2 }]);
  expect(cansFor(8)).toEqual([{ size: 4, count: 2 }]);
  expect(cansFor(0)).toEqual([]);
  expect(cansFor(12.6)).toEqual([{ size: 10, count: 1 }, { size: 2, count: 1 }]); // typed figure, rounded down
  expect(cansFor(47).reduce((n, c) => n + c.size * c.count, 0)).toBe(47);
  expect(cansLabel(20)).toBe("2 × 10 L");
  expect(cansLabel(3)).toBe("2 L + 1 L");
});

test("no can size the trade counter doesn't sell", () => {
  for (let n = 1; n <= 120; n++) for (const c of cansFor(n)) expect([1, 2, 4, 10, 15]).toContain(c.size);
});

test("estimate litres read to one decimal", () => {
  expect(litresLabel(13.8456)).toBe("13.8 L");
  expect(litresLabel(4)).toBe("4 L");
});

const row = (over: Partial<MaterialSurfaceRow>): MaterialSurfaceRow => ({
  product: "Aquanamel", volume: 1, photoUrl: "", colourName: "", colourHex: "", match: null, ...over,
});

test("trim: small rows round DOWN and never exceed the estimate", () => {
  const out = aggregateMaterials(
    [row({ volume: 1.3 }), row({ volume: 0.9 }), row({ product: "Wash & Wear", volume: 4.4 })],
    { orderLitres, statusFor: () => "tbc" },
  );
  const trim = out.find((m) => m.product === "Aquanamel")!;
  expect(trim.estimatedLitres).toBe(2.2);
  expect(trim.litres).toBe(2); // was 4 under the old round-up
  const walls = out.find((m) => m.product === "Wash & Wear")!;
  expect(walls.litres).toBe(4); // was 10
  expect(walls.estimatedLitres).toBe(4.4);
  for (const m of out) expect(m.litres!).toBeLessThanOrEqual(Math.max(1, m.estimatedLitres!));
});

const area = (surfaces: Partial<WOArea["surfaces"][number]>[]): WOArea => ({
  id: "a1", title: "Lounge", photos: [], finishCode: null, finishOverridden: false,
  surfaces: surfaces.map((s, i) => ({ key: `a1:${i}`, label: "Walls", coats: 2, product: "", prep: "", hours: 1, status: "not_started", ...s })),
});

test("each area lists its own paint by product × colour, litres summed", () => {
  const a = area([
    { product: "Wash & Wear", colourKey: "Wash & Wear||Lexicon", colourName: "Lexicon", litres: 3.25 },
    { product: "Wash & Wear", colourKey: "Wash & Wear||Lexicon", colourName: "Lexicon", litres: 1.1 },
    { product: "Aquanamel", colourKey: "Aquanamel||Lexicon", colourName: "Lexicon", litres: 0.6 },
    { product: "" }, // a prep-only line carries no paint
  ]);
  expect(areaMaterials(a)).toEqual([
    { colourKey: "Wash & Wear||Lexicon", product: "Wash & Wear", finish: undefined, colourName: "Lexicon", colourHex: "", litres: 4.35 },
    { colourKey: "Aquanamel||Lexicon", product: "Aquanamel", finish: undefined, colourName: "Lexicon", colourHex: "", litres: 0.6 },
  ]);
  // a sheet frozen before surfaces carried litres: nothing, never a guess
  expect(areaMaterials(area([{ product: "Wash & Wear" }]))).toEqual([]);
});

test("row estimate: frozen figure, or the surfaces' sum when an option has since merged in", () => {
  const m: WOMaterial = { product: "Wash & Wear", colourKey: "Wash & Wear||Lexicon", photoUrl: "", litres: 4, estimatedLitres: 4.35, coverageMissing: false, colourName: "Lexicon", colourHex: "", colourStatus: "tbc" };
  const doc = { areas: [area([
    { product: "Wash & Wear", colourKey: "Wash & Wear||Lexicon", litres: 4.35 },
    { product: "Wash & Wear", colourKey: "Wash & Wear||Lexicon", litres: 2 },
  ])] };
  expect(rowEstimatedLitres(doc, m)).toBe(6.35);
  expect(rowEstimatedLitres({ areas: [] }, m)).toBe(4.35);
  expect(rowEstimatedLitres({ areas: [] }, { ...m, estimatedLitres: undefined })).toBeNull();
});
