import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { EXTERIOR_TYPICALS_VERSION, type ExteriorTypicalRow } from "./exterior-typicals";

/**
 * The `exterior_typicals` rows (Exterior wizard v2, S2) — one read, shared by
 * the estimate page, the draft tree and the submit route.
 *
 * A rejected select is NOT "no rows": until migration 20270278 is live the
 * table does not exist, and after it a missing policy would answer the same
 * empty array. Either way the error is reported and the built-in list in
 * `exterior-typicals.ts` carries the house (every reader falls back through
 * `typicalFor`), so the wizard never draws nothing — but nothing is silent.
 */
export async function loadExteriorTypicals(db: SupabaseClient, where = "exterior_typicals"): Promise<ExteriorTypicalRow[]> {
  const { data, error } = await db
    .from("exterior_typicals")
    .select("key, name, storeys, roof, front_m, side_m, wall_h_m, gable_rise_m, usual_walls, walls_painted, shared_sides, verandah, source")
    .eq("version", EXTERIOR_TYPICALS_VERSION);
  if (error) {
    reportError(error, { where, bestEffort: true, extra: { note: "falling back to the built-in exterior typicals" } });
    return [];
  }
  return (data ?? []).map((r) => ({
    ...r,
    front_m: Number(r.front_m), side_m: Number(r.side_m), wall_h_m: Number(r.wall_h_m),
    gable_rise_m: r.gable_rise_m == null ? null : Number(r.gable_rise_m),
    shared_sides: Array.isArray(r.shared_sides) ? r.shared_sides : [],
  })) as ExteriorTypicalRow[];
}
