/**
 * The customer's defect-tape text (Tom, 8 Oct 2026). SERVER ONLY, service
 * client, off the half-hour campaign sweep.
 *
 * "Create a text message alert for a job which is 3 days or more to remind
 * the customer to defect the job with tape": before the final walkthrough the
 * customer marks every spot they want touched up with a small piece of the
 * painter's tape. When it goes is the one planner's (lib/workorder/
 * jobRhythm.ts customerDefectTapeRungs), counted in the job's booked WORKING
 * days — the scheduler's own unit:
 *
 *   3–6 days   two working days before the last day, 9:00 am and 3:30 pm
 *   7+ days    three working days before the last day, 9:00 am
 *
 * The dates are read from work_orders.start_date / end_date on every sweep
 * (the columns the scheduler writes, end date included once a job is under
 * way), so a moved finish date moves the text; nothing is cached. Each text is
 * claimed once per job (automation_claims) before it goes, sent inside its own
 * window only (Settings → defect_tape_rules), and its dispatcher outcome is
 * written to wo_events as `defect_tape_sent`. The customer's own "job" alert
 * switch applies through the send layer (sendKind job_defect_tape).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { melbourneDateKey } from "../controls";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { buildPlainEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isTestEmail } from "@/lib/accounts/identity";
import { reportError } from "@/lib/monitoring/report";
import { customerDefectTapeRungs, jobDays, type DefectTapeRung } from "@/lib/workorder/jobRhythm";
import { melbourneDayAndTime } from "@/lib/workorder/reminderMoments";
import { dayInstant, suburbFromAddress } from "./moneySignoff";

export const DEFECT_TAPE_KEY = "customer_defect_tape";
const OPEN_STAGES = ["pre_start", "in_progress", "completion_prep"];

export type DefectTapeRules = {
  /** HH:MM Melbourne: the morning text goes from `morning` until `morningUntil`… */
  morning: string;
  morningUntil: string;
  /** …and the afternoon one (3–6 day jobs) from `afternoon` until `afternoonUntil`. */
  afternoon: string;
  afternoonUntil: string;
};

export const DEFAULT_DEFECT_TAPE_RULES: DefectTapeRules = {
  morning: "09:00", morningUntil: "12:00", afternoon: "15:30", afternoonUntil: "19:00",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function mergeDefectTapeRules(raw: unknown): DefectTapeRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const time = (k: keyof DefectTapeRules) => (typeof r[k] === "string" && HHMM.test(r[k] as string) ? (r[k] as string) : DEFAULT_DEFECT_TAPE_RULES[k]);
  return { morning: time("morning"), morningUntil: time("morningUntil"), afternoon: time("afternoon"), afternoonUntil: time("afternoonUntil") };
}

/**
 * The text due now for a job of these booked days, or null: today (Melbourne)
 * is its day, the clock is inside its window, and it has not been claimed.
 */
export function defectTapeDue(days: readonly string[], now: Date, rules: DefectTapeRules, claimed: ReadonlySet<string>): DefectTapeRung | null {
  const { day, hhmm } = melbourneDayAndTime(now);
  for (const r of customerDefectTapeRungs(days)) {
    if (r.date !== day || claimed.has(r.id)) continue;
    const [from, until] = r.id === "am" ? [rules.morning, rules.morningUntil] : [rules.afternoon, rules.afternoonUntil];
    if (hhmm >= from && hhmm < until) return r;
  }
  return null;
}

export type DefectTapeResult = { due: number; dispatched: number; stopped: number };

type JobRow = {
  id: string; wo_ref: string; stage: string; start_date: string | null; end_date: string | null; estimate_id: string;
  wo_snapshot: { jobAddress?: string | null } | null;
  contractors: { works_saturday: boolean | null; works_sunday: boolean | null } | null;
  estimates: {
    account_id: string | null; accepted_name: string | null; contact_email: string | null; contact_phone: string | null;
    contact_first: string | null; job_address: string | null;
  } | null;
};

const daysOf = (j: Pick<JobRow, "start_date" | "end_date" | "contractors">) =>
  jobDays(j.start_date, j.end_date, { worksSaturday: Boolean(j.contractors?.works_saturday), worksSunday: Boolean(j.contractors?.works_sunday) });

