/**
 * The contractor's adjusted pay (addendum A3, feeding brief Step 5).
 *
 * One rule, one place: the offer, plus every ACCEPTED addition's delta, minus
 * every acknowledged credit — where a credit's figure is the engine's
 * hours-derived delta unless the removal hit started work, in which case the
 * PC's manually-set deduction is the ONLY figure that counts (⚑10: deductions
 * are never automatic; an unset manual deduction deducts nothing yet).
 *
 * Only `contractor_accepted` rows count — the terminal state both the accept
 * and the acknowledge/deduction paths land on. `customer_approved` is the
 * customer's yes; the contractor side isn't settled until it advances.
 */

export type PayVariation = {
  status: string;
  credit: boolean;
  contractor_delta_cents: number | null;
  deduction_cents: number | null;
  needs_manual_deduction: boolean;
};

/** Signed contribution of one variation to the contractor's pay. */
export function contractorVariationCents(v: PayVariation): number {
  if (v.status !== "contractor_accepted") return 0;
  if (!v.credit) return v.contractor_delta_cents ?? 0;
  const deduction = v.needs_manual_deduction
    ? v.deduction_cents ?? 0
    : v.deduction_cents ?? v.contractor_delta_cents ?? 0;
  return deduction === 0 ? 0 : -deduction;
}

export function contractorVariationsCents(variations: readonly PayVariation[]): number {
  return variations.reduce((sum, v) => sum + contractorVariationCents(v), 0);
}

/** Offer + Σ variation contributions, floored at zero (pay can't go negative). */
export function contractorAdjustedCents(
  offerCents: number,
  variations: readonly PayVariation[],
): number {
  return Math.max(0, offerCents + contractorVariationsCents(variations));
}
