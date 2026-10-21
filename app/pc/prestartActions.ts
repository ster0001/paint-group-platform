"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import { reportError } from "@/lib/monitoring/report";

/**
 * Tom, 8 Oct 2026: a short note on a dashboard reminder — a zod-checked
 * translation over one staff-checked RPC (migration 20270243); no rule lives
 * here. (The pre-start materials / equipment list action that lived beside it
 * went in Movements Session 7: the lists are material lines and chips now.)
 */

export type NoteResult = { ok: true } | { ok: false; message: string };

const MIGRATION_NEEDED = "This needs database migration 20270243 run first — nothing was saved.";

function fromRpc(fn: string, data: unknown, error: { message: string } | null, where: string): NoteResult {
  if (error) {
    if (isMissingRpc(error.message, fn)) return { ok: false, message: MIGRATION_NEEDED };
    reportError(new Error(error.message), { where });
    return { ok: false, message: "That didn't save — try again in a moment." };
  }
  const s = String(data ?? "");
  if (s.startsWith("ok:")) return { ok: true };
  const reason = s.replace("error:", "");
  if (reason === "not_staff") return { ok: false, message: "Only the office can write this." };
  if (reason === "too_long") return { ok: false, message: "That's too long to save — shorten it." };
  if (reason === "not_found") return { ok: false, message: "That job isn't there any more — reload the page." };
  return { ok: false, message: reason.replace(/_/g, " ") || "That didn't save." };
}

const noteInput = z.object({
  itemKey: z.string().min(1).max(200),
  note: z.string().max(280),
});

/** A short note on one dashboard reminder; an empty note clears it. */
export async function saveWorkItemNote(raw: unknown): Promise<NoteResult> {
  const p = noteInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Keep the note under 280 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pc_set_work_item_note", {
    p_item_key: p.data.itemKey, p_note: p.data.note,
  });
  const r = fromRpc("pc_set_work_item_note", data, error, "pc.dashboard.saveNote");
  if (r.ok) revalidatePath("/pc");
  return r;
}
