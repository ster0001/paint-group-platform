/**
 * Tom, 5 Oct 2026: a pergola is priced on its top's length × width, as
 * item-equivalents of the card's "Hours Per Item" Pergola row.
 */
import { test, expect } from "vitest";
import { PERGOLA_ITEM_M2, pergolaDimsOk, pergolaItemsForTop, pergolaTopLabel, pergolaTopM2 } from "./pergola";

test("one card item is PERGOLA_ITEM_M2 of top — a 6 × 4 m top is 2.4 items, a 3 × 3 is 0.9", () => {
  expect(PERGOLA_ITEM_M2).toBe(10);
  expect(pergolaTopM2(6, 4)).toBe(24);
  expect(pergolaItemsForTop(6, 4)).toBe(2.4);
  expect(pergolaItemsForTop(3, 3)).toBe(0.9);
  expect(pergolaItemsForTop(2.5, 1.5)).toBe(0.38);
});

test("a tiny top never prices below a tenth of an item, and the bounds refuse nonsense", () => {
  expect(pergolaItemsForTop(0.5, 0.5)).toBe(0.1);
  expect(pergolaDimsOk(3, 3)).toBe(true);
  expect(pergolaDimsOk(0, 3)).toBe(false);
  expect(pergolaDimsOk(31, 3)).toBe(false);
  expect(pergolaDimsOk(Number.NaN, 3)).toBe(false);
});

test("the label says the size the price was built on", () => {
  expect(pergolaTopLabel(6, 4)).toBe("Pergola — top approx. 6 × 4 m (24 m²)");
  expect(pergolaTopLabel(3.5, 2.75)).toBe("Pergola — top approx. 3.5 × 2.8 m (9.63 m²)".replace("9.63", "9.6"));
});
