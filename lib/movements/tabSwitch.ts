import type { SupabaseClient } from "@supabase/supabase-js";
import { movementsSettingsFrom } from "./types";

/**
 * Session 8's rollback switch: Settings → Movements → "Show the Movements tab". Off hides the
 * tab in PC Command and sends its routes back to the dashboard; the data, the chips and the
 * texts' drafts are untouched. A read that fails leaves the tab ON — hiding it on an error
 * would look like the rollback had been pulled.
 */
export async function movementsTabOn(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "movements").maybeSingle();
  if (error) return true;
  return movementsSettingsFrom(data?.value).movementsTab;
}
