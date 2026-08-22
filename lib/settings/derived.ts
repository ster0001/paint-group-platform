/**
 * The pricing settings that are ARITHMETIC on other pricing settings.
 *
 * Seven of the rows in "Pricing & job numbers" are not figures you choose —
 * they are the consequence of figures you chose elsewhere. Contribution per
 * hour is charge-out less the contractor less overhead; overhead per billable
 * hour is the weekly overhead over the billable hours. Until now all 23 rows
 * were identical free-text inputs, so raising a charge-out rate left the three
 * rows downstream of it reading last quarter's number with nothing to say so.
 * That is exactly the hand-editing the v8 rate card brief had to spell out in a
 * table, and exactly the kind of thing that gets missed.
 *
 * Nothing in `lib/pricing/` reads these rows — they are figures you READ, not
 * levers the engine pulls — so computing them cannot move a quote. They are
 * still written to `settings` so anything reading the table sees the truth.
 *
 * Order matters: a spec may depend on an earlier spec's row (overhead per
 * billable hour feeds break-even and both contributions), so the list is in
 * dependency order and one pass resolves the lot.
 */

/** Keys carry em dashes and mixed case; compare them on letters alone. */
export const normaliseSettingKey = (key: string) => key.toLowerCase().replace(/[^a-z]+/g, "");

/** These are all dollar figures — cents is the honest precision. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** A dependency lookup: normalised key → the number currently in that field. */
type Lookup = (normalisedKey: string) => number | null;

export type DerivedSetting = {
  /** The key as it appears in the settings table. */
  key: string;
  /** Shown under the field so the number is never a mystery. */
  formula: string;
  /** Null when any input is missing or not a number — the row stays a plain input. */
  compute: (dep: Lookup) => number | null;
};

/** All inputs present and finite, or null. */
const all = (...vals: (number | null)[]): number[] | null =>
  vals.every((v) => v !== null && Number.isFinite(v)) ? (vals as number[]) : null;

export const DERIVED_SETTINGS: DerivedSetting[] = [
  {
    key: "Total weekly overhead",
    formula: "Weekly fixed costs + Weekly marketing",
    compute: (d) => {
      const v = all(d("weeklyfixedcosts"), d("weeklymarketing"));
      return v && v[0] + v[1];
    },
  },
  {
    key: "Overhead per billable hour",
    formula: "Total weekly overhead ÷ Billable hours per week",
    compute: (d) => {
      const v = all(d("totalweeklyoverhead"), d("billablehoursperweek"));
      // Nobody bills zero hours, but dividing by it would print Infinity.
      return v && v[1] !== 0 ? v[0] / v[1] : null;
    },
  },
  {
    key: "Break-even charge-out rate",
    formula: "Contractor rate + Overhead per billable hour",
    compute: (d) => {
      const v = all(d("contractorrate"), d("overheadperbillablehour"));
      return v && v[0] + v[1];
    },
  },
  {
    key: "Labour spread — interior",
    formula: "Charge-out rate — INTERIOR − Contractor rate",
    compute: (d) => {
      const v = all(d("chargeoutrateinterior"), d("contractorrate"));
      return v && v[0] - v[1];
    },
  },
  {
    key: "Labour spread — exterior",
    formula: "Charge-out rate — EXTERIOR − Contractor rate",
    compute: (d) => {
      const v = all(d("chargeoutrateexterior"), d("contractorrate"));
      return v && v[0] - v[1];
    },
  },
  {
    key: "Contribution per hour — INTERIOR",
    formula: "Charge-out rate — INTERIOR − Contractor rate − Overhead per billable hour",
    compute: (d) => {
      const v = all(d("chargeoutrateinterior"), d("contractorrate"), d("overheadperbillablehour"));
      return v && v[0] - v[1] - v[2];
    },
  },
  {
    key: "Contribution per hour — EXTERIOR",
    formula: "Charge-out rate — EXTERIOR − Contractor rate − Overhead per billable hour",
    compute: (d) => {
      const v = all(d("chargeoutrateexterior"), d("contractorrate"), d("overheadperbillablehour"));
      return v && v[0] - v[1] - v[2];
    },
  },
];

/** Position in the calculated block, so it reads top-down in dependency order. */
export const derivedOrder = (key: string): number =>
  DERIVED_SETTINGS.findIndex((d) => normaliseSettingKey(d.key) === normaliseSettingKey(key));

export const isDerivedSetting = (key: string): boolean => derivedOrder(key) >= 0;

export type DerivedRowInput = { key: string; text: string; manual: boolean };
export type DerivedRowResult = {
  /** The spec, when this row is one of the seven. */
  spec: DerivedSetting | null;
  /** What the formula says, rounded to cents. Null when an input is missing. */
  computed: number | null;
  /** What the field should show: the computed value, unless overridden by hand. */
  display: string;
};

/**
 * Resolve every row against the formulas, using the numbers CURRENTLY in the
 * fields — so an override anywhere in the chain carries downstream exactly as
 * it reads on screen, and the block is always self-consistent.
 */
export function resolveDerived(rows: DerivedRowInput[]): DerivedRowResult[] {
  const byNorm = new Map<string, number | null>();
  const indexByNorm = new Map<string, number>();
  rows.forEach((r, i) => {
    const n = normaliseSettingKey(r.key);
    indexByNorm.set(n, i);
    const num = Number(r.text);
    byNorm.set(n, r.text.trim() !== "" && Number.isFinite(num) ? num : null);
  });
  const dep: Lookup = (k) => byNorm.get(k) ?? null;

  const out: DerivedRowResult[] = rows.map((r) => ({ spec: null, computed: null, display: r.text }));
  for (const spec of DERIVED_SETTINGS) {
    const n = normaliseSettingKey(spec.key);
    const i = indexByNorm.get(n);
    if (i === undefined) continue;
    const raw = spec.compute(dep);
    const computed = raw === null ? null : round2(raw);
    out[i] = { spec, computed, display: rows[i].text };
    if (!rows[i].manual && computed !== null) {
      out[i].display = String(computed);
      // Feed the ROUNDED figure forward, so what the next row computes is what
      // you would get reading the cents off this screen.
      byNorm.set(n, computed);
    }
  }
  return out;
}

/**
 * A saved figure that disagrees with its formula was set by hand — keep it and
 * flag it, rather than silently overwriting the user's number on load.
 *
 * Each row is judged against its formula applied to the numbers ACTUALLY
 * STORED beside it, not against a freshly recomputed chain. Otherwise one stale
 * row upstream flags every row below it as an override, and a row that agrees
 * with its own inputs to the cent gets accused of disagreeing with them.
 */
export function detectManual(rows: { key: string; text: string }[]): boolean[] {
  // manual: true throughout, so no row's stored value is replaced mid-pass.
  const asStored = rows.map((r) => ({ ...r, manual: true }));
  const resolved = resolveDerived(asStored);
  return rows.map((r, i) => {
    const { spec, computed } = resolved[i];
    if (!spec || computed === null) return false;
    const saved = Number(r.text);
    return Number.isFinite(saved) && round2(saved) !== computed;
  });
}
