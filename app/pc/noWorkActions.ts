"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";

/**
 * R10 — "No work today": the PC marks a booked day as not worked (rain, a
 * locked site), today or a past day, with a reason. That day's reminder
 * moments are skipped and leave every count, texts already sent or not.
 */
export type NoWorkResult = { ok: true; message: string } | { ok: false; message: string };
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function setNoWorkDayAction(raw: unknown): Promise<NoWorkResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), day: ymd, reason: z.string().trim().max(300).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the day." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_set_no_work_day", { p_work_order_id: v.workOrderId, p_day: v.day, p_reason: v.reason });
  if (error) { reportError(error, { where: "noWork.set" }); return { ok: false, message: error.code === "42883" ? "Not switched on yet (migration 20270227)." : error.message }; }
  const r = String(data ?? "");
  const wording: Record<string, string> = { "error:future_day": "Only today or a past day — the future is not known yet.", "error:not_staff": "You don't have permission to do that.", "error:work_order_not_found": "That job no longer exists." };
  if (!r.startsWith("ok:")) return { ok: false, message: wording[r] ?? r };
  revalidatePath(`/pc/wo/${v.workOrderId}`); revalidatePath("/pc/schedule"); revalidatePath(`/portal/jobs/${v.workOrderId}`);
  const n = Number(r.slice(3)) || 0;
  return { ok: true, message: n ? `No work that day — ${n} reminder moment${n === 1 ? "" : "s"} skipped; it is not counted.` : "No work that day — recorded. No reminder moment fell on it." };
}

/**
 * Induction Step 3b: a painter asked for a day to be marked no work. Confirm
 * runs the same wo_set_no_work_day as the button above (through the RPC);
 * decline keeps the day scored and tells the painter why on the job.
 */
export async function decideNoWorkDayAction(raw: unknown): Promise<NoWorkResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), flagId: z.string().uuid(), confirm: z.boolean(), note: z.string().trim().max(300).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that request." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_decide_no_work_day", { p_flag_id: v.flagId, p_confirm: v.confirm, p_note: v.note });
  if (error) { reportError(error, { where: "noWork.decide" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: r === "error:not_found" ? "That request is gone — it may already be decided." : r };
  revalidatePath(`/pc/wo/${v.workOrderId}`); revalidatePath("/pc"); revalidatePath("/pc/schedule"); revalidatePath(`/portal/jobs/${v.workOrderId}`);
  return { ok: true, message: v.confirm ? "Confirmed — no work that day; its reminder moments are not counted." : "Declined — that day stays a work day. The painter sees it on the job." };
}

export async function clearNoWorkDayAction(raw: unknown): Promise<NoWorkResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), day: ymd }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the day." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_clear_no_work_day", { p_work_order_id: v.workOrderId, p_day: v.day });
  if (error) { reportError(error, { where: "noWork.clear" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: r === "error:not_found" ? "That day was not marked." : r };
  revalidatePath(`/pc/wo/${v.workOrderId}`); revalidatePath("/pc/schedule"); revalidatePath(`/portal/jobs/${v.workOrderId}`);
  return { ok: true, message: "Cleared — that day counts again." };
}
