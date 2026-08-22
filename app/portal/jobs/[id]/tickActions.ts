"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type PrepResult = { ok: true } | { ok: false; message: string };

/**
 * Ticking a completion-prep item. The rules are the RPC's; this only turns its
 * answer into something worth reading on a phone.
 */
export async function tickPrepItem(raw: unknown): Promise<PrepResult> {
  const parsed = z.object({ itemId: z.string().uuid(), done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_checklist_item", {
    p_item_id: parsed.data.itemId, p_done: parsed.data.done,
  });
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that just now." };
}
