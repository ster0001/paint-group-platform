/**
 * The painter's "update your work order" texts (Tom, 25 Sep 2026; moments,
 * follow-ups and "No work today" from the standards / status / call backs
 * brief, Step 4). SERVER ONLY, service client, off the half-hour campaign
 * sweep.
 *
 * A booked job has a rhythm (lib/workorder/jobRhythm.ts): day 1 at 07:30,
 * then — by length — the second day, half way, 30% and 60%, and the last day,
 * each at 15:30 Melbourne. Each of those is a MOMENT with a row
 * (wo_reminder_moments, migration 20270227). At each moment every painter on
 * the job (the contractor, and any assigned crew) is texted to tick what is
 * done and add the day's photos; if nothing lands, again at the ⚑5 times —
 * up to three texts on the day, never after 7 pm — and the texts stop the
 * instant an update is in (the answer is recorded by a trigger on wo_events).
 *
 * Every sweep first brings each open job's rows in line with its booking
 * (lib/workorder/reminderMoments.ts reconcilePlan): dates that move
 * re-date moments that have not happened; past moments never change; a day
 * that went by with no text is marked not_sent so it is never a miss.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { sendAutomation } from "../dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "@/lib/invoicing/pdf";
import { melbourneDateKey } from "../controls";
import { dayLabel, jobDays } from "@/lib/workorder/jobRhythm";
import {
  decideSend, mergeJobUpdateRules, planMoments, reconcilePlan, type MomentKind, type MomentRow,
} from "@/lib/workorder/reminderMoments";
import { suburbFromAddress } from "./moneySignoff";

export const JOB_UPDATE_KEY = "contractor_job_update_reminder";
const OPEN_STAGES = ["pre_start", "in_progress", "completion_prep"];

export type JobReminderResult = { fired: number; followUps: number; stopped: number; painters: number; planned: number };

type WoRow = {
  id: string; wo_ref: string; stage: string; start_date: string | null; end_date: string | null; contractor_id: string | null;
  wo_snapshot: { jobAddress?: string | null } | null;
  contractors: { works_saturday: boolean | null; works_sunday: boolean | null } | null;
};
type DbMoment = {
  id: string; work_order_id: string; kind: MomentKind; day: string; due_at: string; sends_count: number;
  last_sent_at: string | null; answered_at: string | null; skipped_reason: MomentRow["skippedReason"];
};
const toRow = (m: DbMoment): MomentRow => ({
  id: m.id, workOrderId: m.work_order_id, kind: m.kind, day: m.day, dueAt: m.due_at, sendsCount: m.sends_count,
  lastSentAt: m.last_sent_at, answeredAt: m.answered_at, skippedReason: m.skipped_reason,
});

/** Bring one job's moment rows in line with its booking. Returns the rows after. */
export async function planJobMoments(db: SupabaseClient, job: WoRow, now: Date): Promise<MomentRow[]> {
  const days = jobDays(job.start_date, job.end_date, {
    worksSaturday: Boolean(job.contractors?.works_saturday), worksSunday: Boolean(job.contractors?.works_sunday),
  });
  const plan = planMoments(days);
  const { data, error } = await db.from("wo_reminder_moments")
    .select("id, work_order_id, kind, day, due_at, sends_count, last_sent_at, answered_at, skipped_reason").eq("work_order_id", job.id);
  if (error) throw error;
  const existing = ((data ?? []) as DbMoment[]).map(toRow);
  const r = reconcilePlan(existing, plan, now);
  if (r.insert.length) {
    const ins = await db.from("wo_reminder_moments")
      .upsert(r.insert.map((p) => ({ work_order_id: job.id, kind: p.kind, day: p.day, due_at: p.dueAt.toISOString() })), { onConflict: "work_order_id,kind", ignoreDuplicates: true });
    if (ins.error) throw ins.error;
  }
  for (const m of r.move) {
    const up = await db.from("wo_reminder_moments").update({ day: m.day, due_at: m.dueAt.toISOString() }).eq("id", m.id);
    if (up.error) throw up.error;
  }
  if (r.skip.length) {
    const up = await db.from("wo_reminder_moments").update({ skipped_reason: "rescheduled", skipped_at: now.toISOString() }).in("id", r.skip);
    if (up.error) throw up.error;
  }
  if (r.notSent.length) {
    const up = await db.from("wo_reminder_moments").update({ skipped_reason: "not_sent", skipped_at: now.toISOString() }).in("id", r.notSent);
    if (up.error) throw up.error;
  }
  if (!(r.insert.length || r.move.length || r.skip.length || r.notSent.length)) return existing;
  const again = await db.from("wo_reminder_moments")
    .select("id, work_order_id, kind, day, due_at, sends_count, last_sent_at, answered_at, skipped_reason").eq("work_order_id", job.id);
  if (again.error) throw again.error;
  let rows = ((again.data ?? []) as DbMoment[]).map(toRow);
  // Rows planned for the first time on a day that has already gone by were
  // never texted either: the second pass marks them not_sent at once, so the
  // painter's screen never shows a "missed" moment nobody asked them about.
  const late = reconcilePlan(rows, plan, now).notSent;
  if (late.length) {
    const up = await db.from("wo_reminder_moments").update({ skipped_reason: "not_sent", skipped_at: now.toISOString() }).in("id", late);
    if (up.error) throw up.error;
    rows = rows.map((m) => (late.includes(m.id) ? { ...m, skippedReason: "not_sent" } : m));
  }
  return rows;
}

