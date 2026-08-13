// Pricing engine — pure functions, no I/O, no interface.
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
//   14 contractor offer = production hours × $60 × offer %
//   15 margin = total − contractor offer − own staff − materials cost − pass-through cost

import type {
  ProductionLineResult,
  QuoteInput,
  QuoteResult,
  Product,
  RateItem,
} from "./types.ts";

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

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

/** Step 1: base production hours for a line (no modifiers yet). */
export function productionHours(
  item: RateItem,
  quantity: number,
  coats: number,
): number {
  return hoursPerUnit(item, coats) * quantity;
}

/**
 * Step 10: litres of paint for a line, including wastage.
 * Which measurement drives it depends on the unit:
 *   - item units  → litres_per_item_per_coat (on the rate item)
 *   - lineal      → metres_per_litre (on the rate item)
 *   - area        → coverage m²/L (on the product)
 * Returns 0 when the quantity input is missing (line left uncosted for paint).
 */
export function materialLitres(
  item: RateItem,
  product: Product | null,
  quantity: number,
  coats: number,
): number {
  const wastage = (product?.wastage_pct ?? 0) / 100;
  let litres: number;

  if (item.unit === "Hours Per Item") {
    if (item.litres_per_item_per_coat == null) return 0;
    litres = quantity * coats * item.litres_per_item_per_coat;
  } else if (item.metres_per_litre != null) {
    litres = (quantity * coats) / item.metres_per_litre;
  } else if (product?.coverage != null) {
    litres = (quantity * coats) / product.coverage;
  } else {
    return 0;
  }

  return litres * (1 + wastage);
}

/** Price a whole estimate. Returns a full breakdown; every money field is cents. */
export function priceEstimate(input: QuoteInput): QuoteResult {
  // Non-negotiable #4: a level of finish must be chosen — there is no default.
  if (!input.finishMultiplier || input.finishMultiplier <= 0) {
    throw new Error(
      "Level of finish is mandatory — no default, no fallback (non-negotiable #4).",
    );
  }

  // Steps 2–5: the compounding labour modifier. Multiplication commutes, but this
  // single combined factor is applied to HOURS only, before any money conversion.
  const labourModifier =
    (input.conditionMultiplier ?? 1) * // step 2
    (input.accessMultiplier ?? 1) * // step 3
    input.finishMultiplier * // step 4
    (input.sizeMultiplier ?? 1) * // step 5
    (input.stagingMultipliers ?? []).reduce((a, b) => a * b, 1); // staging stacks

  const lines: ProductionLineResult[] = input.production.map((pl) => {
    const baseHours = productionHours(pl.item, pl.quantity, pl.coats); // step 1
    const modifiedHours = baseHours * labourModifier; // steps 2–6
    const labourCents = Math.round(modifiedHours * pl.item.charge_out_cents); // step 7
    const litres = materialLitres(pl.item, pl.product ?? null, pl.quantity, pl.coats);
    const materialCostCents = Math.round(litres * (pl.product?.price_per_litre ?? 0));
    return {
      code: pl.item.code,
      category: pl.item.category,
      baseHours,
      modifiedHours,
      labourCents,
      materialLitres: litres,
      materialCostCents,
    };
  });

  const productionHoursTotal = sum(lines.map((l) => l.modifiedHours));
  const productionLabourCents = sum(lines.map((l) => l.labourCents));

  const prepLabourCents = Math.round(
    sum((input.prep ?? []).map((p) => p.hours * p.chargeOutCents)),
  ); // step 8
  const cleaningLabourCents = Math.round(
    sum((input.cleaning ?? []).map((p) => p.hours * p.chargeOutCents)),
  ); // step 9

  const materialCostCents = sum(lines.map((l) => l.materialCostCents)); // step 10 (cost)
  const materialPriceCents = Math.round(
    materialCostCents * (1 + (input.materialsMarkup ?? 0)),
  ); // step 10 (billed)

  const sundriesCents = input.sundriesCents ?? 0; // step 11
  const passthroughPriceCents = sum((input.passthroughs ?? []).map((p) => p.priceCents)); // step 12
  const passthroughCostCents = sum((input.passthroughs ?? []).map((p) => p.costCents)); // step 12

  // Step 13: the quote total.
  const totalCents =
    productionLabourCents +
    prepLabourCents +
    cleaningLabourCents +
    materialPriceCents +
    sundriesCents +
    passthroughPriceCents;

  // Step 14: contractor offer is on production hours only.
  const contractorOfferCents = Math.round(
    productionHoursTotal *
      (input.contractorHourlyCents ?? 6000) *
      (input.contractorOfferPct ?? 1),
  );

  // Step 15: margin, net of the real pass-through cost (Hampton Street lesson).
  const marginCents =
    totalCents -
    contractorOfferCents -
    (input.ownStaffCents ?? 0) -
    materialCostCents -
    passthroughCostCents;

  return {
    lines,
    labourModifier,
    productionHours: productionHoursTotal,
    productionLabourCents,
    prepLabourCents,
    cleaningLabourCents,
    materialCostCents,
    materialPriceCents,
    sundriesCents,
    passthroughPriceCents,
    passthroughCostCents,
    totalCents,
    contractorOfferCents,
    marginCents,
  };
}
