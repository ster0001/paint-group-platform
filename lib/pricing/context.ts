import type { SupabaseClient } from "@supabase/supabase-js";
import type { Adjustments, PricingContext } from "./estimate";

/**
 * The one way a server route assembles lib/pricing's inputs. This existed as
 * an inline pattern in the capture rooms route and the capture page before the
 * wizard needed a third copy — the queries and the Adjustments defaults must
 * stay identical everywhere, so they live here now.
 */

export async function loadPricingContext(supabase: SupabaseClient): Promise<PricingContext> {
  const [rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  return {
    rateItems: (rateItemsRes.data ?? []) as PricingContext["rateItems"],
    products: (productsRes.data ?? []) as PricingContext["products"],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
}

/** The estimate-level adjustments as stored in builder_state, with the
 * builder's own defaults for anything absent. */
export function adjustmentsFrom(state: Record<string, unknown>): Adjustments {
  return {
    modSel: (state.modSel as Record<string, string>) ?? {},
    materials: (state.materials as Record<string, string>) ?? {},
    discountPct: (state.discountPct as number) ?? 0,
    discountMode: (state.discountMode as "pct" | "fixed") ?? "pct",
    discountFixedCents: (state.discountFixedCents as number) ?? 0,
    hourlyRateOverride: (state.hourlyRateOverride as number | null) ?? null,
    contractorRateOverride: (state.contractorRateOverride as number | null) ?? null,
  };
}
