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
