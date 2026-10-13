import type { SupabaseClient } from "@supabase/supabase-js";
import { materialsBreakdown, priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { adjustmentsFrom } from "@/lib/pricing/context";
import { materialColourKey, materialRowKey } from "./materials";
import type { WorkOrderDoc } from "./snapshot";

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

/**
 * The estimate's litres and cost for each material row on the job sheet (Tom,
 * 13 Oct 2026: "show the estimate amount and cost in the materials section").
 * Each surface on the frozen sheet is looked up by its key in the engine's
 * per-surface figures and summed into its product × colour row; a line
 * item's linked paint joins the row with the same product × colour. Priced on
 * the estimate's own card, like the budget. Null when there is nothing honest
 * to price from.
 */
export type MaterialRowEstimate = { litres: number; costCents: number };

export function materialRowEstimates(
  doc: Pick<WorkOrderDoc, "areas" | "materials"> | null | undefined,
  state: Record<string, unknown> | null | undefined,
  ctx: PricingContext,
): Map<string, MaterialRowEstimate> | null {
  const blocks = (state?.blocks as BlockInput[] | undefined) ?? null;
  if (!doc || !Array.isArray(blocks) || blocks.length === 0 || ctx.rateItems.length === 0) return null;
  const est = materialsBreakdown(blocks, ctx, adjustmentsFrom(state ?? {}));
  const rows = new Set((doc.materials ?? []).map(materialRowKey));
  const out = new Map<string, MaterialRowEstimate>();
  const add = (key: string, litres: number, costCents: number) => {
    if (!rows.has(key) || !(litres > 0)) return;
    const g = out.get(key) ?? { litres: 0, costCents: 0 };
    g.litres += litres;
    g.costCents += costCents;
    out.set(key, g);
  };
  for (const a of doc.areas ?? []) {
    for (const s of a.surfaces ?? []) {
      if (!s.product) continue;
      const hit = est.surfaces.get(s.key);
      if (hit) add(s.colourKey ?? s.product, hit.litres, hit.costCents);
    }
  }
  for (const l of est.lines) {
    if (l.isOption) continue; // a ticked option line is merged by the database, not traceable here
    add(materialColourKey(l.productName, l.colourName), l.litres, l.costCents);
  }
  for (const g of out.values()) g.litres = Math.round(g.litres * 100) / 100;
  return out;
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
