"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";

/** The painter marks a call back fixed, with a photo (⚑22). The office still has to confirm and close it. */
export type MarkFixedResult = { ok: true; message: string } | { ok: false; message: string };

export async function markCallbackFixedAction(raw: unknown): Promise<MarkFixedResult> {
  const parsed = z.object({
    callbackId: z.string().uuid(), workOrderId: z.string().uuid(),
    note: z.string().trim().max(1000).default(""),
    photoIds: z.array(z.string().uuid()).min(1, "Add a photo of the fix.").max(20),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Add a photo of the fix." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_mark_fixed", { p_callback_id: v.callbackId, p_note: v.note, p_photo_ids: v.photoIds });
  if (error) { reportError(error, { where: "callbacks.markFixed" }); return { ok: false, message: "Could not save that — it has been reported. Try again." }; }
  const r = String(data ?? "");
  const wording: Record<string, string> = {
    "error:not_yours": "That call back is not on your jobs.",
    "error:closed": "The office has already closed this call back.",
    "error:photo_required": "Add a photo of the fix first.",
    "error:not_found": "That call back no longer exists.",
  };
  if (!r.startsWith("ok:")) return { ok: false, message: wording[r] ?? "Could not save that. Try again." };
  revalidatePath(`/portal/jobs/${v.workOrderId}`); revalidatePath("/portal");
  return { ok: true, message: r === "ok:already" ? "Already marked fixed — the office will confirm it." : "Marked fixed. The office confirms it and closes the call back." };
}
