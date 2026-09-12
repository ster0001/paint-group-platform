import type { DraftArea } from "@/lib/extract/draft";
import type { Deferred } from "@/lib/extract/scope";

/**
 * C12 — the commercial pricing INPUTS (estimator journey v2 addendum §4.12,
 * §4.14; Settings ⚑20 ⚑21 ⚑22 ⚑32).
 *
 * Three things, and only these:
 *
 *   1. **Open-space sizing.** *"Perimeter from the size bracket midpoint
 *      (square assumption unless L×W typed) × wall height — full perimeter,
 *      no deduction for partitions or frontage (cutting-in offsets it; Tom's
 *      ruling); ceiling line
 *      only when `plaster`; `exposed` and `tiles` write a flagged, unpriced
 *      line so the estimator sees it. Height mode (halls, warehouse) sizes
 *      walls from area × height and adds an EWP pass-through line above
 *      `ewp_height_threshold_m` (default 4) unless `lift_on_site`."*
 *
 *   2. **Loadings.** *"Hour multipliers applied after the multiplier chain
 *      and before allowances. They never touch materials or allowances."*
 *      Resolved here into ONE number — `Adjustments.hourLoading` — which
 *      `priceSurface` applies to production hours and nothing else.
 *
 *   3. **The widening** of the reveal's band for a commercial job (⚑20), and
 *      by more when the open space has no photo.
 *
 * Every number comes from the `commercial_pricing` Settings row; the defaults
 * below are the seed's, so a database without the row prices identically.
 * Nothing here reads a rate or produces a dollar — `estimate.ts` does that,
 * unchanged and unaware a segment was involved.
 */

export type OpenSizeBracket = "50" | "150" | "400" | "800";
export type OpenHeightBracket = "4" | "6" | "9";
export type OpenCeiling = "tiles" | "plaster" | "exposed";
export type OpenMode = "size" | "height";

/**
 * Bracket → floor-area midpoint, m². "400+" has no upper bound; 550 is the
 * prototype's working figure for a large open floor, and the assume list says
 * so. The square assumption: L = W = √area.
 */
export const OPEN_SIZE_M2: Record<OpenSizeBracket, number> = { "50": 35, "150": 100, "400": 275, "800": 550 };

/** Bracket → wall height, m, in height mode (halls). "Over 6 m" prices at 7.5. */
export const OPEN_WALL_HEIGHT_M: Record<OpenHeightBracket, number> = { "4": 3.6, "6": 5, "9": 7.5 };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The open area's plan dimensions: a square at the bracket's midpoint. */
export function openSpaceDimensions(size: OpenSizeBracket): { L: number; W: number } {
  const side = round2(Math.sqrt(OPEN_SIZE_M2[size] ?? OPEN_SIZE_M2["150"]));
  return { L: side, W: side };
}

/** The wall height an open area is priced at: the bracket in height mode, else the job's ceiling (null = leave it). */
export function openSpaceWallHeight(mode: OpenMode, height: OpenHeightBracket | null): number | null {
  if (mode !== "height") return null;
  return OPEN_WALL_HEIGHT_M[height ?? "6"];
}

// ---------------------------------------------------------------------------
// Settings ⚑20 ⚑21 ⚑22 ⚑32
// ---------------------------------------------------------------------------

export type CommercialPricing = {
  /** hours answer (and "occupied") → multiplier on production hours. */
  loadings: Record<string, number>;
  /** Percentage points ADDED to the band on the reveal. */
  widenPct: { commercial: number; warehouse: number; noPhotoOpen: number };
  /** C13: racking against the walls → share of the wall area painted. */
  racking: Record<string, number>;
  /** Above this wall height, a platform or lift is its own line. */
  ewpHeightThresholdM: number;
  /** ⚑32: a commercial charge-out; null = the residential rate applies. */
  chargeOutCents: number | null;
};

