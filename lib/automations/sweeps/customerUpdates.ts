/**
 * Auto-send for the Customer updates queue (work order UX Step 2 §4.2). SERVER
 * ONLY, service client, off the half-hour campaign sweep.
 *
 * Only when the queue's mode is "send automatically" (the switch at the top of
 * /pc/updates — the registry mode for customer_updates_queue). Then:
 *
 *  · a SURFACE MILESTONE draft goes once its bundle window has passed;
 *  · the END-OF-DAY summary goes from 16:00 Melbourne — and is skipped for the
 *    day when a milestone already went out on that job today (⚑2 default: one
 *    message a day at most);
 *  · nothing goes outside the sending hours (D1), and nothing goes on a job that
 *    may no longer be written to (paused, rectification, signed off).
 *
 * Approve + send run as the system through the same two RPCs a person uses;
 * delivery is the same deliverCustomerUpdate (email + text, the customer's own
 * channel preferences), and the row lands on the queue as SENT, as the brief asks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMessaging } from "@/lib/messaging/load";
import { parseQuietHours, withinSendingHours } from "../controls";
import { melbourneDayAndTime } from "@/lib/workorder/reminderMoments";
import { melbourneDate } from "@/lib/workorder/console";
import { deliverCustomerUpdate } from "@/lib/workorder/sendUpdate";
import { autoSendOn, loadCustomerUpdatesSettings } from "@/lib/workorder/customerUpdates";
import { reportError } from "@/lib/monitoring/report";
import { realOnly } from "@/lib/demo/scope";

export const END_OF_DAY_FROM = "16:00";

export type AutoSendResult = { on: boolean; due: number; sent: number; skipped: number; failed: number };

type Row = { id: string; work_order_id: string; kind: string; for_date: string; created_at: string };

/** Which drafts are due now — pure over the rows and the clock, so a test can pin it. */
export function dueNow(rows: readonly Row[], opts: {
  now: Date; bundleMinutes: number; today: string; hhmm: string;
  /** Jobs that already had a milestone SENT today. */
  milestoneSentToday: ReadonlySet<string>;
}): { send: Row[]; skip: Row[] } {
  const send: Row[] = []; const skip: Row[] = [];
  const windowEnd = opts.now.getTime() - opts.bundleMinutes * 60_000;
  for (const r of rows) {
    if (r.kind === "surface_milestone") {
      if (new Date(r.created_at).getTime() <= windowEnd) send.push(r);
      continue;
    }
    if (r.kind === "end_of_day") {
      if (r.for_date !== opts.today) { skip.push(r); continue; }           // yesterday's draft: a person decides
      if (opts.hhmm < END_OF_DAY_FROM) continue;                           // not yet
      if (opts.milestoneSentToday.has(r.work_order_id)) { skip.push(r); continue; }
      send.push(r);
    }
    // checkin_40 / defect_day: Step 3 decides their own timing.
  }
  return { send, skip };
}

export async function runCustomerUpdatesAutoSend(db: SupabaseClient, now = new Date()): Promise<AutoSendResult> {
  const out: AutoSendResult = { on: false, due: 0, sent: 0, skipped: 0, failed: 0 };
  const { messaging } = await loadMessaging(db);
  if (!autoSendOn(messaging)) return out;
  out.on = true;
  if (!withinSendingHours(now, parseQuietHours(messaging.quietHours))) return out;

  const settings = await loadCustomerUpdatesSettings(db);
  const { day: today, hhmm } = melbourneDayAndTime(now);

  const { data, error } = await realOnly(db.from("wo_updates")
    .select("id, work_order_id, kind, for_date, created_at"))
    .eq("status", "drafted").in("kind", ["surface_milestone", "end_of_day"]).order("created_at");
  if (error) { reportError(error, { where: "automations.customerUpdates.list" }); return out; }
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return out;

  const jobIds = [...new Set(rows.map((r) => r.work_order_id))];
  const { data: sentRows, error: sentErr } = await db.from("wo_updates").select("work_order_id")
    .in("work_order_id", jobIds).eq("kind", "surface_milestone").eq("status", "sent").eq("for_date", melbourneDate(now));
  if (sentErr) { reportError(sentErr, { where: "automations.customerUpdates.sentToday" }); return out; }
  const milestoneSentToday = new Set(((sentRows ?? []) as { work_order_id: string }[]).map((r) => r.work_order_id));

  const { send, skip } = dueNow(rows, { now, bundleMinutes: settings.bundleMinutes, today, hhmm, milestoneSentToday });
  out.due = send.length; out.skipped = skip.length;

  for (const r of send) {
    // The job must still be one we may write to — the RPC rule, asked here so a
    // paused job's draft stays on the queue for a person rather than failing.
    const { data: allowed, error: allowedErr } = await db.rpc("wo_customer_updates_allowed", { p_work_order_id: r.work_order_id });
    if (allowedErr) { out.failed += 1; reportError(allowedErr, { where: "automations.customerUpdates.allowed", extra: { id: r.id } }); continue; }
    if (String(allowed ?? "") !== "ok") { out.skipped += 1; continue; }

    const approved = await db.rpc("wo_approve_update", { p_update_id: r.id, p_final_text: null });
    if (approved.error || !String(approved.data ?? "").startsWith("ok:")) {
      out.failed += 1; reportError(approved.error ?? new Error(String(approved.data)), { where: "automations.customerUpdates.approve", extra: { id: r.id } }); continue;
    }
    const sent = await db.rpc("wo_send_update", { p_update_id: r.id, p_photo_ids: [], p_sender_name: settings.senderFirstName });
    if (sent.error || !String(sent.data ?? "").startsWith("ok:")) {
      out.failed += 1; reportError(sent.error ?? new Error(String(sent.data)), { where: "automations.customerUpdates.send", extra: { id: r.id } }); continue;
    }
    try { await deliverCustomerUpdate(db, r.id, [], "both"); } catch (e) { reportError(e, { where: "automations.customerUpdates.deliver", extra: { id: r.id } }); }
    out.sent += 1;
    if (r.kind === "surface_milestone") milestoneSentToday.add(r.work_order_id);
  }
  return out;
}
