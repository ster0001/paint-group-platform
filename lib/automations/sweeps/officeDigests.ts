import type { SupabaseClient } from "@supabase/supabase-js";
import { melbourneParts } from "@/lib/time/businessHours";
import { isWorkingDay, melbourneDatePlus, nthWorkingDayAfter, ymdOf } from "@/lib/time/workingDays";
import { melbourneDayStartUtc } from "@/lib/workorder/console";
import { automationOn } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { emailConfigured, sendEmail } from "@/lib/messaging/send";
import { siteUrl } from "@/lib/invoicing/pdf";
import { notifyStaff, type StaffAlertOutcome } from "@/lib/staff/notify";
import { reportError } from "@/lib/monitoring/report";

/**
 * Tom, 12 Oct 2026 — three office reminders on the half-hourly sweep.
 *
 *  1. "Today's follow ups" — Monday to Friday, from 08:00 Melbourne, ONE email
 *     to Tom listing the estimates sent three days ago that are still sent
 *     (not accepted, declined or expired): customer, address, phone, link.
 *     Monday's email also carries the estimates whose three days ran out over
 *     the weekend (sent Wednesday and Thursday), so none is skipped.
 *  2. Pre-start reminder — 14:00 on a business day, a text with the number of
 *     jobs starting in two business days whose pre-start checklist is not
 *     filled out.
 *  3. Final pre-start reminder — 14:00 on a business day, the same for jobs
 *     starting on the next business day (from a Friday, that is Saturday,
 *     Sunday and Monday starts).
 *
 * Each fires once per day: the guard row in `staff_notifications` (event ×
 * day) is the "once". The sweep runs every 30 minutes, so each has a window
 * (08:00–12:00, 14:00–17:00): the first run inside it sends, a missed morning
 * is never sent late in the evening. Nothing is sent when the list is empty.
 */

export const FOLLOWUP_DIGEST_KEY = "office_followups_digest";
export const PRESTART_KEY = "office_prestart_due";
/** Tom, 12 Oct: "to Tom Roman at tom@paintgroup.com.au". */
export const FOLLOWUP_DIGEST_TO = "tom@paintgroup.com.au";
export const FOLLOWUP_AFTER_DAYS = 3;

const FOLLOWUP_HOURS = { from: 8, until: 12 };
const PRESTART_HOURS = { from: 14, until: 17 };

// ---- pure: which days ---------------------------------------------------------

/**
 * The Melbourne dates whose estimates are due their follow-up today, or null
 * when no email goes today (Saturday, Sunday). Tuesday to Friday: the day
 * three days back. Monday: Wednesday, Thursday and Friday — the three-day
 * marks that fell on Saturday, Sunday and today.
 */
export function followupSentDates(now: Date): string[] | null {
  const { weekday } = melbourneParts(now);
  if (weekday < 1 || weekday > 5) return null;
  const back = weekday === 1 ? [5, 4, 3] : [FOLLOWUP_AFTER_DAYS];
  return back.map((n) => melbourneDatePlus(now, -n));
}

export type PrestartWindow = { which: "two_days" | "final"; after: string; through: string };

/**
 * The start dates each reminder covers, or null on a non-working day. The
 * final reminder covers every start after today up to and including the next
 * business day; the first covers the day after that up to and including the
 * second business day. Between them every start date is reminded twice and
 * none falls through a weekend.
 */
export function prestartWindows(now: Date, holidays: ReadonlySet<string>): PrestartWindow[] | null {
  const p = melbourneParts(now);
  const today = ymdOf(p);
  if (!isWorkingDay(p.weekday, today, holidays)) return null;
  const nbd1 = nthWorkingDayAfter(now, 1, holidays);
  const nbd2 = nthWorkingDayAfter(now, 2, holidays);
  return [
    { which: "final", after: today, through: nbd1 },
    { which: "two_days", after: nbd1, through: nbd2 },
  ];
}

export function inHours(now: Date, h: { from: number; until: number }): boolean {
  const { h: hour } = melbourneParts(now);
  return hour >= h.from && hour < h.until;
}

/**
 * Pre-start checklist "not filled out" — the same test as the start gate
 * (`wo_gate_blocked` pre_start → in_progress): no pre-start list at all, or a
 * required item still unticked.
 */
