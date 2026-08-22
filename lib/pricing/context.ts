import type { SupabaseClient } from "@supabase/supabase-js";
import type { Adjustments, PricingContext } from "./estimate";

/**
 * The one way a server route assembles lib/pricing's inputs. This existed as
 * an inline pattern in the capture rooms route and the capture page before the
 * wizard needed a third copy — the queries and the Adjustments defaults must
 * stay identical everywhere, so they live here now.
 */

/**
 * R5 (Tom, 20 Aug: "every click autosaves… can we speed this up").
 *
 * Four queries ran on EVERY customer tap, and the customer editor taps a
 * lot. All four read reference data that is the same for every customer and
 * changes only when staff edit the rate card or Settings — so a warm server
 * can answer from memory and spend its round trips on the estimate itself.
 *
 * The cache is deliberately dumb and deliberately short:
 *  - REFERENCE DATA ONLY — no estimate, no customer row, nothing that could
 *    leak across people. These four tables ARE staff-only under RLS, so the
 *    question worth asking is whether a cache filled by one client can hand
 *    rows to another that RLS would have withheld. Checked, 20 Aug: every
 *    caller is either staff-gated (proving, capture, the rooms route) or the
 *    anonymous-customer path, which reads through the service client anyway;
 *    getWizardActor answers "none" for a contractor or any other signed-in
 *    non-staff user, so they never reach a pricing load at all. And none of
 *    this context crosses the wire — customerPayload emits a range, never a
 *    rate. Re-check this if a new caller passes a client that is neither.
 *  - A SHORT TTL, so a rate change a staff member makes shows up within
 *    seconds without anyone clearing anything. The TTL is the ONLY
 *    invalidation: settings and rates are edited straight from the browser
 *    under RLS, so there is no server hook an explicit invalidate could hang
 *    off. An exported `invalidatePricingContext` used to sit here promising a
 *    discipline nothing followed — worse than no hook at all.
 *  - PER-PROCESS. Serverless gives each instance its own copy; a miss just
 *    means the old four queries.
 */
const CACHE_TTL_MS = 20_000;
let cached: { at: number; ctx: PricingContext } | null = null;

export async function loadPricingContext(supabase: SupabaseClient): Promise<PricingContext> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.ctx;

  const [rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as PricingContext["rateItems"],
    products: (productsRes.data ?? []) as PricingContext["products"],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  // A failed read must never be cached as an empty rate card — that would
  // price a whole estimate at zero for as long as the TTL lasts.
  const usable = ctx.rateItems.length > 0 && !rateItemsRes.error && !settingsRes.error;
  if (usable) cached = { at: now, ctx };
  return ctx;
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
