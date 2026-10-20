/**
 * The painter's "final walkthrough in two business days" text (Tom, 19 Oct
 * 2026). SERVER ONLY, service client, off the half-hour campaign sweep.
 *
 * "Create a reminder text message 2 business days before the job is completed
 * reminding of the final walk through date and to change in the app if they
 * are running behind or ahead of schedule."
 *
 * When it goes is the one planner's (lib/workorder/jobRhythm.ts
 * painterFinishReminderDay): two BUSINESS days — Mon–Fri, Settings → public
 * holidays skipped, the quality check's unit — before the walkthrough day,
 * which is the booked final walkthrough, else the job's booked last day (the
 * date the painter's own Finish & walkthrough card shows). Read from the job
 * on every sweep, so a moved date moves the text; nothing is cached.
 *
 * Sent inside its window only (Settings → finish_reminder_rules, 07:30 until
 * noon by default), claimed once per job per walkthrough day
 * (automation_claims — a moved date is a new rung, so a painter who moved it
 * is reminded of the new date in its turn), to the contractor on the job (the
 * one who can move the date), and its outcome written to wo_events as
 * `finish_reminder_sent`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { melbourneDateKey } from "../controls";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { buildPlainEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "@/lib/invoicing/pdf";
import { painterFinishReminderDay, walkthroughDayOf } from "@/lib/workorder/jobRhythm";
import { melbourneDayAndTime } from "@/lib/workorder/reminderMoments";
import { BOOKING_RULES_KEY } from "@/lib/visits/schedule";
import { dayInstant, suburbFromAddress } from "./moneySignoff";
import { realOnly } from "@/lib/demo/scope";

export const FINISH_REMINDER_KEY = "contractor_finish_reminder";
/** Booked and not yet signed off: the painter can still move the date at any of these. */
const OPEN_STAGES = ["pre_start", "in_progress", "completion_prep", "qa"];

export type FinishReminderRules = {
  /** HH:MM Melbourne: the text goes from `from` until `until`, never later. */
  from: string;
  until: string;
};

export const DEFAULT_FINISH_REMINDER_RULES: FinishReminderRules = { from: "07:30", until: "12:00" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function mergeFinishReminderRules(raw: unknown): FinishReminderRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const time = (k: keyof FinishReminderRules) => (typeof r[k] === "string" && HHMM.test(r[k] as string) ? (r[k] as string) : DEFAULT_FINISH_REMINDER_RULES[k]);
  return { from: time("from"), until: time("until") };
}

export type FinishReminderDue = { walkthroughDay: string; reminderDay: string };

/**
 * The text due now for a job whose walkthrough is on `walkthroughDay`, or
 * null: today (Melbourne) is two business days before it, the clock is inside
 * the window, and that walkthrough day has not been claimed.
 */
export function finishReminderDue(
  walkthroughDay: string | null, now: Date, rules: FinishReminderRules, holidays: ReadonlySet<string>, claimed: ReadonlySet<string>,
): FinishReminderDue | null {
  if (!walkthroughDay) return null;
  const { day, hhmm } = melbourneDayAndTime(now);
  const reminderDay = painterFinishReminderDay(walkthroughDay, holidays);
  if (reminderDay !== day || claimed.has(walkthroughDay)) return null;
  if (hhmm < rules.from || hhmm >= rules.until) return null;
  return { walkthroughDay, reminderDay };
}

export type FinishReminderResult = { due: number; dispatched: number; stopped: number };

type JobRow = {
  id: string; wo_ref: string; stage: string; end_date: string | null; contractor_id: string | null;
  wo_snapshot: { jobAddress?: string | null } | null;
  wo_walkthroughs: { kind: string; status: string; scheduled_date: string; created_at: string }[] | null;
};

const walkthroughDay = (j: Pick<JobRow, "end_date" | "wo_walkthroughs">) => walkthroughDayOf({
  endDate: j.end_date,
  finals: (j.wo_walkthroughs ?? []).filter((w) => w.kind === "final")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((w) => ({ status: w.status, date: w.scheduled_date })),
});

