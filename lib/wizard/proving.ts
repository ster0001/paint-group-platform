/**
 * Step 9 (proving window): measure the wizard against reality. Each wizard
 * estimate froze its ORIGINAL numbers at submit (builder_state.wizard.
 * snapshot); the live estimate has since been corrected by staff. The gap
 * between them is the proving-window signal, and its aggregate is the gate's
 * exit condition: median staff correction < $150, and no guardrail misses.
 *
 * Pure: the caller prices the live estimate; this compares to the snapshot.
 */

export type WizardSnapshot = {
  totalCents: number;
  accuracyPct: number;
  outcome: string;
  walkthroughRequired: boolean;
  areaCount?: number;
};

export type ProvingRow = {
  estimateId: string;
  title: string;
  status: string;
  source: string;
  submittedAt: string | null;
  /** The wizard's first-guess total, cents. */
  originalCents: number;
  /** The estimate's current priced total, cents. */
  currentCents: number;
  /** currentCents - originalCents: what staff moved it by. */
  correctionCents: number;
  /** |correction| as a fraction of the original, for banding. */
  correctionPct: number | null;
  accuracyPct: number;
  outcome: string;
  walkthroughRequired: boolean;
  accepted: boolean;
};

export function provingRow(
  estimate: { id: string; title: string | null; status: string | null; source: string | null },
  snapshot: WizardSnapshot | null,
  currentCents: number,
  submittedAt: string | null,
): ProvingRow | null {
  if (!snapshot) return null;
  const originalCents = snapshot.totalCents;
  const correctionCents = currentCents - originalCents;
  return {
    estimateId: estimate.id,
    title: estimate.title ?? "Untitled",
    status: estimate.status ?? "draft",
    source: estimate.source ?? "wizard",
    submittedAt,
    originalCents,
    currentCents,
    correctionCents,
    correctionPct: originalCents > 0 ? (correctionCents / originalCents) * 100 : null,
    accuracyPct: snapshot.accuracyPct,
    outcome: snapshot.outcome,
    walkthroughRequired: snapshot.walkthroughRequired,
    accepted: estimate.status === "accepted",
  };
}

/**
 * Tom, 9 Sep 2026: "add a delete button so I can delete all of the proving
 * items which aren't relevant."
 *
 * The rows ARE estimates — some of them real jobs — so nothing here deletes
 * one. Excluding takes the row off the page and out of every number on it,
 * which is what "not relevant" means for a measurement, and it can be put
 * back. Stored beside the correction tag on the estimate itself
 * (`builder_state.wizard.provingExcluded`): no new column, no migration.
 */
export type ProvingExclusion = { at: string; by: string | null; reason: string };

export function exclusionFrom(value: unknown): ProvingExclusion | null {
  const v = (value && typeof value === "object" ? value : null) as Partial<ProvingExclusion> | null;
  if (!v || typeof v.at !== "string" || !v.at) return null;
  return {
    at: v.at,
    by: typeof v.by === "string" && v.by ? v.by : null,
    reason: typeof v.reason === "string" ? v.reason.trim().slice(0, 200) : "",
  };
}

/**
 * The measured rows and the set-aside ones. The summary is computed from
 * `kept` alone — that is the point of excluding: a benchmark nobody trusts
 * must stop moving the median (Tom, 9 Sep: the proving comparisons were
 * against PaintScout quotes that themselves lost money).
 */
export function splitProving<T extends { estimateId: string }>(
  rows: T[],
  exclusions: Record<string, ProvingExclusion | null>,
): { kept: T[]; excluded: Array<T & { exclusion: ProvingExclusion }> } {
  const kept: T[] = [];
  const excluded: Array<T & { exclusion: ProvingExclusion }> = [];
  for (const r of rows) {
    const ex = exclusions[r.estimateId] ?? null;
    if (ex) excluded.push({ ...r, exclusion: ex });
    else kept.push(r);
  }
  return { kept, excluded };
}

export type ProvingSummary = {
  count: number;
  /** Median of |correctionCents| — the gate metric (target < $150 = 15000c). */
  medianAbsCorrectionCents: number;
  meanAbsCorrectionCents: number;
  /** Share whose |correction| is within ±10% of the original. */
  withinTenPctShare: number;
  /** Estimates that were accepted straight from the wizard. */
  acceptedCount: number;
  /** How outcomes were distributed. */
  outcomes: Record<string, number>;
  /** The gate's dollar test on this sample. */
  gatePasses: boolean;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export function provingSummary(rows: ProvingRow[], gateCents = 15000): ProvingSummary {
  const abs = rows.map((r) => Math.abs(r.correctionCents));
  const medianAbs = median(abs);
  const withinTen = rows.filter((r) => r.correctionPct != null && Math.abs(r.correctionPct) <= 10).length;
  const outcomes: Record<string, number> = {};
  for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  return {
    count: rows.length,
    medianAbsCorrectionCents: medianAbs,
    meanAbsCorrectionCents: abs.length ? Math.round(abs.reduce((n, x) => n + x, 0) / abs.length) : 0,
    withinTenPctShare: rows.length ? withinTen / rows.length : 0,
    acceptedCount: rows.filter((r) => r.accepted).length,
    outcomes,
    // The gate needs a real sample AND the median under the threshold.
    gatePasses: rows.length >= 10 && medianAbs < gateCents,
  };
}
