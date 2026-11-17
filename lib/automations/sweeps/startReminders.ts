/**
 * W3 and W4 — the customer's texts before the job starts (automations brief
 * §4.4; 17 Nov 2026). SERVER ONLY, service client, off the half-hour
 * campaign sweep (`?only=start` is the hand run). Both ship off; both are
 * transactional (a job the customer booked), so a marketing STOP does not stop
 * them and quiet hours still do.
 *
 *   W3  colours_tbc     5 days before the start, colours not confirmed
 *   W4  start_reminder  2 days before the start: who is coming, and when
 *
 * "Confirmed" is the person's tick — the pre-start "Colour schedule
 * finalised" item (wo_checklist_items, item_key colours), the rule the
 * portal's colour register reads. From 9 am Melbourne on the day, for a day
 * (`morningBeforeDue`); once per job and start date, so a moved start is
 * reminded for the new day. Only jobs at pre_start: booked, not begun.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { timingFor } from "../decide";
import { morningBeforeDue } from "../dateOffset";
import { streetOf } from "../leadSequence";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { brandRecord, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { siteUrl } from "@/lib/invoicing/pdf";
import { isTestEmail } from "@/lib/accounts/identity";
import { realOnly } from "@/lib/demo/scope";
import { forBrand, loadBrandWording } from "@/lib/messaging/brandWording";
import { reportError } from "@/lib/monitoring/report";

export type StartRemindersResult = { jobs: number; colours: number; start: number; error?: string };

const DATE = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" });
/** "Monday 24 November" — a start date as the texts write {date}. */
export const startDateWords = (ymd: string): string => DATE.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`)).replace(",", "");

type Job = {
  id: string; estimate_id: string; start_date: string;
  contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
  estimates: { share_token: string | null; brand: string | null; title: string | null; account_id: string | null;
    sent_snapshot: { jobAddress?: string; contactName?: string } | null;
    builder_state: { contact?: { name?: string | null; email?: string | null; phone?: string | null } } | null } | null;
};

export async function runStartReminderSweep(db: SupabaseClient, now = new Date()): Promise<StartRemindersResult> {
  const out: StartRemindersResult = { jobs: 0, colours: 0, start: 0 };
  try {
    const { messaging } = await loadMessaging(db);
    const colA = automationByKey("colours_tbc"), startA = automationByKey("start_reminder");
    const colDays = colA && automationOn(messaging, colA.key) ? timingFor(colA, messaging, "beforeStart") : null;
    const startDays = startA && automationOn(messaging, startA.key) ? timingFor(startA, messaging, "beforeStart") : null;
    if (colDays == null && startDays == null) return out;

    const from = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await realOnly(db.from("work_orders")
      .select("id, estimate_id, start_date, contractors(company_name, profiles(name)), estimates(share_token, brand, title, account_id, sent_snapshot, builder_state)"))
      .eq("stage", "pre_start").not("start_date", "is", null).gte("start_date", from).lte("start_date", to).limit(300);
    if (error) throw error;
    const jobs = (data ?? []) as unknown as Job[];
    out.jobs = jobs.length;
    const colourDue = colDays == null ? [] : jobs.filter((j) => morningBeforeDue(j.start_date, colDays, now));
    const startDue = startDays == null ? [] : jobs.filter((j) => morningBeforeDue(j.start_date, startDays, now));
    if (colourDue.length === 0 && startDue.length === 0) return out;

    // Colours confirmed = the person's pre-start tick (the portal register's rule).
    const ticked = new Set<string>();
    if (colourDue.length) {
      const { data: ticks, error: tErr } = await db.from("wo_checklist_items").select("work_order_id, item_key, label")
        .in("work_order_id", colourDue.map((j) => j.id)).eq("phase", "pre_start").not("done_at", "is", null);
      if (tErr) throw tErr;
      for (const t of (ticks ?? []) as { work_order_id: string; item_key: string | null; label: string | null }[]) {
        if (t.item_key === "colours" || t.label === "Colour schedule finalised") ticked.add(t.work_order_id);
      }
    }

    const bw = await loadBrandWording(db);
    if (bw.error) reportError(new Error(`brand wording: ${bw.error}`), { where: "automations.startReminders.brandWording", bestEffort: true });
    const send = async (key: "colours_tbc" | "start_reminder", job: Job, field: "coloursTbcSms" | "startReminderSms"): Promise<boolean> => {
      const e = job.estimates;
      const c = e?.builder_state?.contact ?? {};
      const phone = c.phone ? normalisePhoneAU(c.phone) : null;
      if (!e || !phone || (c.email && isTestEmail(c.email))) return false;
      if (!(await claimRung(db, key, job.id, job.start_date))) return false;
      const brand = messageBrandOf(e.brand);
      const template = forBrand(messaging, bw.wording, brand)[field];
      const name = (e.sent_snapshot?.contactName || c.name || "").trim();
      const painter = (job.contractors?.profiles?.name || job.contractors?.company_name || "Your painter").trim().split(/\s+/)[0] || "Your painter";
      const vars = {
        first_name: name.split(/\s+/)[0] || "there", address: streetOf(e.sent_snapshot?.jobAddress || e.title || "") || "your place",
        date: startDateWords(job.start_date), painter, brand: brandRecord(brand).name,
        link: e.share_token ? `${publicOriginFor(brand, siteUrl())}/e/${e.share_token}` : `${publicOriginFor(brand, siteUrl())}/account`,
      };
      const o = await sendAutomation(db, { key, to: { phone }, sms: { body: renderTemplate(template, vars) }, ctx: { estimateId: job.estimate_id, accountId: e.account_id }, now });
      const word = outcomeWord(o);
      return word === "sent" || word === "not_configured" || o.outcome === "held";
    };
    for (const job of colourDue) if (!ticked.has(job.id) && (await send("colours_tbc", job, "coloursTbcSms"))) out.colours += 1;
    for (const job of startDue) if (await send("start_reminder", job, "startReminderSms")) out.start += 1;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    reportError(e, { where: "automations.startReminders" });
  }
  return out;
}
