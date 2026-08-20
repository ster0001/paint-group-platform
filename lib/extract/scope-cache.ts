import type { SupabaseClient } from "@supabase/supabase-js";
import { SCOPE_VERSION, type ScopeRule } from "./scope";

/**
 * R5: the scope rules, cached per process.
 *
 * `room_type_scope_rules` is versioned reference data — it describes what we
 * paint in a bedroom, not anything about one customer — and it was being
 * re-read on every single tap in the customer editor alongside the pricing
 * context. Same reasoning and same short TTL as loadPricingContext: nothing
 * per-user is cached, a stale read self-heals within seconds, and an empty
 * or failed read is never cached (that would silently strip every tile grid
 * on the page).
 */

const CACHE_TTL_MS = 20_000;
let cached: { at: number; rules: ScopeRule[] } | null = null;

export async function loadScopeRules(db: SupabaseClient): Promise<ScopeRule[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rules;
  const { data, error } = await db
    .from("room_type_scope_rules")
    .select("room_type, surface_type, is_option, requires_confirm, notes")
    .eq("version", SCOPE_VERSION);
  const rules = (data ?? []) as ScopeRule[];
  if (!error && rules.length > 0) cached = { at: now, rules };
  return rules;
}
