/**
 * The accuracy score: the DOLLAR-WEIGHTED share of the estimate that is
 * extracted-or-confirmed data rather than assumption (phase plan W4's model,
 * shown in the W3 editor). Pure — the caller prices the areas first; this
 * never computes money itself.
 *
 * Per-area credit (v1, to be calibrated against the W5 proving window):
 *   human_confirmed 1.0 · ai_extracted 0.92 (0.7 when the reader's own
 *   confidence was low) · ai_derived 0.85 · ai_assumed 0.45.
 *   An assumed ceiling height costs 0.15 — Step 6's finding is that height,
 *   not plan-reading, is the walls error. Assumed L/W caps credit at 0.5.
 *
 * Weighting: an area counts by what it costs — a wrong laundry moves the
 * total less than a wrong open-plan living. Unpriced areas (price 0) carry
 * the mean weight of the priced ones: being unpriced is risk, not safety.
 * Each unresolved deferred item costs 2 points, capped at 12.
 */

export type ScoredArea = {
  priceCents: number;
  origin: string;
  confidence: number;
  assumedFields: string[];
};

function credit(a: ScoredArea): number {
  let c: number;
  switch (a.origin) {
    case "human_confirmed": c = 1.0; break;
    case "ai_extracted": c = a.confidence >= 0.7 ? 0.92 : 0.7; break;
    case "ai_derived": c = 0.85; break;
    case "ai_assumed": c = 0.45; break;
    default: c = 1.0; // absent origin reads as human work (pre-AI estimates)
  }
  if (a.assumedFields.includes("H")) c -= 0.15;
  if (a.assumedFields.includes("L") || a.assumedFields.includes("W")) c = Math.min(c, 0.5);
  return Math.max(0.2, c);
}

export function accuracyScore(areas: ScoredArea[], deferredCount = 0): number {
  if (areas.length === 0) return 0;

  const positive = areas.filter((a) => a.priceCents > 0);
  const meanWeight = positive.length
    ? positive.reduce((n, a) => n + a.priceCents, 0) / positive.length
    : 1;

  let weightSum = 0;
  let creditSum = 0;
  for (const a of areas) {
    const w = a.priceCents > 0 ? a.priceCents : meanWeight;
    weightSum += w;
    creditSum += w * credit(a);
  }

  const base = (creditSum / weightSum) * 100;
  const deferredPenalty = Math.min(deferredCount * 2, 12);
  return Math.max(0, Math.min(100, Math.round(base - deferredPenalty)));
}
