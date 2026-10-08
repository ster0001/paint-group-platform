import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

/**
 * Reads for Tom's 8 Oct 2026 PC Command asks (migration 20270243). Both return
 * a `failure` line alongside the data: a rejected read must say so on screen,
 * never render as "nothing written yet" (CLAUDE.md, 16 Sep).
 */

export type PrestartList = { materials: string; equipment: string; updatedAt: string | null };

const missingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");

/** The materials / equipment lists written in a job's pre-start view. */
export async function loadPrestartList(
  supabase: SupabaseClient, workOrderId: string,
): Promise<{ list: PrestartList; failure: string | null }> {
  const empty: PrestartList = { materials: "", equipment: "", updatedAt: null };
  const { data, error } = await supabase.from("wo_prestart_lists")
    .select("materials, equipment, updated_at").eq("work_order_id", workOrderId).maybeSingle();
  if (error) {
    if (missingTable(error)) return { list: empty, failure: "The materials and equipment lists need database migration 20270243 run first." };
    reportError(error, { where: "pc.prestart.loadList" });
    return { list: empty, failure: "The saved materials and equipment lists could not be read — reload before you type over them." };
  }
  const row = data as { materials: string; equipment: string; updated_at: string } | null;
  return { list: row ? { materials: row.materials, equipment: row.equipment, updatedAt: row.updated_at } : empty, failure: null };
}

/** The office's notes on the given reminder keys, as key → note. */
export async function loadWorkItemNotes(
  supabase: SupabaseClient, keys: string[],
): Promise<{ notes: Map<string, string>; failure: string | null }> {
  const notes = new Map<string, string>();
  if (keys.length === 0) return { notes, failure: null };
  const { data, error } = await supabase.from("work_item_notes").select("item_key, note").in("item_key", keys);
  if (error) {
    if (missingTable(error)) return { notes, failure: "Notes on reminders need database migration 20270243 run first." };
    reportError(error, { where: "pc.dashboard.loadNotes" });
    return { notes, failure: "Your notes on these reminders could not be read just now — they are not lost." };
  }
  for (const r of (data ?? []) as { item_key: string; note: string }[]) notes.set(r.item_key, r.note);
  return { notes, failure: null };
}
