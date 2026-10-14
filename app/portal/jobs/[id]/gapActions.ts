"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { demoMaterialRequested, demoNoWorkRequested } from "@/lib/demo/robots";

/**
 * Induction Step 3b — two things a painter raises from the job, each ONE
 * definer RPC, one wo_events row and one PC Command card (the card clears
 * when the office answers). On the practice job the robot office answers.
 */
export type GapResult = { ok: true; message: string } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  "error:not_yours": "That job isn't yours.",
  "error:not_live": "This job isn't under way — ask the office instead.",
  "error:no_item": "Say what you need.",
  "error:future_day": "Only today — or yesterday if it slipped.",
  "error:too_old": "That was more than a day ago — tell the office instead.",
  "error:no_day": "Pick the day.",
};

export async function requestMaterialAction(raw: unknown): Promise<GapResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), item: z.string().trim().min(1).max(200), quantity: z.string().trim().max(60).default(""), note: z.string().trim().max(300).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Say what you need and how much." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_request_material", { p_work_order_id: v.workOrderId, p_item: v.item, p_quantity: v.quantity, p_note: v.note });
  if (error) { reportError(error, { where: "portal.requestMaterial", extra: { workOrderId: v.workOrderId } }); return { ok: false, message: "Couldn't send that — check your signal and try again." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: WORDING[r] ?? `Couldn't send that (${r.replace("error:", "")}).` };
  revalidatePath(`/portal/jobs/${v.workOrderId}`); revalidatePath("/pc");
  // 12 Demo Street: the robot office orders it a few seconds later.
  await demoMaterialRequested(v.workOrderId, r.slice(3));
  return { ok: true, message: "Sent to the office. The reply shows here." };
}

export async function requestNoWorkDayAction(raw: unknown): Promise<GapResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(300).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the day and say why." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_request_no_work_day", { p_work_order_id: v.workOrderId, p_day: v.day, p_reason: v.reason });
  if (error) { reportError(error, { where: "portal.requestNoWork", extra: { workOrderId: v.workOrderId } }); return { ok: false, message: "Couldn't send that — check your signal and try again." }; }
  const r = String(data ?? "");
  if (r === "ok:already") return { ok: true, message: "That day is already marked no work." };
  if (!r.startsWith("ok:")) return { ok: false, message: WORDING[r] ?? `Couldn't send that (${r.replace("error:", "")}).` };
  revalidatePath(`/portal/jobs/${v.workOrderId}`); revalidatePath("/pc");
  // 12 Demo Street: the robot office confirms a few seconds later.
  await demoNoWorkRequested(v.workOrderId, r.slice(3));
  return { ok: true, message: "Sent to the office. When they confirm, no reminder counts for that day." };
}
