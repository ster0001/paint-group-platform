import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { RateItem, Product } from "@/lib/pricing/types";
import { reportError } from "@/lib/monitoring/report";

type Db = SupabaseClient;

/**
 * The estimate's own pricing context. rate_card_id can be null on ancient
 * rows — fall back to the active card, which is then also what the builder
 * showed. Never the active card for an estimate that HAS one: a signed job
 * must not silently reprice on a newer card.
 */
export async function estimatePricingContext(supabase: Db, rateCardId: string | null): Promise<{ ctx: PricingContext; cardId: string | null }> {
  let cardId = rateCardId;
  if (!cardId) {
    const { data: active, error } = await supabase.from("rate_cards").select("id").eq("is_active", true).single();
    if (error) reportError(error, { where: "revision.pricingContext.activeCard", bestEffort: true });
    cardId = active?.id ?? null;
  }
  const [rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("rate_items").select("*").eq("rate_card_id", cardId ?? ""),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("*").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  for (const r of [rateItemsRes, productsRes, modifiersRes, settingsRes]) {
    if (r.error) reportError(r.error, { where: "revision.pricingContext", bestEffort: true });
  }
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as unknown as RateItem[],
    products: (productsRes.data ?? []) as unknown as Product[],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  return { ctx, cardId };
}
