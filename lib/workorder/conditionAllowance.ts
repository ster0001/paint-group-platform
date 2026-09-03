/**
 * The condition allowance, in the painter's own units — HOURS.
 *
 * A job marked Poor / Heritage / Weathered prices its painting hours through
 * the Condition modifier (lib/pricing/estimate.ts: `paintingHr = base × jobMod`),
 * so the contractor's hours, the offer's hours allowance and the days booked
 * on the board already carry the uplift. What nobody could SEE was how much
 * of a surface's hours was "extra prep for the condition" — the job sheet
 * just showed a bigger number. This helper splits it back out so the work
 * order can say "extra prep allowed for: +N h" in so many words.
 *
 * Pure. The caller passes the FINAL painting hours (post-modifier) and the
 * Condition multiplier alone; access / finish / size stay inside the base.
 */
export function conditionExtraHours(paintingHr: number, conditionMultiplier: number): number {
  if (!Number.isFinite(paintingHr) || paintingHr <= 0) return 0;
  if (!Number.isFinite(conditionMultiplier) || conditionMultiplier <= 1) return 0;
  return round2(paintingHr - paintingHr / conditionMultiplier);
}

/** The condition line the contractor reads on the job sheet and the offer. */
export function conditionAllowanceLine(c: { label: string; multiplier: number; extraHours: number } | null | undefined): string | null {
  if (!c || !(c.extraHours > 0)) return null;
  const label = c.label.replace(/\s*\(×[^)]*\)\s*$/, "").trim();
  return `${label} — extra prep allowed for: +${c.extraHours.toFixed(1)} h across the job (×${c.multiplier} on painting hours)`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
