"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CALLBACK_REASONS, CALLBACK_SOURCES } from "@/lib/callbacks/model";
import { notifyCallbackBooked } from "@/lib/callbacks/notify";
import { runPainterStatus } from "@/lib/painterStatus/run";

/** Message 7, best-effort in the background: the painter booked to fix it is told the day. */
function tellPainter(callbackId: string) {
  const service = createServiceClient();
  if (service) after(() => notifyCallbackBooked(service, callbackId));
}

/**
 * The office's side of a call back (brief Step 3): log one (any of the four
 * routes), book or move its return visit, change its reason, confirm and
 * close it, or — the owner only — void one logged in error. Every write is
 * the RPC's; nothing here decides a status or touches money.
 */
const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type CallbackActionResult = { ok: true; id: string; attached: boolean; message: string } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  not_owner: "Only the owner can void a call back. The PC can change its reason instead.",
  bad_source: "That is not one of the four ways a call back is logged.",
  bad_reason: "Pick Workmanship or Not workmanship.",
  bad_dates: "The return visit ends before it starts.",
  work_order_not_found: "That job no longer exists.",
  no_painter: "No painter is on this job, so there is nobody the call back is about.",
  fixer_not_found: "That painter no longer exists.",
  not_found: "That call back no longer exists.",
  closed: "That call back is already closed.",
  reason_required: "Say why it is being voided.",
  no_start_date: "Pick the day of the return visit.",
};
const word = (r: string) => WORDING[r.replace(/^error:/, "")] ?? r.replace(/^error:/, "").replace(/_/g, " ");

/** §4.4: a call back logged, voided or changed recomputes the painter it counts against. */
async function recompute(callbackIdOrWo: { callbackId?: string; workOrderId: string }) {
  const service = createServiceClient();
  if (!service) return;
  after(async () => {
    const { data, error } = await service.from("wo_callbacks").select("painter_id").eq("work_order_id", callbackIdOrWo.workOrderId).limit(5);
    if (error) { reportError(error, { where: "callbacks.painterStatus" }); return; }
    const ids = [...new Set(((data ?? []) as { painter_id: string }[]).map((r) => r.painter_id))];
    for (const id of ids) await runPainterStatus(service, id);
  });
}

function refresh(workOrderId?: string) {
  if (workOrderId) revalidatePath(`/pc/wo/${workOrderId}`);
  revalidatePath("/pc"); revalidatePath("/pc/flow"); revalidatePath("/pc/schedule"); revalidatePath("/portal");
}

export async function logCallbackAction(raw: unknown): Promise<CallbackActionResult> {
  const parsed = z.object({
    workOrderId: uuid,
    source: z.enum(CALLBACK_SOURCES),
    reason: z.enum(CALLBACK_REASONS).default("workmanship"),
    reportedOn: ymd.nullish(),
    description: z.string().trim().max(2000).default(""),
    photoIds: z.array(uuid).max(40).default([]),
    returnStart: ymd.nullish(),
    returnEnd: ymd.nullish(),
    fixedBy: uuid.nullish(),
    qaCheckId: uuid.nullish(),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the call back's details and try again." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_log", {
    p_work_order_id: v.workOrderId, p_source: v.source, p_reason: v.reason, p_reported_on: v.reportedOn ?? null,
    p_description: v.description, p_photo_ids: v.photoIds, p_return_start: v.returnStart ?? null,
    p_return_end: v.returnEnd ?? v.returnStart ?? null, p_fixed_by: v.fixedBy ?? null, p_qa_check_id: v.qaCheckId ?? null,
  });
  if (error) { reportError(error, { where: "callbacks.log" }); return { ok: false, message: error.code === "42883" ? "Call backs are not switched on yet (migration 20270226)." : error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: word(r) };
  const [, id, flag] = r.split(":");
  refresh(v.workOrderId);
  if (v.returnStart) tellPainter(id);
  void recompute({ workOrderId: v.workOrderId });
  return {
    ok: true, id, attached: flag === "attached",
    message: flag === "attached" ? "This visit joined the call back already open on the job."
      : v.returnStart ? "Call back logged and the return visit is in the painter's scheduler. Invoice chasing is paused until it is closed."
      : "Call back logged. Book the return visit when you have a day. Invoice chasing is paused until it is closed.",
  };
}

export async function bookCallbackAction(raw: unknown): Promise<CallbackActionResult> {
  const parsed = z.object({ callbackId: uuid, workOrderId: uuid, start: ymd, end: ymd.nullish(), fixedBy: uuid.nullish() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the day of the return visit." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_book", { p_callback_id: v.callbackId, p_start: v.start, p_end: v.end ?? v.start, p_fixed_by: v.fixedBy ?? null });
  if (error) { reportError(error, { where: "callbacks.book" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: word(r) };
  refresh(v.workOrderId);
  tellPainter(v.callbackId);
  return { ok: true, id: v.callbackId, attached: false, message: "Return visit booked — it is on the board and in the painter's calendar." };
}

export async function closeCallbackAction(raw: unknown): Promise<CallbackActionResult> {
  const parsed = z.object({ callbackId: uuid, workOrderId: uuid, note: z.string().trim().max(1000).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Try again." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_close", { p_callback_id: v.callbackId, p_note: v.note });
  if (error) { reportError(error, { where: "callbacks.close" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: word(r) };
  refresh(v.workOrderId);
  return { ok: true, id: v.callbackId, attached: false, message: "Closed. Invoice chasing on this job resumes." };
}

export async function setCallbackReasonAction(raw: unknown): Promise<CallbackActionResult> {
  const parsed = z.object({ callbackId: uuid, workOrderId: uuid, reason: z.enum(CALLBACK_REASONS), note: z.string().trim().max(500).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick Workmanship or Not workmanship." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_set_reason", { p_callback_id: v.callbackId, p_reason: v.reason, p_note: v.note });
  if (error) { reportError(error, { where: "callbacks.reason" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: word(r) };
  refresh(v.workOrderId);
  void recompute({ workOrderId: v.workOrderId });
  return { ok: true, id: v.callbackId, attached: false, message: v.reason === "workmanship" ? "Reason: workmanship — it counts toward the painter's score." : "Reason: not workmanship — logged, but it does not count toward the painter's score." };
}

export async function voidCallbackAction(raw: unknown): Promise<CallbackActionResult> {
  const parsed = z.object({ callbackId: uuid, workOrderId: uuid, reason: z.string().trim().min(3, "Say why.").max(1000) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Say why it is being voided." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_callback_void", { p_callback_id: v.callbackId, p_reason: v.reason });
  if (error) { reportError(error, { where: "callbacks.void" }); return { ok: false, message: error.message }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: word(r) };
  refresh(v.workOrderId);
  void recompute({ workOrderId: v.workOrderId });
  return { ok: true, id: v.callbackId, attached: false, message: "Voided. It no longer counts and invoice chasing resumes." };
}
