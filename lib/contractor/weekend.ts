import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekendAvailability } from "./model";

/**
 * Weekend availability reads (Tom, 1 Sep). SERVER ONLY.
 *
 * A separate best-effort select on purpose: works_saturday / works_sunday come
 * from migration 20261221, and folding them into CONTRACTOR_COLUMNS would
 * 42703 every portal page until it runs. Here a missing column degrades to an
 * empty map — callers treat "not in the map" as unknown and hide the feature
 * rather than breaking the screen.
 */
export async function weekendAvailability(
  db: SupabaseClient,
  contractorIds: readonly string[],
): Promise<Map<string, WeekendAvailability>> {
  const out = new Map<string, WeekendAvailability>();
  if (contractorIds.length === 0) return out;
  const { data, error } = await db
    .from("contractors")
    .select("id, works_saturday, works_sunday")
    .in("id", [...contractorIds]);
  if (error || !data) return out; // pre-migration: unknown, never broken
  for (const r of data as { id: string; works_saturday: boolean | null; works_sunday: boolean | null }[]) {
    out.set(r.id, { worksSaturday: !!r.works_saturday, worksSunday: !!r.works_sunday });
  }
  return out;
}
