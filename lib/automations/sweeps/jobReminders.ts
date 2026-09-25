/**
 * The painter's "update your work order" texts (Tom, 25 Sep 2026). SERVER
 * ONLY, service client, off the half-hour campaign sweep.
 *
 * A booked job has a rhythm (lib/workorder/jobRhythm.ts): day 1 at 07:30,
 * then — by length — the second day, half way, 30% and 60%, and the last day,
 * each at 15:30 Melbourne. At each moment every painter on the job (the
 * contractor, and any assigned crew) is texted to tick what is done and add
 * the day's photos, with a link to the job.
 *
 * The ladder is `runLadder`'s: one claim per (job, rung) so two sweeps never
 * double-text, missed rungs claimed quietly rather than sent late, and "still
 * needed?" asked at send time — a job that has moved to its quality check,
 * walkthrough or close stops being reminded. 07:30 is before the office's
 * quiet-hours opening, so the automation is quiet-exempt by registry.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { dueRungs, runLadder, type Rung } from "../reminders";
import { sendAutomation } from "../dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "@/lib/invoicing/pdf";
import { melbourneDateKey } from "../controls";
import { dayLabel, jobDays, painterUpdateRungs, rungInstant } from "@/lib/workorder/jobRhythm";
import { suburbFromAddress } from "./moneySignoff";

export const JOB_UPDATE_KEY = "contractor_job_update_reminder";
const OPEN_STAGES = ["pre_start", "in_progress", "completion_prep"];

export type JobReminderResult = { fired: number; stopped: number; painters: number };

type WoRow = {
  id: string; wo_ref: string; stage: string; start_date: string | null; end_date: string | null; contractor_id: string | null;
  wo_snapshot: { jobAddress?: string | null } | null;
  contractors: { works_saturday: boolean | null; works_sunday: boolean | null } | null;
};

/** Pure: the ladder for a job — anchored on day 1 07:30, rungs in hours after it. */
export function jobUpdateLadder(days: readonly string[]): { anchor: Date; rungs: Rung[] } | null {
  const plan = painterUpdateRungs(days);
  if (plan.length === 0) return null;
  const anchor = rungInstant(plan[0]);
  return {
    anchor,
    rungs: plan.map((r) => ({ id: r.id, afterHours: (rungInstant(r).getTime() - anchor.getTime()) / 3_600_000 })),
  };
}

async function claimedSet(db: SupabaseClient, key: string, entityIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < entityIds.length; i += 200) {
    const { data, error } = await db.from("automation_claims").select("entity_id, rung").eq("automation_key", key).in("entity_id", entityIds.slice(i, i + 200));
    if (error) throw error;
    for (const c of (data ?? []) as { entity_id: string; rung: string }[]) out.add(`${c.entity_id}:${c.rung}`);
  }
  return out;
}

export async function runJobReminderSweep(db: SupabaseClient, now = new Date()): Promise<JobReminderResult> {
  const out: JobReminderResult = { fired: 0, stopped: 0, painters: 0 };
  const a = automationByKey(JOB_UPDATE_KEY);
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!a || !automationOn(messaging, a.key)) return out;

    const today = melbourneDateKey(now);
    const since = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
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

    const claimed = await claimedSet(db, a.key, jobs.map((j) => j.id));
    const { contactFor } = await import("@/lib/contractor/notify");
    const companyName = company.name || "Paint Group";

    for (const job of jobs) {
      const days = jobDays(job.start_date, job.end_date, {
        worksSaturday: Boolean(job.contractors?.works_saturday), worksSunday: Boolean(job.contractors?.works_sunday),
      });
      const ladder = jobUpdateLadder(days);
      if (!ladder) continue;
      const due = dueRungs(ladder.anchor, ladder.rungs, now);
      if (due.length === 0) continue;
      const latest = due[due.length - 1];
      if (claimed.has(`${job.id}:${latest.id}`)) continue;

      const painters = new Set<string>(crew.get(job.id) ?? []);
      if (job.contractor_id) painters.add(job.contractor_id);
      if (painters.size === 0) continue;

      const r = await runLadder(db, {
        key: a.key, entityId: job.id, anchor: ladder.anchor, rungs: ladder.rungs, now,
        stillNeeded: async () => {
          const { data: f, error: fErr } = await db.from("work_orders").select("stage").eq("id", job.id).maybeSingle();
          if (fErr) throw fErr;
          const s = (f as { stage?: string } | null)?.stage;
          return s && OPEN_STAGES.includes(s) ? { ok: true } : { ok: false, reason: `The job is at ${s ?? "gone"}.` };
        },
        send: async (rung) => {
          const dateOf = painterUpdateRungs(days).find((p) => p.id === rung.id)?.date ?? today;
          const link = `${siteUrl()}/portal/jobs/${job.id}`;
          for (const contractorId of painters) {
            const c = await contactFor(db, contractorId);
            const body = renderTemplate(messaging.contractorJobUpdateSms, {
              first_name: c.firstName, company_name: companyName, wo_ref: job.wo_ref,
              suburb: suburbFromAddress(job.wo_snapshot?.jobAddress, job.wo_ref || "the job"),
              day_label: dayLabel(days, dateOf) || "today",
              link,
            });
            await sendAutomation(db, {
              key: a.key, to: { phone: c.phone }, sms: { body },
              ctx: { workOrderId: job.id, kind: "job_update_reminder" }, contractorId, now,
            });
            out.painters += 1;
          }
        },
      });
      if (r.fired) out.fired += 1;
      if (r.stopped) out.stopped += 1;
    }
  } catch (e) {
    reportError(e, { where: "automations.jobReminders" });
  }
  return out;
}
