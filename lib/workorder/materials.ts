/**
 * Material aggregation for the work-order document — keyed by PRODUCT × COLOUR.
 *
 * The collapse this replaces (Tom's ruling 1, 30 Aug): the doc used to keep
 * one colour per product, first-resolved-wins, so two rooms painted in
 * different colours with the same product lost the second colour before
 * anything downstream could see it — the register, the job sheet, the
 * materials order. A paint order is per colour anyway: "Wash & Wear in
 * Natural White, 6 L" and "Wash & Wear in Domino, 2 L" are two lines.
 *
 * `colourKey` is the stable identity of a material row. It also keys
 * `work_orders.colours` entries from this change on; legacy rows are keyed by
 * bare product name, which is exactly what the key degenerates to when the
 * estimate has no colour yet — so old data reads through the same lookup.
 */
import type { WOColourStatus, WOMaterial } from "./snapshot";

/** The identity of a material row: product alone until a colour is named. */
export function materialColourKey(product: string, colourName: string): string {
  return colourName ? `${product}||${colourName}` : product;
}

/** Read a work_orders.colours-shaped map by colour key, falling back to the
 * legacy bare-product key so pre-change work orders keep working. */
export function lookupColourEntry<T>(
  map: Record<string, T> | null | undefined,
  colourKey: string,
  product: string,
): T | undefined {
  return map?.[colourKey] ?? map?.[product];
}

export type MaterialSurfaceRow = {
  product: string;
  /** Litres of coverage demand for this surface; 0/negative = unknown. */
  volume: number;
  photoUrl: string;
  /** Resolved per-surface colour — "" when still TBC. */
  colourName: string;
  colourHex: string;
  /** The substrate's required colour match, when the estimator flagged one. */
  match: { code: string; brand: string; canSize: string } | null;
};

export function aggregateMaterials(
  rows: readonly MaterialSurfaceRow[],
  opts: {
    roundUpLitres: (litres: number) => number;
    /** WO-side confirmation status for a row (work_orders.colours). */
    statusFor: (colourKey: string, product: string) => WOColourStatus;
  },
): WOMaterial[] {
  const groups = new Map<string, { row: MaterialSurfaceRow; vol: number; photo: string }>();
  for (const r of rows) {
    if (!r.product) continue;
    const key = materialColourKey(r.product, r.colourName);
    const g = groups.get(key);
    if (g) {
      g.vol += r.volume > 0 ? r.volume : 0;
      if (!g.photo && r.photoUrl) g.photo = r.photoUrl;
      if (!g.row.match && r.match) g.row = { ...g.row, match: r.match };
      continue;
    }
    groups.set(key, { row: r, vol: r.volume > 0 ? r.volume : 0, photo: r.photoUrl });
  }
  return [...groups.entries()].map(([key, { row, vol, photo }]) => {
    const missing = !(vol > 0); // no coverage data → never fabricate a litre figure
    return {
      product: row.product,
      colourKey: key,
      photoUrl: photo,
      litres: missing ? null : opts.roundUpLitres(vol),
      coverageMissing: missing,
      colourName: row.colourName,
      colourHex: row.colourHex,
      colourStatus: opts.statusFor(key, row.product),
      colourMatch: row.match
        ? { required: true, code: row.match.code, brand: row.match.brand, canSize: row.match.canSize }
        : null,
    };
  });
}
