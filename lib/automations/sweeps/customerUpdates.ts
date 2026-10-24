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
import { customerCheckinDay, customerDefectDay, jobDays } from "@/lib/workorder/jobRhythm";
import { renderTemplate } from "@/lib/messaging/config";
import { isTestEmail } from "@/lib/accounts/identity";
import { deliverCustomerUpdate } from "@/lib/workorder/sendUpdate";
import { autoSendOn, isTimelineOnlyKind, loadCustomerUpdatesSettings } from "@/lib/workorder/customerUpdates";
import { CUSTOMER_UPDATES_KEY } from "@/lib/workorder/draftFromTicks";
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
    // The 40% check-in and the defect-day note were drafted at their own time: they go now.
    if (r.kind === "checkin_40" || r.kind === "defect_day") send.push(r);
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
    .eq("status", "drafted").in("kind", ["surface_milestone", "end_of_day", "checkin_40", "defect_day"]).order("created_at");
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
    // Timeline only for the check-in (R10); email + text for the rest, the defect-day message included (M1).
    if (!isTimelineOnlyKind(r.kind)) {
      try { await deliverCustomerUpdate(db, r.id, [], "both"); } catch (e) { reportError(e, { where: "automations.customerUpdates.deliver", extra: { id: r.id } }); }
    }
    out.sent += 1;
    if (r.kind === "surface_milestone") milestoneSentToday.add(r.work_order_id);
  }
  return out;
}

// ---- Step 3: the two notes, drafted on their day ----------------------------------------------

export type NoteTriggersResult = { jobs: number; checkins: number; defectDays: number; refused: number };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOr = (v: string | undefined, fallback: string) => (v && HHMM.test(v) ? v : fallback);

type JobRow = {
  id: string; stage: string; start_date: string | null; end_date: string | null; estimate_id: string;
  contractors: { works_saturday: boolean | null; works_sunday: boolean | null } | null;
  estimates: { accepted_name: string | null; contact_email: string | null; contact_first: string | null } | null;
};

/** Which notes a job is due today — pure, so the day maths is pinned without a database. */
export function notesDue(job: { days: readonly string[] }, opts: {
  today: string; hhmm: string; checkinPct: number; checkinMinDays: number; checkinTime: string; defectTime: string;
}): ("checkin_40" | "defect_day")[] {
  const out: ("checkin_40" | "defect_day")[] = [];
  if (customerCheckinDay(job.days, opts.checkinPct, opts.checkinMinDays) === opts.today && opts.hhmm >= opts.checkinTime) out.push("checkin_40");
  if (customerDefectDay(job.days) === opts.today && opts.hhmm >= opts.defectTime) out.push("defect_day");
  return out;
}

/**
 * Trigger B (the 40% check-in, jobs of 3+ booked days, 9:00) and Trigger C (the
 * defect-day note, every job, 7:30) — one row each per job, through
 * wo_draft_note, which answers `already` on a repeat and refuses a job that may
 * not be written to. The days come from the one planner (jobRhythm.ts) off the
 * dates the scheduler writes, read every sweep so a moved finish moves the note.
 */
export async function runCustomerNoteTriggers(db: SupabaseClient, now = new Date()): Promise<NoteTriggersResult> {
  const out: NoteTriggersResult = { jobs: 0, checkins: 0, defectDays: 0, refused: 0 };
  const { messaging } = await loadMessaging(db);
  if ((messaging.disabled ?? []).includes(CUSTOMER_UPDATES_KEY)) return out;
  const timing = messaging.controls?.[CUSTOMER_UPDATES_KEY]?.timing ?? {};
  const checkinPct = (typeof timing.checkin_percent === "number" ? timing.checkin_percent : 40) / 100;
  const checkinMinDays = typeof timing.checkin_min_days === "number" ? timing.checkin_min_days : 3;
  const checkinTime = timeOr(messaging.customerCheckinTime, "09:00");
  const defectTime = timeOr(messaging.customerDefectDayTime, "07:30");
  const { day: today, hhmm } = melbourneDayAndTime(now);

  const select = "id, stage, start_date, end_date, estimate_id, contractors(works_saturday, works_sunday), " +
    "estimates(accepted_name, contact_email:sent_snapshot->>contactEmail, contact_first:builder_state->contact->>first_name)";
  const { data, error } = await realOnly(db.from("work_orders").select(select))
    .in("stage", ["in_progress", "completion_prep"]).lte("start_date", today).gte("end_date", today).limit(300);
  if (error) { reportError(error, { where: "automations.customerNotes.list" }); return out; }
  const jobs = (data ?? []) as unknown as JobRow[];

  for (const job of jobs) {
    const e = job.estimates;
    if (e?.contact_email && isTestEmail(e.contact_email)) continue;
    const days = jobDays(job.start_date, job.end_date, { worksSaturday: Boolean(job.contractors?.works_saturday), worksSunday: Boolean(job.contractors?.works_sunday) });
    const due = notesDue({ days }, { today, hhmm, checkinPct, checkinMinDays, checkinTime, defectTime });
    if (due.length === 0) continue;
    out.jobs += 1;
    const firstName = (e?.contact_first || (e?.accepted_name ?? "").trim().split(/\s+/)[0] || "there").trim() || "there";
    for (const kind of due) {
      const text = renderTemplate(kind === "checkin_40" ? messaging.customerCheckinBody : messaging.customerDefectDayBody, { first_name: firstName });
      const { data: r, error: rErr } = await db.rpc("wo_draft_note", { p_work_order_id: job.id, p_kind: kind, p_text: text });
      if (rErr) { reportError(rErr, { where: "automations.customerNotes.draft", extra: { id: job.id, kind } }); continue; }
      const s = String(r ?? "");
      if (s.startsWith("ok:") && !s.endsWith(":already")) { if (kind === "checkin_40") out.checkins += 1; else out.defectDays += 1; }
      else if (s.startsWith("error:")) out.refused += 1;
    }
  }
  return out;
}
