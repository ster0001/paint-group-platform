import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { OPEN_STATUSES, type Callback, type CallbackReason, type CallbackSource, type CallbackStatus } from "./model";

/**
 * Reads of wo_callbacks under the caller's own session (RLS: staff all, the
 * painter it is about or the one booked to fix it). Every read keeps its
 * error: a list that could not be read is reported and returned as such,
 * never as "no call backs" (CLAUDE.md).
 */

type Row = {
  id: string; work_order_id: string; painter_id: string; fixed_by_painter_id: string | null;
  source: CallbackSource; reason: CallbackReason; reported_on: string; description: string; status: CallbackStatus;
  appointment_id: string | null; qa_check_id: string | null; fixed_at: string | null; fixed_note: string;
  closed_at: string | null; closed_note: string; voided_at: string | null; void_reason: string; created_at: string;
  wo_appointments: { start_date: string; end_date: string; contractor_id: string } | null;
};

const COLS = "id, work_order_id, painter_id, fixed_by_painter_id, source, reason, reported_on, description, status, appointment_id, qa_check_id, fixed_at, fixed_note, closed_at, closed_note, voided_at, void_reason, created_at, wo_appointments(start_date, end_date, contractor_id)";

const toCallback = (r: Row): Callback => ({
  id: r.id, workOrderId: r.work_order_id, painterId: r.painter_id, fixedByPainterId: r.fixed_by_painter_id,
  source: r.source, reason: r.reason, reportedOn: r.reported_on, description: r.description, status: r.status,
  appointmentId: r.appointment_id, qaCheckId: r.qa_check_id, fixedAt: r.fixed_at, fixedNote: r.fixed_note,
  closedAt: r.closed_at, closedNote: r.closed_note, voidedAt: r.voided_at, voidReason: r.void_reason, createdAt: r.created_at,
  visit: r.wo_appointments ? { start: r.wo_appointments.start_date, end: r.wo_appointments.end_date, contractorId: r.wo_appointments.contractor_id } : null,
});

export type CallbacksLoad = { callbacks: Callback[]; error: string | null };

function failed(where: string, error: { message: string; code?: string }): CallbacksLoad {
  reportError(error, { where });
  return { callbacks: [], error: error.code === "42P01" ? "Call backs are not switched on yet (migration 20270226)." : error.message };
}

/** Every call back on one job, newest first. */
export async function loadCallbacksForJob(supabase: SupabaseClient, workOrderId: string): Promise<CallbacksLoad> {
  const { data, error } = await supabase.from("wo_callbacks").select(COLS).eq("work_order_id", workOrderId).order("created_at", { ascending: false });
  if (error) return failed("callbacks.job", error);
  return { callbacks: ((data ?? []) as unknown as Row[]).map(toCallback), error: null };
}

/** Every OPEN call back (the Flow column, the queue). */
export async function loadOpenCallbacks(supabase: SupabaseClient): Promise<CallbacksLoad> {
  const { data, error } = await supabase.from("wo_callbacks").select(COLS).in("status", [...OPEN_STATUSES]).order("created_at", { ascending: true }).limit(500);
  if (error) return failed("callbacks.open", error);
  return { callbacks: ((data ?? []) as unknown as Row[]).map(toCallback), error: null };
}

/** The painter's own: about them, or booked for them to fix. */
export async function loadMyCallbacks(supabase: SupabaseClient, contractorId: string, onlyOpen = true): Promise<CallbacksLoad> {
  let q = supabase.from("wo_callbacks").select(COLS)
    .or(`painter_id.eq.${contractorId},fixed_by_painter_id.eq.${contractorId}`)
    .order("created_at", { ascending: false }).limit(50);
  if (onlyOpen) q = q.in("status", [...OPEN_STATUSES]);
  const { data, error } = await q;
  if (error) return failed("callbacks.mine", error);
  return { callbacks: ((data ?? []) as unknown as Row[]).map(toCallback), error: null };
}
