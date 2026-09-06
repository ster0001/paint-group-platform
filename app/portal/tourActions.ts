"use server";

import { createClient } from "@/lib/supabase/server";

/** The contractor finished or skipped the tour: record it on their own row (RPC, RLS-safe). */
export async function markTourSeen(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_tour_seen");
  return { ok: !error && String(data ?? "") === "ok" };
}
