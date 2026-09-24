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
): { rateCents: number; baseCents: number } {
  const workingAdj = adjustmentsFrom(working);
  const rates = resolveRates(ctx, workingAdj);
  const rateCents = rates.contractorRateOverride != null
    ? Math.round(rates.contractorRateOverride * 100)
    : rates.contractorHourlyCents;
  const baseAdj = { ...adjustmentsFrom(accepted), contractorRateOverride: workingAdj.contractorRateOverride };
  const blocks = (Array.isArray(accepted.blocks) ? accepted.blocks : []) as BlockInput[];
  const baseCents = priceEstimateTotals(blocks, ctx, baseAdj).contractorOfferCents;
  return { rateCents, baseCents };
}
