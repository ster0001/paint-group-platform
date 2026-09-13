// Pricing engine — the rate-card arithmetic the production path shares.
//
// C17 (⚑A): this file once carried a second, complete `priceEstimate` with
// the build plan's order of operations and the mandatory level-of-finish
// guard. Nothing called it — production prices through lib/pricing/estimate.ts
// (`priceEstimateTotals`), which defaults a missing finish modifier to ×1.
// The dead exports are gone; the two rate-card helpers below are what the
// review gate, capture and the systems derivation actually use. Whether the
// finish guard moves onto the production path is Tom's ruling (⚑A) — see
// lib/pricing/finish-level.ts for the recorded split.
//
// Follows the build plan's order of operations exactly. The order matters: every
// LABOUR modifier compounds on the production HOURS (steps 1–6) BEFORE the hours
// become money (step 7); materials, sundries and pass-throughs are ADDED after
// (steps 8–12) and are never touched by the labour modifiers.
//
//   1  quantity × production rate (for the coat count from colour rules)
//   2  × condition modifier
//   3  × access modifier
//   4  × level-of-finish modifier   (mandatory)
//   5  × job-size modifier
//   6  = hours
//   7  hours × charge-out rate (interior/exterior, by line)
//   8  + prep lines (hours-based)
//   9  + cleaning line
//   10 + materials (coverage → litres → wastage → cost → markup)
//   11 + sundries (per job)
//   12 + pass-through lines (cost + markup; cost recorded separately)
//   13 = quote total
//   14 contractor offer = ALL estimated hours (production + prep + cleaning) × $60 × offer %
//      (calibrated against real work orders — see step 14 below)
//   15 margin = total − contractor offer − own staff − materials cost − pass-through cost

import type { RateItem } from "./types.ts";

/**
 * Marginal-coat rule (rate card, Decision 2): first coat 100%, each extra coat 75%.
 * m(1)=1, m(2)=1.75, m(3)=2.5, m(4)=3.25 …
 */
export function coatMultiplier(coats: number): number {
  if (coats < 1) throw new Error(`coats must be >= 1, got ${coats}`);
  return 1 + 0.75 * (coats - 1);
}

/**
 * Hours to do ONE unit of quantity at the given coat count, before modifiers.
 * - "Hours Per Item" units: the rate IS hours per item.
 * - everything else ("M2", "M2 Per Hour", "Lineal Metres"): the rate is
 *   quantity-per-hour, so hours-per-unit is its reciprocal.
 * For coats 1–3 the rate card's own column is authoritative; for 4+ (or a missing
 * column) we extrapolate with the same marginal-coat rule the card was built on.
 */
export function hoursPerUnit(item: RateItem, coats: number): number {
  const isItem = item.unit === "Hours Per Item";
  const rates: Record<number, number | null> = {
    1: item.rate_1_coat,
    2: item.rate_2_coat,
    3: item.rate_3_coat,
  };

  const toHpu = (rate: number): number => (isItem ? rate : 1 / rate);

  const direct = rates[coats];
  if (coats >= 1 && coats <= 3 && direct != null) {
    return toHpu(direct); // authoritative table value
  }

  // Derive from whatever coat column is available, via the marginal-coat rule.
  const refN = [1, 2, 3].find((n) => rates[n] != null);
  if (refN == null) {
    throw new Error(`rate item "${item.code}" has no coat rates to price from`);
  }
  const hpuRef = toHpu(rates[refN] as number);
  const hpuOneCoat = hpuRef / coatMultiplier(refN);
  return hpuOneCoat * coatMultiplier(coats);
}