export function prestartIncomplete(items: ReadonlyArray<{ required: boolean; done_at: string | null }>): boolean {
  return items.length === 0 || items.some((i) => i.required && !i.done_at);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The text's words. The SMS goes as "<company>: <subject>\n<link>". */
export function prestartSubject(which: PrestartWindow["which"], count: number): string {
  const jobs = plural(count, "job");
  const verb = count === 1 ? "starts" : "start";
  const has = count === 1 ? "hasn't" : "haven't";
  return which === "final"
    ? `FINAL reminder: ${jobs} ${verb} next business day and ${has} had the pre-start checklist filled out`
    : `Reminder: ${jobs} ${verb} within 2 business days and ${has} had the pre-start checklist filled out`;
}

// ---- pure: the follow-ups email ----------------------------------------------

export type FollowupRow = { customer: string; address: string; phone: string; link: string; sentOn: string; title: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function followupEmail(rows: ReadonlyArray<FollowupRow>, companyName: string): { subject: string; html: string } {
  const subject = `Today's follow ups — ${plural(rows.length, "estimate")} sent ${FOLLOWUP_AFTER_DAYS} days ago, not accepted`;
  const td = 'style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937;vertical-align:top;"';
  const th = 'style="padding:8px 10px;border-bottom:2px solid #d1d5db;font-size:12px;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.04em;"';
  const body = rows.map((r) => `<tr>
    <td ${td}><b>${esc(r.customer)}</b><br/><span style="font-size:12px;color:#6b7280;">sent ${esc(r.sentOn)}</span></td>
    <td ${td}>${esc(r.address)}</td>
    <td ${td}>${r.phone ? `<a href="tel:${esc(r.phone.replace(/\s+/g, ""))}" style="color:#0e7490;">${esc(r.phone)}</a>` : '<span style="color:#9ca3af;">no phone</span>'}</td>
    <td ${td}><a href="${esc(r.link)}" style="color:#0e7490;font-weight:600;">Open estimate</a></td>
  </tr>`).join("");
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">
  <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:96%;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:22px 26px 6px;">
      <h1 style="margin:0 0 6px;font-size:20px;color:#111827;">Today's follow ups</h1>
      <p style="margin:0 0 14px;font-size:14px;color:#4b5563;">${esc(plural(rows.length, "estimate"))} sent ${FOLLOWUP_AFTER_DAYS} days ago and not accepted yet.</p>
    </td></tr>
    <tr><td style="padding:0 16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><th ${th}>Customer</th><th ${th}>Address</th><th ${th}>Phone</th><th ${th}>Estimate</th></tr>
        ${body}
      </table>
    </td></tr>
    <tr><td style="padding:14px 26px;border-top:1px solid #e5e7eb;"><p style="margin:0;font-size:12px;color:#9ca3af;">${esc(companyName)} · sent Monday to Friday at 8am</p></td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}

// ---- the sweep ----------------------------------------------------------------

type Json = Record<string, unknown> | null;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function addressOf(snapshot: string, ja: Json): string {
  if (snapshot) return snapshot;
  if (!ja) return "";
  return [str(ja.address), str(ja.city), str(ja.state), str(ja.postal)].filter(Boolean).join(", ");
}

async function claimDay(db: SupabaseClient, key: string, entityId: string): Promise<boolean> {
  const { data, error } = await db.from("staff_notifications")
    .upsert({ event_key: key, entity_id: entityId }, { onConflict: "event_key,entity_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

export type FollowupOutcome = "not_now" | "off" | "nothing" | "already" | "sent" | "failed" | "error" | "dry";

/** `dry` (a hand run's `?dry=1`, the e2e): work the list out, send nothing, claim nothing. */
type SweepOpts = { force?: boolean; dry?: boolean };

export async function sendFollowupDigest(db: SupabaseClient, now: Date, opts: SweepOpts = {}): Promise<{ outcome: FollowupOutcome; count: number; rows?: FollowupRow[] }> {
  try {
    const dates = followupSentDates(now);
    if (!dates || (!opts.force && !inHours(now, FOLLOWUP_HOURS))) return { outcome: "not_now", count: 0 };
    const { messaging, company } = await loadMessaging(db);
    if (!automationOn(messaging, FOLLOWUP_DIGEST_KEY)) return { outcome: "off", count: 0 };

    const sorted = [...dates].sort();
    const from = melbourneDayStartUtc(new Date(`${sorted[0]}T12:00:00Z`));
    const to = melbourneDayStartUtc(new Date(`${melbourneDatePlus(new Date(`${sorted[sorted.length - 1]}T12:00:00Z`), 1)}T12:00:00Z`));
    const { data, error } = await db.from("estimates")
      .select("id, title, sent_at, snap_name:sent_snapshot->>contactName, snap_address:sent_snapshot->>jobAddress, contact:builder_state->contact, job_address:builder_state->jobAddress, accounts(name, phone)")
      .eq("status", "sent").gte("sent_at", from).lt("sent_at", to)
      .order("sent_at", { ascending: true }).limit(200);
    if (error) throw error;

    type Row = { id: string; title: string | null; sent_at: string; snap_name: string | null; snap_address: string | null; contact: Json; job_address: Json; accounts: { name: string | null; phone: string | null } | null };
    const fmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
    const rows: FollowupRow[] = ((data ?? []) as unknown as Row[]).map((e) => ({
      customer: str(e.snap_name) || str(e.contact?.name) || str(e.accounts?.name) || str(e.title) || "Unnamed customer",
      address: addressOf(str(e.snap_address), e.job_address) || str(e.title),
      phone: str(e.contact?.phone) || str(e.accounts?.phone),
      link: `${siteUrl()}/quote?id=${e.id}`,
      sentOn: fmt.format(new Date(e.sent_at)),
      title: str(e.title),
    }));
    if (opts.dry) return { outcome: "dry", count: rows.length, rows };
    if (rows.length === 0) return { outcome: "nothing", count: 0 };

    const day = ymdOf(melbourneParts(now));
    if (!(await claimDay(db, FOLLOWUP_DIGEST_KEY, day))) return { outcome: "already", count: rows.length };
    const { subject, html } = followupEmail(rows, company.name || "Paint Group");
    if (!emailConfigured()) {
      console.log(`[followups:log-driver] email to=${FOLLOWUP_DIGEST_TO} subject="${subject}"`);
      return { outcome: "sent", count: rows.length };
    }
    const res = await sendEmail({ to: FOLLOWUP_DIGEST_TO, subject, html, ctx: { kind: "staff_alert" } });
    await db.from("staff_notifications").update({ recipients: [{ to: FOLLOWUP_DIGEST_TO, channel: "email", status: res.status }] })
      .eq("event_key", FOLLOWUP_DIGEST_KEY).eq("entity_id", day);
    return { outcome: res.status === "sent" ? "sent" : "failed", count: rows.length };
  } catch (e) {
    reportError(e, { where: "officeDigests.followups" });
    return { outcome: "error", count: 0 };
  }
}

export type PrestartOutcome = { which: PrestartWindow["which"]; count: number; outcome: StaffAlertOutcome | "nothing" | "dry"; workOrderIds?: string[]; subject?: string };

export async function sendPrestartReminders(db: SupabaseClient, now: Date, opts: SweepOpts = {}): Promise<PrestartOutcome[] | "not_now" | "error"> {
  try {
    if (!opts.force && !inHours(now, PRESTART_HOURS)) return "not_now";
    const rules = await db.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    if (rules.error) throw rules.error;
    const raw = (rules.data as { value?: { publicHolidays?: unknown } } | null)?.value?.publicHolidays;
    const holidays = new Set(Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string") : []);
    const windows = prestartWindows(now, holidays);
    if (!windows) return "not_now";

    const after = windows[0].after;
    const through = windows[windows.length - 1].through;
    const jobs = await db.from("work_orders").select("id, wo_ref, start_date")
      .in("stage", ["offered", "pre_start"]).gt("start_date", after).lte("start_date", through).limit(500);
    if (jobs.error) throw jobs.error;
    const list = (jobs.data ?? []) as { id: string; wo_ref: string | null; start_date: string }[];
    const items = list.length === 0 ? { data: [], error: null } : await db.from("wo_checklist_items")
      .select("work_order_id, required, done_at").eq("phase", "pre_start").in("work_order_id", list.map((j) => j.id)).limit(5000);
    if (items.error) throw items.error;
    const byJob = new Map<string, { required: boolean; done_at: string | null }[]>();
    for (const i of (items.data ?? []) as { work_order_id: string; required: boolean; done_at: string | null }[]) {
      byJob.set(i.work_order_id, [...(byJob.get(i.work_order_id) ?? []), i]);
    }

    const day = ymdOf(melbourneParts(now));
    const out: PrestartOutcome[] = [];
    for (const w of windows) {
      const due = list.filter((j) => j.start_date > w.after && j.start_date <= w.through && prestartIncomplete(byJob.get(j.id) ?? []));
      if (due.length === 0 && !opts.dry) { out.push({ which: w.which, count: 0, outcome: "nothing" }); continue; }
      const subject = prestartSubject(w.which, due.length);
      if (opts.dry) { out.push({ which: w.which, count: due.length, outcome: "dry", workOrderIds: due.map((j) => j.id), subject }); continue; }
      const refs = due.map((j) => `${j.wo_ref ?? j.id.slice(0, 8)} (starts ${j.start_date})`).join(", ");
      const outcome = await notifyStaff(db, {
        key: PRESTART_KEY, entityId: `${w.which}:${day}`,
        subject,
        message: `${subject}: ${refs}. Open PC Command to fill them out.`,
        link: `${siteUrl()}/pc/flow`,
      });
      out.push({ which: w.which, count: due.length, outcome });
    }
    return out;
  } catch (e) {
    reportError(e, { where: "officeDigests.prestart" });
    return "error";
  }
}
