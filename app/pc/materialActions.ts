"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";

/**
 * The office answers a painter's materials request (induction Step 3b):
 * ordered (with where and when to collect) or declined (with why). The reply
 * shows on the painter's job; the PC Command card clears itself because the
 * row is no longer "requested".
 */
export type MaterialReplyResult = { ok: true; message: string } | { ok: false; message: string };

export async function replyMaterialRequestAction(raw: unknown): Promise<MaterialReplyResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), requestId: z.string().uuid(), status: z.enum(["ordered", "declined"]), reply: z.string().trim().max(400).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that reply." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_material_request_reply", { p_id: v.requestId, p_status: v.status, p_reply: v.reply });
  if (error) { reportError(error, { where: "materials.reply" }); return { ok: false, message: "Couldn't send that reply — it has been reported." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: r === "error:not_staff" ? "Only the office can reply." : r.startsWith("error:already_") ? "That request was already answered." : r };
  revalidatePath(`/pc/wo/${v.workOrderId}`); revalidatePath("/pc"); revalidatePath(`/portal/jobs/${v.workOrderId}`);
  return { ok: true, message: v.status === "ordered" ? "Marked ordered — the painter sees your reply on the job." : "Declined — the painter sees why on the job." };
}
