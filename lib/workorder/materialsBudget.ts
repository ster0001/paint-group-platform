import type { SupabaseClient } from "@supabase/supabase-js";
import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { adjustmentsFrom } from "@/lib/pricing/context";

/**
 * Materials budget vs actual on the PC job page (Tom, 4 Sep 2026):
 * "shows the materials budget (based on the materials tab) vs the actual cost
 * of materials, which updates as new invoices are matched to the job."
 *
 * BUDGET = the estimate's own materials cost — the same engine figure the
 * builder's Materials tab prints as "Materials cost" (step 10: coverage →
 * litres → wastage → product price). It is priced on the estimate's OWN rate
 * card, never the active one, for the same reason revisions are: a signed job
 * must not silently re-budget because a product price moved in Settings.
 *
 * ACTUAL = every material invoice matched to the job (material_costs rows
 * carrying this work order). Suppliers invoice inc GST and the budget is an
 * ex-GST cost, so the comparison backs GST out of the invoiced total.
 */

export type MaterialsBudget = {
  /** Null when the estimate has no priced scope to read (a manual fixture). */
  budgetCents: number | null;
  invoicedIncCents: number;
  invoicedExCents: number;
  /** invoicedEx / budget, capped for the bar; null when there is no budget. */
  pct: number | null;
  over: boolean;
};

export function invoicedExGst(incCents: number): number {
  return Math.round(incCents / 1.1);
}

export function materialsBudgetCents(
  state: Record<string, unknown> | null | undefined,
  ctx: PricingContext,
): number | null {
  const blocks = (state?.blocks as BlockInput[] | undefined) ?? null;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  if (ctx.rateItems.length === 0) return null; // no card → no honest figure
  return priceEstimateTotals(blocks, ctx, adjustmentsFrom(state ?? {})).materialsCostCents;
}

export function materialsBudget(budgetCents: number | null, invoices: readonly { amount_cents: number }[]): MaterialsBudget {
  const invoicedIncCents = invoices.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const invoicedExCents = invoicedExGst(invoicedIncCents);
  const pct = budgetCents && budgetCents > 0 ? Math.min(100, Math.round((invoicedExCents / budgetCents) * 100)) : null;
  return {
    budgetCents,
    invoicedIncCents,
    invoicedExCents,
    pct,
    over: budgetCents != null && budgetCents >= 0 && invoicedExCents > budgetCents,
  };
}

/**
 * The estimate's pricing inputs on its own rate card (falls back to the active
 * card for an estimate that never recorded one). Uncached on purpose — this
 * runs once per PC job page view, not once per customer tap.
 */
export async function loadEstimatePricing(
  supabase: SupabaseClient,
  estimateId: string,
): Promise<{ state: Record<string, unknown> | null; ctx: PricingContext }> {
  const { data: est } = await supabase
    .from("estimates").select("builder_state, rate_card_id").eq("id", estimateId).maybeSingle();
  const rateCardId = (est as { rate_card_id?: string | null } | null)?.rate_card_id ?? null;
  const [rateItems, products, modifiers, settings] = await Promise.all([
    rateCardId
      ? supabase.from("rate_items").select("*").eq("rate_card_id", rateCardId)
      : supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  return {
    state: ((est as { builder_state?: Record<string, unknown> | null } | null)?.builder_state) ?? null,
    ctx: {
      rateItems: (rateItems.data ?? []) as PricingContext["rateItems"],
      products: (products.data ?? []) as PricingContext["products"],
      modifiers: (modifiers.data ?? []) as PricingContext["modifiers"],
      settings: (settings.data ?? []) as PricingContext["settings"],
    },
  };
}
