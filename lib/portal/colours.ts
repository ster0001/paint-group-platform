/**
 * 3a-5 · "My colours" — the permanent paint register, built from the
 * finalised colour schedule (⚑4 default: the work order's schedule at
 * sign-off; the shape allows later reconciliation against materials).
 *
 * Sources, in confidence order per product:
 *   1. the frozen snapshot's materials (colourName/colourHex at issue), then
 *   2. the live work_orders.colours map (painter-supplied match codes).
 * Where the colour is still TBC the register says so honestly (amber) —
 * nothing invented, ever.
 */

export type RegisterSnapshotArea = {
  title: string;
  surfaces: Array<{ label: string; product: string; coats: number }>;
};

export type RegisterMaterial = {
  product: string;
  colourName: string;
  colourHex: string;
  colourStatus: string; // tbc | confirmed
};

export type RegisterLiveColours = Record<
  string,
  { status?: string; match?: { code?: string; brand?: string; canSize?: string } }
> | null;

export type RegisterRow = {
  surface: string;
  product: string;
  colourName: string | null; // null = to be confirmed
  colourHex: string | null;
  code: string | null; // painter-supplied match code, when known
  coats: number;
};

export type RegisterArea = { title: string; rows: RegisterRow[] };

export function buildRegister(
  areas: readonly RegisterSnapshotArea[],
  materials: readonly RegisterMaterial[],
  live: RegisterLiveColours,
): RegisterArea[] {
  const byProduct = new Map(materials.map((m) => [m.product, m]));
  return areas
    .map((area) => {
      const rows: RegisterRow[] = [];
      for (const s of area.surfaces) {
        const material = byProduct.get(s.product);
        const match = live?.[s.product]?.match;
        const confirmed = material && material.colourStatus === "confirmed" && material.colourName;
        const row: RegisterRow = {
          surface: s.label,
          product: s.product,
          colourName: confirmed ? material.colourName : null,
          colourHex: confirmed && material.colourHex ? material.colourHex : null,
          code: match?.code?.trim() || null,
          coats: s.coats,
        };
        // One row per surface-role: identical consecutive rows collapse
        // (e.g. "Walls" appearing per storey with the same paint).
        const prev = rows[rows.length - 1];
        if (
          prev && prev.surface === row.surface && prev.product === row.product &&
          prev.colourName === row.colourName
        ) continue;
        rows.push(row);
      }
      return { title: area.title, rows };
    })
    .filter((a) => a.rows.length > 0);
}

/** "LOW SHEEN" etc. when the product name carries a finish — display only. */
export function sheenOf(product: string): string | null {
  const m = product.match(/low sheen|semi[- ]gloss|gloss|matt|flat|satin|eggshell/i);
  return m ? m[0].toUpperCase() : null;
}