const finishDate = (iso: string) =>
  dayInstant(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" });

export async function runDefectTapeSweep(db: SupabaseClient, now = new Date()): Promise<DefectTapeResult> {
  const out: DefectTapeResult = { due: 0, dispatched: 0, stopped: 0 };
  const a = automationByKey(DEFECT_TAPE_KEY);
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!a || !automationOn(messaging, a.key)) return out;
    const { data: rulesRow, error: rulesErr } = await db.from("settings").select("value").eq("key", "defect_tape_rules").maybeSingle();
    if (rulesErr) reportError(rulesErr, { where: "automations.defectTape.rules", bestEffort: true });
    const rules = mergeDefectTapeRules((rulesRow as { value?: unknown } | null)?.value);

    const today = melbourneDateKey(now);
    const select = "id, wo_ref, stage, start_date, end_date, estimate_id, wo_snapshot, contractors(works_saturday, works_sunday), " +
      "estimates(account_id, accepted_name, contact_email:sent_snapshot->>contactEmail, contact_phone:builder_state->contact->>phone, contact_first:builder_state->contact->>first_name, job_address:sent_snapshot->>jobAddress)";
    const { data, error } = await db.from("work_orders").select(select)
      .in("stage", OPEN_STAGES).lte("start_date", today).gte("end_date", today)
      .order("start_date", { ascending: true }).limit(300);
    if (error) throw error;
    const jobs = (data ?? []) as unknown as JobRow[];
    if (jobs.length === 0) return out;

    // One read for every candidate's claims.
    const { data: cl, error: clErr } = await db.from("automation_claims").select("entity_id, rung")
      .eq("automation_key", a.key).in("entity_id", jobs.map((j) => j.id));
    if (clErr) throw clErr;
    const claimed = new Map<string, Set<string>>();
    for (const c of (cl ?? []) as { entity_id: string; rung: string }[]) {
      const set = claimed.get(c.entity_id) ?? new Set<string>();
      set.add(c.rung); claimed.set(c.entity_id, set);
    }

    const companyName = company.name || "Paint Group";
    for (const job of jobs) {
      const e = job.estimates;
      if (e?.contact_email && isTestEmail(e.contact_email)) continue;
      if (!defectTapeDue(daysOf(job), now, rules, claimed.get(job.id) ?? new Set())) continue;
      out.due += 1;
      // Still needed, from the row as it is NOW: the stage, and the dates (a finish date moved this minute moves the text).
      const { data: f, error: fErr } = await db.from("work_orders").select("stage, start_date, end_date, contractors(works_saturday, works_sunday)").eq("id", job.id).maybeSingle();
      if (fErr) throw fErr;
      const fresh = f as unknown as Pick<JobRow, "stage" | "start_date" | "end_date" | "contractors"> | null;
      const rung = fresh && OPEN_STAGES.includes(fresh.stage) ? defectTapeDue(daysOf(fresh), now, rules, claimed.get(job.id) ?? new Set()) : null;
      if (!fresh || !rung || !fresh.end_date) { out.stopped += 1; continue; }
      // Claim BEFORE sending, so two sweeps at once never double up.
      if (!(await claimRung(db, a.key, job.id, rung.id))) continue;

      const address = e?.job_address || job.wo_snapshot?.jobAddress || "";
      const vars = {
        first_name: (e?.contact_first || (e?.accepted_name ?? "").trim().split(/\s+/)[0] || "there").trim() || "there",
        company_name: companyName,
        suburb: suburbFromAddress(address, "your place"),
        address: address || "your place",
        finish_date: finishDate(fresh.end_date),
      };
      const intro = renderTemplate(messaging.defectTapeEmailIntro, vars);
      const o = await sendAutomation(db, {
        key: a.key,
        to: { phone: e?.contact_phone ? normalisePhoneAU(e.contact_phone) : null, email: e?.contact_email?.trim() || null },
        sms: { body: renderTemplate(rung.id === "pm" ? messaging.defectTapeSms2 : messaging.defectTapeSms, vars) },
        email: {
          subject: renderTemplate(messaging.defectTapeEmailSubject, vars),
          html: buildPlainEmailHtml({ heading: "Mark any touch-ups with tape", message: intro, companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }),
        },
        ctx: { accountId: e?.account_id ?? null, estimateId: job.estimate_id, workOrderId: job.id, kind: "job_defect_tape" },
        now,
      });
      const ev = await db.from("wo_events").insert({
        work_order_id: job.id, type: "defect_tape_sent", actor_kind: "system",
        meta: { rung: rung.id, day: rung.date, outcome: outcomeWord(o), channels: o.outcome === "sent" ? o.channels : [] },
      });
      if (ev.error) throw ev.error;
      out.dispatched += 1;
    }
  } catch (err) {
    reportError(err, { where: "automations.defectTape" });
  }
  return out;
}