export const DEFAULT_COMMERCIAL_PRICING: CommercialPricing = {
  loadings: { after: 1.35, weekend: 1.4, staged: 1.25, early_start: 1.15, operating: 1.15, occupied: 1.06, holidays: 1, business: 1, before: 1.15, closed: 1, next: 1, later: 1, ns: 1 },
  widenPct: { commercial: 5, warehouse: 5, noPhotoOpen: 3 },
  racking: { some: 0.88, most: 0.7 },
  ewpHeightThresholdM: 4,
  chargeOutCents: null,
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** The Settings row, with the seed's defaults for anything absent or malformed. */
export function commercialPricingFrom(value: unknown): CommercialPricing {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const loadIn = (v.loadings && typeof v.loadings === "object" ? v.loadings : {}) as Record<string, unknown>;
  const loadings: Record<string, number> = { ...DEFAULT_COMMERCIAL_PRICING.loadings };
  for (const [k, x] of Object.entries(loadIn)) if (typeof x === "number" && x > 0 && x < 5) loadings[k] = x;
  const widenIn = (v.widenPct && typeof v.widenPct === "object" ? v.widenPct : {}) as Record<string, unknown>;
  const rackIn = (v.racking && typeof v.racking === "object" ? v.racking : {}) as Record<string, unknown>;
  const racking: Record<string, number> = { ...DEFAULT_COMMERCIAL_PRICING.racking };
  for (const [k, x] of Object.entries(rackIn)) if (typeof x === "number" && x > 0 && x <= 1) racking[k] = x;
  return {
    loadings,
    widenPct: {
      commercial: num(widenIn.commercial, DEFAULT_COMMERCIAL_PRICING.widenPct.commercial),
      warehouse: num(widenIn.warehouse, DEFAULT_COMMERCIAL_PRICING.widenPct.warehouse),
      noPhotoOpen: num(widenIn.noPhotoOpen, DEFAULT_COMMERCIAL_PRICING.widenPct.noPhotoOpen),
    },
    racking,
    ewpHeightThresholdM: num(v.ewpHeightThresholdM, DEFAULT_COMMERCIAL_PRICING.ewpHeightThresholdM),
    chargeOutCents: typeof v.chargeOutCents === "number" && v.chargeOutCents > 0 ? Math.round(v.chargeOutCents) : null,
  };
}

/**
 * The one loading number for a job: the hours answer's multiplier, times the
 * occupied multiplier when the space stays in use. 1 when nothing applies.
 * Rounded to 4 places so two evaluations of the same answers cannot differ
 * in the last bit.
 */
export function hourLoadingFor(a: { hours: string; occ: string | null }, p: CommercialPricing = DEFAULT_COMMERCIAL_PRICING): number {
  const base = p.loadings[a.hours] ?? 1;
  const occ = a.occ === "occ" ? (p.loadings.occupied ?? 1) : 1;
  return Math.round(base * occ * 10000) / 10000;
}

/**
 * ⚑20 — how much wider a commercial range is than the accuracy score alone
 * would make it, in percentage points. The open-space photo is the one thing
 * that narrows it back: *"open-space photo presence changes the band by
 * exactly the Settings value."*
 */
export function commercialWidenPct(
  job: { pattern: "areas" | "warehouse"; openCount: number; photos: number },
  p: CommercialPricing = DEFAULT_COMMERCIAL_PRICING,
): number {
  const base = job.pattern === "warehouse" ? p.widenPct.warehouse : p.widenPct.commercial;
  const noPhoto = job.openCount > 0 && job.photos === 0 ? p.widenPct.noPhotoOpen : 0;
  return base + noPhoto;
}

/** Is a platform or lift needed for these walls? */
export function needsEwp(
  mode: OpenMode, height: OpenHeightBracket | null, p: CommercialPricing = DEFAULT_COMMERCIAL_PRICING, liftOnSite = false,
): boolean {
  const h = openSpaceWallHeight(mode, height);
  return h != null && h > p.ewpHeightThresholdM && !liftOnSite;
}

// ---------------------------------------------------------------------------
// After buildDraft: the open areas' ceilings, heights and the EWP line
// ---------------------------------------------------------------------------

export type OpenSpaceOptions = {
  /** The draft areas that are open spaces (by name — the tree has no other tag yet). */
  openNames: ReadonlySet<string>;
  ceiling: OpenCeiling;
  mode: OpenMode;
  height: OpenHeightBracket | null;
  liftOnSite?: boolean;
  pricing?: CommercialPricing;
};

export type OpenSpaceDeferred = { room: string; areaId: number | null } & Deferred;

/**
 * Applied to the drafted tree, in place:
 *
 *   - a tiled or exposed ceiling REMOVES the ceiling surface from every open
 *     area (it is not painted) and flags one unpriced line per area, so the
 *     estimator sees the decision rather than a missing surface;
 *   - height mode sets each open area's wall height from the bracket, so
 *     walls = full perimeter × that height (computeQuantity does the product);
 *   - above the threshold, ONE EWP line for the job, flagged and unpriced —
 *     hire is quoted, never estimated (the exterior rule, kept).
 *
 * Returns the flagged lines to append to the draft's deferred list.
 */
export function applyOpenSpace(areas: DraftArea[], o: OpenSpaceOptions): OpenSpaceDeferred[] {
  const out: OpenSpaceDeferred[] = [];
  const wallH = openSpaceWallHeight(o.mode, o.height);
  let anyOpen = false;
  for (const a of areas) {
    if (a.type !== "Interior" || !o.openNames.has(a.name)) continue;
    anyOpen = true;
    if (wallH != null) {
      a.H = wallH;
      if (!a.assumedFields.includes("H")) a.assumedFields.push("H");
    }
    if (o.ceiling !== "plaster") {
      const before = a.surfaces.length;
      a.surfaces = a.surfaces.filter((s) => !/ceiling/i.test(s.code));
      if (a.surfaces.length !== before) {
        out.push({
          room: a.name, areaId: a.id, count: 1, kind: "commercial_ceiling",
          what: o.ceiling === "tiles" ? "Tiled ceiling — not painted" : "Exposed ceiling — not included",
          needs: o.ceiling === "tiles"
            ? "a suspended tile ceiling is not painted; the walls price to the tile line"
            : "an exposed ceiling is a sprayed job priced on site if wanted — not in this estimate",
        });
      }
    }
  }
  if (anyOpen && needsEwp(o.mode, o.height, o.pricing, o.liftOnSite)) {
    out.push({
      room: "Whole job", areaId: null, count: 1, kind: "commercial_ewp",
      what: `Platform or lift for walls over ${(o.pricing ?? DEFAULT_COMMERCIAL_PRICING).ewpHeightThresholdM} m`,
      needs: "access equipment hire is quoted, not estimated — a person sizes it before any price is fixed",
    });
  }
  return out;
}