const finishDate = (iso: string) =>
  dayInstant(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" });

const JOB_SELECT = "id, wo_ref, stage, end_date, contractor_id, wo_snapshot, wo_walkthroughs(kind, status, scheduled_date, created_at)";

export async function runFinishReminderSweep(db: SupabaseClient, now = new Date()): Promise<FinishReminderResult> {
  const out: FinishReminderResult = { due: 0, dispatched: 0, stopped: 0 };
  const a = automationByKey(FINISH_REMINDER_KEY);
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!a || !automationOn(messaging, a.key)) return out;
    const { data: settingRows, error: settingsErr } = await db.from("settings").select("key, value").in("key", ["finish_reminder_rules", BOOKING_RULES_KEY]);
    if (settingsErr) reportError(settingsErr, { where: "automations.finishReminder.rules", bestEffort: true });
    const setting = (k: string) => ((settingRows ?? []) as { key: string; value: unknown }[]).find((r) => r.key === k)?.value;
    const rules = mergeFinishReminderRules(setting("finish_reminder_rules"));
    const holidaysRaw = (setting(BOOKING_RULES_KEY) as { publicHolidays?: unknown } | undefined)?.publicHolidays;
    const holidays = new Set(Array.isArray(holidaysRaw) ? holidaysRaw.filter((d): d is string => typeof d === "string") : []);

    // Any open booked job whose last day is not more than a week gone — a final
    // can be booked after the last day on site.
    const since = melbourneDateKey(new Date(now.getTime() - 7 * 86_400_000));
    const { data, error } = await realOnly(db.from("work_orders").select(JOB_SELECT))
      .in("stage", OPEN_STAGES).not("contractor_id", "is", null).gte("end_date", since)
      .order("end_date", { ascending: true }).limit(300);
    if (error) throw error;
    const jobs = (data ?? []) as unknown as JobRow[];
    if (jobs.length === 0) return out;

    const { data: cl, error: clErr } = await db.from("automation_claims").select("entity_id, rung")
      .eq("automation_key", a.key).in("entity_id", jobs.map((j) => j.id));
    if (clErr) throw clErr;
    const claimed = new Map<string, Set<string>>();
    for (const c of (cl ?? []) as { entity_id: string; rung: string }[]) {
      const set = claimed.get(c.entity_id) ?? new Set<string>();
      set.add(c.rung); claimed.set(c.entity_id, set);
    }

    const { contactFor } = await import("@/lib/contractor/notify");
    const companyName = company.name || "Paint Group";
    for (const job of jobs) {
      if (!finishReminderDue(walkthroughDay(job), now, rules, holidays, claimed.get(job.id) ?? new Set())) continue;
      out.due += 1;
      // Still needed, from the row as it is NOW: the stage, the painter and the dates.
      const { data: f, error: fErr } = await db.from("work_orders").select(JOB_SELECT).eq("id", job.id).maybeSingle();
      if (fErr) throw fErr;
      const fresh = f as unknown as JobRow | null;
      const due = fresh && OPEN_STAGES.includes(fresh.stage) && fresh.contractor_id
        ? finishReminderDue(walkthroughDay(fresh), now, rules, holidays, claimed.get(job.id) ?? new Set()) : null;
      if (!fresh || !due || !fresh.contractor_id) { out.stopped += 1; continue; }
      // Claim BEFORE sending, so two sweeps at once never double up.
      if (!(await claimRung(db, a.key, job.id, due.walkthroughDay))) continue;

      const c = await contactFor(db, fresh.contractor_id);
      const address = fresh.wo_snapshot?.jobAddress || "";
      const vars = {
        first_name: c.firstName, company_name: companyName, wo_ref: fresh.wo_ref,
        suburb: suburbFromAddress(address, fresh.wo_ref || "the job"),
        address: address || fresh.wo_ref,
        finish_date: finishDate(due.walkthroughDay),
        link: `${siteUrl()}/portal/jobs/${fresh.id}`,
      };
      const o = await sendAutomation(db, {
        key: a.key,
        to: { phone: c.phone, email: c.email },
        sms: { body: renderTemplate(messaging.contractorFinishReminderSms, vars) },
        email: {
          subject: renderTemplate(messaging.contractorFinishReminderEmailSubject, vars),
          html: buildPlainEmailHtml({ heading: "Final walkthrough in two business days", message: renderTemplate(messaging.contractorFinishReminderEmailIntro, vars), companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }),
        },
        ctx: { workOrderId: fresh.id, kind: "finish_reminder" }, contractorId: fresh.contractor_id, now,
      });
      const ev = await db.from("wo_events").insert({
        work_order_id: fresh.id, type: "finish_reminder_sent", actor_kind: "system",
        meta: { walkthrough_day: due.walkthroughDay, day: due.reminderDay, outcome: outcomeWord(o), channels: o.outcome === "sent" ? o.channels : [] },
      });
      if (ev.error) throw ev.error;
      out.dispatched += 1;
    }
  } catch (err) {
    reportError(err, { where: "automations.finishReminder" });
  }
  return out;
}
