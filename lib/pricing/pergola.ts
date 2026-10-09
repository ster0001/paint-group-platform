/**
 * Pergola pricing from the top's footprint.
 *
 * Tom, 5 Oct 2026: *"Currently pergola is priced on per number (1, 2, 3 etc)
 * — this needs to be priced based on approx measurements."* The card's
 * Pergola row is "Hours Per Item" (two coats ≈ 8.7 h and 2 L a coat per
 * item), and the card stays the authority on the hours — so a measured top
 * is expressed as item-EQUIVALENTS: one card item covers PERGOLA_ITEM_M2 of
 * top, and a 6 × 4 m top is 2.4 items. The engine reads that through
 * `qtyOverride` (an absolute quantity it never scales) and the litres follow
 * the same figure, so hours, price and paint all move with the size.
 *
 * PERGOLA_ITEM_M2 is the ONE number that ties the card's per-item hours to a
 * footprint: a typical 3 × 3 m pergola ≈ one item. Change it here, nowhere
 * else, if Tom rules a different figure.
 */
export const PERGOLA_ITEM_M2 = 10;
/** Sensible bounds for a single pergola top, in metres. */
export const PERGOLA_DIM_MIN_M = 0.5;
export const PERGOLA_DIM_MAX_M = 30;

export function pergolaDimsOk(lengthM: number, widthM: number): boolean {
  const ok = (v: number) => Number.isFinite(v) && v >= PERGOLA_DIM_MIN_M && v <= PERGOLA_DIM_MAX_M;
  return ok(lengthM) && ok(widthM);
}

/** The top's area in m², to two decimals. */
export function pergolaTopM2(lengthM: number, widthM: number): number {
  return Math.round(lengthM * widthM * 100) / 100;
}

/** How many card items a top of this size is — never below a tenth. */
export function pergolaItemsForTop(lengthM: number, widthM: number): number {
  return Math.max(0.1, Math.round((pergolaTopM2(lengthM, widthM) / PERGOLA_ITEM_M2) * 100) / 100);
}

/** The line's label on every document: the size the price was built on. */
export function pergolaTopLabel(lengthM: number, widthM: number): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));
  return `Pergola — top approx. ${n(lengthM)} × ${n(widthM)} m (${n(pergolaTopM2(lengthM, widthM))} m²)`;
}
