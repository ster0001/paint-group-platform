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
 *
 * Confirmation is A PERSON'S TICK (Tom, 23 Aug): the WO's pre-start
 * "Colour schedule finalised" checklist item, passed in as
 * `coloursFinalised`. The per-product colourStatus in the snapshot is the
 * older mechanism and still honoured, but nobody drives it day to day —
 * reading it alone left confirmed jobs stuck on "to be confirmed".
 */

export type RegisterSnapshotArea = {
  title: string;
  /** colourKey present on documents frozen after the product×colour split
   * (ruling 1, 30 Aug) — it joins a surface to ITS colour's material row. */
  surfaces: Array<{ label: string; product: string; coats: number; colourKey?: string }>;
};

export type RegisterMaterial = {
  product: string;
  colourKey?: string;
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
  coloursFinalised = false,
): RegisterArea[] {
  // Post-split documents carry several material rows per product (one per
  // colour), joined by colourKey; pre-split ones fall back to first-per-
  // product, which was the old behaviour exactly.
  const byKey = new Map(materials.map((m) => [m.colourKey ?? m.product, m]));
  const byProduct = new Map<string, RegisterMaterial>();
  for (const m of materials) if (!byProduct.has(m.product)) byProduct.set(m.product, m);
  return areas
    .map((area) => {
      const rows: RegisterRow[] = [];
      for (const s of area.surfaces) {
        const material = (s.colourKey ? byKey.get(s.colourKey) : undefined) ?? byProduct.get(s.product);
        const entry = live?.[s.colourKey ?? s.product] ?? live?.[s.product];
        const match = entry?.match;
        // A product with no colour NAME anywhere stays TBC even when the
        // schedule tick is done — the register never invents a colour.
        const confirmed = material && material.colourName
          && (coloursFinalised
            || material.colourStatus === "confirmed"
            || entry?.status === "confirmed");
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

/* ---- Portal UX brief (25 Oct 2026) · My colours E1–E3, pure over the register ---- */

const BRANDS = ["British Paints", "Feast Watson", "Dulux", "Taubmans", "Haymes", "Wattyl", "Resene", "Porter's", "Solver", "Berger", "Accent", "Bristol", "Intergrain", "Cabot's", "Sikkens", "Aquanamel"];

/** "Dulux Wash&Wear Low Sheen" → brand Dulux · line Wash&Wear · finish low sheen.
 * The product string is the only record of brand and finish (E1) — nothing is
 * invented: an unknown brand is simply the first word. */
export function describeProduct(product: string): { brand: string | null; line: string | null; finish: string | null } {
  const p = product.trim();
  if (!p) return { brand: null, line: null, finish: null };
  const brand = BRANDS.find((b) => p.toLowerCase().startsWith(b.toLowerCase())) ?? p.split(/\s+/)[0] ?? null;
  const sheen = sheenOf(p);
  const finish = sheen ? sheen.toLowerCase().replace(/[- ]/, " ") : null;
  let line = p;
  if (brand) line = line.slice(brand.length);
  if (sheen) line = line.replace(new RegExp(sheen.replace(/[-\s]/g, "[- ]"), "i"), "");
  line = line.replace(/\s+/g, " ").trim().replace(/^[-·,]+|[-·,]+$/g, "").trim();
  return { brand, line: line || null, finish };
}

/** A painter's match code is shown only when it reads as a manufacturer code —
 * never a hex colour or an id fragment (the "CODE 6c15e22d" leak, E1). */
export function displayCode(code: string | null | undefined, colourHex: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  if (/^#?[0-9a-f]{6,}$/i.test(c)) return null;                       // a hex colour or a uuid slice
  if (colourHex && c.replace(/^#/, "").toLowerCase() === colourHex.replace(/^#/, "").toLowerCase()) return null;
  if (c.length > 16 || !/[A-Za-z0-9]/.test(c)) return null;
  return c;
}

export type ColourGroup = {
  key: string;
  colourName: string | null; // null = to be confirmed
  colourHex: string | null;
  product: string;
  brand: string | null;
  line: string | null;
  finish: string | null;
  code: string | null;
  /** "2 coats" or "1–2 coats" across the surfaces. */
  coats: string;
  /** Surface → the areas it was painted in, in register order. */
  surfaces: Array<{ surface: string; areas: string[] }>;
};

/** E2 (default view): one card per colour, listing its surfaces and where. */
export function byColour(register: readonly RegisterArea[]): ColourGroup[] {
  const groups = new Map<string, ColourGroup & { coatSet: Set<number> }>();
  for (const area of register) {
    for (const row of area.rows) {
      const key = row.colourName ? `c:${row.colourName.toLowerCase()}|${row.product.toLowerCase()}` : `tbc:${row.product.toLowerCase()}`;
      let g = groups.get(key);
      if (!g) {
        const d = describeProduct(row.product);
        g = {
          key, colourName: row.colourName, colourHex: row.colourHex, product: row.product,
          brand: d.brand, line: d.line, finish: d.finish, code: displayCode(row.code, row.colourHex),
          coats: "", surfaces: [], coatSet: new Set(),
        };
        groups.set(key, g);
      }
      if (!g.code) g.code = displayCode(row.code, row.colourHex);
      if (!g.colourHex && row.colourHex) g.colourHex = row.colourHex;
      g.coatSet.add(row.coats);
      const s = g.surfaces.find((x) => x.surface.toLowerCase() === row.surface.toLowerCase());
      if (s) { if (!s.areas.includes(area.title)) s.areas.push(area.title); }
      else g.surfaces.push({ surface: row.surface, areas: [area.title] });
    }
  }
  return [...groups.values()].map(({ coatSet, ...g }) => {
    const c = [...coatSet].sort((a, b) => a - b);
    const coats = c.length === 0 ? "" : c.length === 1 || c[0] === c[c.length - 1] ? `${c[0]} coat${c[0] === 1 ? "" : "s"}` : `${c[0]}–${c[c.length - 1]} coats`;
    return { ...g, coats };
  });
}

/** "Natural White" → "N" — the swatch when no hex is on record (E3). */
export function swatchLetter(colourName: string | null): string {
  return (colourName ?? "").trim().charAt(0).toUpperCase() || "?";
}

/** yyyy-mm-dd → "17 Sep 2026": the applied-by date, like every other date here (E6). */
export function longDay(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d || m < 1 || m > 12) return null;
  return `${d} ${months[m - 1]} ${y}`;
}