export async function runJobReminderSweep(db: SupabaseClient, now = new Date()): Promise<JobReminderResult> {
  const out: JobReminderResult = { fired: 0, followUps: 0, stopped: 0, painters: 0, planned: 0 };
  const a = automationByKey(JOB_UPDATE_KEY);
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!a || !automationOn(messaging, a.key)) return out;
    const { data: rulesRow, error: rulesErr } = await db.from("settings").select("value").eq("key", "job_update_rules").maybeSingle();
    if (rulesErr) reportError(rulesErr, { where: "automations.jobReminders.rules", bestEffort: true });
    const rules = mergeJobUpdateRules((rulesRow as { value?: unknown } | null)?.value);

    const today = melbourneDateKey(now);
    const since = melbourneDateKey(new Date(now.getTime() - 3 * 86_400_000));
    const { data, error } = await db.from("work_orders")
      .select("id, wo_ref, stage, start_date, end_date, contractor_id, wo_snapshot, contractors(works_saturday, works_sunday)")
      .in("stage", OPEN_STAGES).not("start_date", "is", null).not("end_date", "is", null)
      .lte("start_date", today).gte("end_date", since)
      .order("start_date", { ascending: true }).limit(300);
    if (error) throw error;
    const jobs = (data ?? []) as unknown as WoRow[];
    if (jobs.length === 0) return out;

    // Every painter on the job: the contractor, plus any assigned crew.
    const { data: asg, error: asgErr } = await db.from("wo_assignments").select("work_order_id, contractor_id")
      .in("work_order_id", jobs.map((j) => j.id)).neq("status", "released");
    if (asgErr) throw asgErr;
    const crew = new Map<string, Set<string>>();
    for (const r of (asg ?? []) as { work_order_id: string; contractor_id: string }[]) {
      const set = crew.get(r.work_order_id) ?? new Set<string>();
      set.add(r.contractor_id); crew.set(r.work_order_id, set);
    }

    const { contactFor } = await import("@/lib/contractor/notify");
    const companyName = company.name || "Paint Group";
    const templates = [messaging.contractorJobUpdateSms, messaging.contractorJobUpdateSms2, messaging.contractorJobUpdateSms3];

    for (const job of jobs) {
      const moments = await planJobMoments(db, job, now);
      out.planned += moments.length;
      const days = jobDays(job.start_date, job.end_date, {
        worksSaturday: Boolean(job.contractors?.works_saturday), worksSunday: Boolean(job.contractors?.works_sunday),
      });
      const painters = new Set<string>(crew.get(job.id) ?? []);
      if (job.contractor_id) painters.add(job.contractor_id);
      if (painters.size === 0) continue;

      for (const m of moments) {
        const d = decideSend(m, now, rules);
        if (!d.send) continue;
        // "Still needed?" at send time: a job that moved on is not reminded.
        const { data: f, error: fErr } = await db.from("work_orders").select("stage").eq("id", job.id).maybeSingle();
        if (fErr) throw fErr;
        const stage = (f as { stage?: string } | null)?.stage;
        if (!stage || !OPEN_STAGES.includes(stage)) { out.stopped += 1; continue; }
        // Claim the send BEFORE texting, so two sweeps at once never double up.
        const claim = await db.from("wo_reminder_moments")
          .update({ sends_count: m.sendsCount + 1, last_sent_at: now.toISOString() })
          .eq("id", m.id).eq("sends_count", m.sendsCount).select("id");
        if (claim.error) throw claim.error;
        if (((claim.data as unknown[] | null)?.length ?? 0) === 0) continue;

        const link = `${siteUrl()}/portal/jobs/${job.id}`;
        const outcomes: Record<string, string> = {};
        for (const contractorId of painters) {
          const c = await contactFor(db, contractorId);
          const body = renderTemplate(templates[d.which - 1] ?? templates[0], {
            first_name: c.firstName, company_name: companyName, wo_ref: job.wo_ref,
            suburb: suburbFromAddress(job.wo_snapshot?.jobAddress, job.wo_ref || "the job"),
            day_label: dayLabel(days, m.day) || "today",
            link,
          });
          const o = await sendAutomation(db, {
            key: a.key, to: { phone: c.phone }, sms: { body },
            ctx: { workOrderId: job.id, kind: "job_update_reminder" }, contractorId, now,
          });
          outcomes[contractorId] = o.outcome;
          out.painters += 1;
        }
        const ev = await db.from("wo_events").insert({
          work_order_id: job.id, type: "reminder_moment_sent", actor_kind: "system",
          meta: { moment_id: m.id, kind: m.kind, day: m.day, text_no: d.which, outcomes },
        });
        if (ev.error) throw ev.error;
        if (d.which === 1) out.fired += 1; else out.followUps += 1;
      }
    }
  } catch (e) {
    reportError(e, { where: "automations.jobReminders" });
  }
  return out;
}
