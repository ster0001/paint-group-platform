/**
 * Site allowances by job size (go-live brief §3, 18 Nov 2026; Tom ruled D6, D9, D11).
 *
 * Staff have always scaled set-up and preparation hours, cleaning hours and
 * sundries with the size of the job by hand; the wizard charged a flat $275
 * and nothing else, and came out about 13% under a staff quote for the same
 * house. This module is the ONE place those three figures come from, for the
 * wizard, the staff builder, the quote, the work order and the contractor
 * offer alike. `priceEstimateTotals` calls it; nothing else computes them.
 *
 * The scale is banded by PAINTING HOURS per side (the engine knows them
 * before these are added; dollar bands would move every time a rate moved).
 * The hours used for the band are the job's SIZE — production hours at the
 * card's standard two coats, before the job modifier and any commercial
 * loading — so a 2-coat and a 3-coat version of the same job, or the same job
 * under a different modifier, land on the same allowances (acceptance §5 S1).
 *
 * A "both" job takes the interior row for its inside hours and the exterior
 * row for its outside hours. A side with no (non-optional) block contributes
 * nothing. Exterior cleaning is none by default (D11: 2 of 84 staff-priced
 * exterior jobs carried it). Cleaning is charged at its own rate (D9, $65/hr
 * to start — the staff median); prep hours at the job's painting charge-out.
 *
 * The starting values are §3.1's medians, rounded to the half hour and $5,
 * with the three ⚑ cells held so a bigger job never gets less. Every value
 * edits in Settings (one row, `site_allowances`) without a deploy.
 */

export type AllowanceBand = {
  /** The band holds hours strictly under this; null = open-ended ("Over 180"). */
  upToHours: number | null;
  prepHours: number;
  cleaningHours: number;
  sundriesCents: number;
};

export type SiteAllowanceSettings = {
  version: 1;
  interior: AllowanceBand[];
  exterior: AllowanceBand[];
  /** D9: cleaning is charged below the painting rate — $65/hr to start. */
  cleaningRateCents: number;
};

export const SITE_ALLOWANCES_KEY = "site_allowances";

/** The band edges the data was cut on (§1.1): under 12 · 12–35 · 35–60 · 60–100 · 100–180 · over 180. */
export const BAND_EDGES: ReadonlyArray<number | null> = [12, 35, 60, 100, 180, null];

const band = (upToHours: number | null, prepHours: number, cleaningHours: number, sundries: number): AllowanceBand =>
  ({ upToHours, prepHours, cleaningHours, sundriesCents: Math.round(sundries * 100) });

/** §3.1 — adopted by Tom on 18 Nov 2026 (D6). */
export const DEFAULT_SITE_ALLOWANCES: SiteAllowanceSettings = {
  version: 1,
  interior: [
    band(12, 2.0, 1.5, 105),
    band(35, 3.5, 2.0, 145),
    band(60, 4.5, 3.5, 180),
    band(100, 8.0, 4.0, 245),
    band(180, 10.0, 5.0, 270),
    band(null, 10.0, 6.0, 335), // ⚑ held at 10.0 (data median 8.0 from 6 jobs) so a bigger job never gets less
  ],
  exterior: [
    band(12, 2.0, 0, 140), // ⚑ no exterior job under 12 h had prep hours; 2.0 matches the interior
    band(35, 4.0, 0, 175),
    band(60, 4.0, 0, 185),
    band(100, 4.0, 0, 175),
    band(180, 8.0, 0, 175),
    band(null, 8.0, 0, 270), // ⚑ held at 8.0 (data median 4.0 from 4 jobs)
  ],
  cleaningRateCents: 65_00,
};

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const hours = (x: unknown, fallback: number): number => (finite(x) && x >= 0 && x <= 200 ? x : fallback);
const cents = (x: unknown, fallback: number): number => (finite(x) && x >= 0 && x <= 10_000_00 ? Math.round(x) : fallback);

function bandsFrom(value: unknown, defaults: AllowanceBand[]): AllowanceBand[] {
  const rows = Array.isArray(value) ? value : [];
  // The edges are fixed (they are what the data was cut on); only the figures in each band are the office's.
  return defaults.map((d, i) => {
    const r = (rows[i] && typeof rows[i] === "object" ? rows[i] : {}) as Record<string, unknown>;
    return { upToHours: d.upToHours, prepHours: hours(r.prepHours, d.prepHours), cleaningHours: hours(r.cleaningHours, d.cleaningHours), sundriesCents: cents(r.sundriesCents, d.sundriesCents) };
  });
}

/** The Settings value → a complete scale; anything unusable falls back to §3.1, cell by cell. */
export function siteAllowancesFrom(value: unknown): SiteAllowanceSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    version: 1,
    interior: bandsFrom(v.interior, DEFAULT_SITE_ALLOWANCES.interior),
    exterior: bandsFrom(v.exterior, DEFAULT_SITE_ALLOWANCES.exterior),
    cleaningRateCents: cents(v.cleaningRateCents, DEFAULT_SITE_ALLOWANCES.cleaningRateCents),
  };
}

/** Which band a side's hours fall in: the first whose edge the hours are strictly under; the open band otherwise. */
export function bandFor(bands: readonly AllowanceBand[], paintingHours: number): AllowanceBand {
  const h = Number.isFinite(paintingHours) && paintingHours > 0 ? paintingHours : 0;
  return bands.find((b) => b.upToHours == null || h < b.upToHours) ?? bands[bands.length - 1];
}

export type SiteAllowanceInput = {
  /** The side's job-size hours, or null when the job has no (non-optional) block on that side. */
  interiorHours: number | null;
  exteriorHours: number | null;
};

export type SiteAllowances = {
  prepHours: number;
  cleaningHours: number;
  sundriesCents: number;
  /** The bands that were read, for the builder's "from the job-size scale" note. */
  interior: AllowanceBand | null;
  exterior: AllowanceBand | null;
};

/** The three figures for a job: each side's band, added. A side with no block adds nothing. */
export function siteAllowances(input: SiteAllowanceInput, scale: SiteAllowanceSettings = DEFAULT_SITE_ALLOWANCES): SiteAllowances {
  const interior = input.interiorHours == null ? null : bandFor(scale.interior, input.interiorHours);
  const exterior = input.exteriorHours == null ? null : bandFor(scale.exterior, input.exteriorHours);
  const sum = (pick: (b: AllowanceBand) => number) => (interior ? pick(interior) : 0) + (exterior ? pick(exterior) : 0);
  return {
    prepHours: round2(sum((b) => b.prepHours)),
    cleaningHours: round2(sum((b) => b.cleaningHours)),
    sundriesCents: sum((b) => b.sundriesCents),
    interior, exterior,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Under 12 h", "12–35 h", "Over 180 h" — the band's name for the Settings table and the builder's note. */
export function bandLabel(bands: readonly AllowanceBand[], i: number): string {
  const b = bands[i];
  if (!b) return "";
  if (b.upToHours == null) return `Over ${bands[i - 1]?.upToHours ?? ""} h`;
  if (i === 0) return `Under ${b.upToHours} h`;
  return `${bands[i - 1].upToHours}–${b.upToHours} h`;
}
