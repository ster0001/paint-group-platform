import { adjustmentsFrom } from "@/lib/pricing/context";
import { priceEstimateTotals, resolveRates, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import type { RevisionState } from "./diff";

/**
 * Tom, 24 Sep 2026: the contractor rate set in the revision working scope is
 * what the painter is offered. Two figures the database needs, computed by
 * the ONE pricing module:
 *
 *   rateCents — the working scope's contractor $/hr in cents: the estimate's
 *               "Contractor rate" override, else the rate card's.
 *   baseCents — the ACCEPTED scope priced at that rate: the job's base pay
 *               before variations, i.e. what issue_work_order set, moved to
 *               the current rate. Revision changes ride on top as variation
 *               deltas (hours × rateCents), so base + deltas = the working
 *               scope at the new rate, with nothing counted twice.
 */
export function revisionContractorPay(
  accepted: RevisionState,
  working: RevisionState,
  ctx: PricingContext,
): { rateCents: number; baseCents: number; acceptedRateCents: number; baseHours: number } {
  const rateOf = (adj: ReturnType<typeof adjustmentsFrom>) => {
    const rates = resolveRates(ctx, adj);
    return rates.contractorRateOverride != null
      ? Math.round(rates.contractorRateOverride * 100)
      : rates.contractorHourlyCents;
  };
  const workingAdj = adjustmentsFrom(working);
  const acceptedAdj = adjustmentsFrom(accepted);
  const rateCents = rateOf(workingAdj);
  const baseAdj = { ...acceptedAdj, contractorRateOverride: workingAdj.contractorRateOverride };
  const blocks = (Array.isArray(accepted.blocks) ? accepted.blocks : []) as BlockInput[];
  const base = priceEstimateTotals(blocks, ctx, baseAdj);
  // Tom, 13 Oct 2026: with a painter on the job a new rate is a pay change
  // for them to accept — the database needs the rate the job was agreed at
  // (when it has not stamped one) and the base hours the difference applies to.
  return { rateCents, baseCents: base.contractorOfferCents, acceptedRateCents: rateOf(acceptedAdj), baseHours: base.contractorHours };
}
