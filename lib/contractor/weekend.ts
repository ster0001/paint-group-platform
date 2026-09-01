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
/** The contractor's mobile (20261223) — same best-effort rule: null means
 *  "column not there yet OR not set", and callers hide the feature. The
 *  wrapped shape distinguishes pre-migration (available:false) from unset. */
export async function contractorPhone(
  db: SupabaseClient,
  contractorId: string,
): Promise<{ available: boolean; phone: string | null }> {
  const { data, error } = await db
    .from("contractors").select("id, phone").eq("id", contractorId).maybeSingle();
  if (error) return { available: false, phone: null };
  return { available: true, phone: ((data as { phone?: string | null } | null)?.phone ?? null) };
}

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
