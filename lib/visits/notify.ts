/**
 * What a booking owes the customer (P6): a confirmation with a calendar
 * invite, and a text the evening before. SERVER ONLY.
 *
 * Both ride the automations registry (visit_confirmation / visit_reminder),
 * so the office can switch either off or reword it under Settings →
 * Automations. Both are idempotent off the visit row: confirmation_sent_at
 * records the start time it confirmed (a move confirms again with a higher
 * SEQUENCE so the calendar entry updates in place); reminder_sent_at is
 * cleared by a move, so the new day is reminded too.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildPlainEmailHtml, emailConfigured, sendEmail, sendSms } from "@/lib/messaging/send";
import { isTestEmail } from "@/lib/accounts/identity";
import { buildIcs } from "@/lib/workorder/ics";
import { melbourneParts } from "@/lib/time/businessHours";
import { toE164Au } from "@/lib/campaigns/sms";
import { reportError } from "@/lib/monitoring/report";
import { VISIT_KINDS, type VisitRow } from "./types";

const two = (n: number) => String(n).padStart(2, "0");
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 8 Sep at 10:00 am", Melbourne. */
export function visitWhen(startsAt: string): string {
  const p = melbourneParts(new Date(startsAt));
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${DOW[p.weekday]} ${p.d} ${MON[p.m - 1]} at ${h12}:${two(p.min)} ${p.h < 12 ? "am" : "pm"}`;
}

/** The Melbourne date and wall time of a visit, for the .ics. */
export function visitDateTime(startsAt: string, endsAt: string): { date: string; time: string; minutes: number } {
  const p = melbourneParts(new Date(startsAt));
  return {
    date: `${p.y}-${two(p.m)}-${two(p.d)}`,
    time: `${two(p.h)}:${two(p.min)}`,
    minutes: Math.max(15, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000)),
  };
}

type Ctx = {
  visit: VisitRow;
  customerEmail: string | null;
  customerFirst: string;
  estimatorName: string;
};

async function context(db: SupabaseClient, visitId: string): Promise<Ctx | null> {
  const { data: v } = await db.from("visits").select("id, account_id, property_id, estimate_id, staff_id, starts_at, ends_at, kind, status, source, address, suburb, customer_name, customer_phone, note, outcome_note, outcome_at, cancelled_at, cancel_reason, confirmation_sent_at, reminder_sent_at").eq("id", visitId).maybeSingle();
  if (!v) return null;
  const visit = v as VisitRow;
  const [{ data: acc }, { data: staff }] = await Promise.all([
    visit.account_id ? db.from("accounts").select("email, name, phone").eq("id", visit.account_id).maybeSingle() : Promise.resolve({ data: null }),
    visit.staff_id ? db.from("profiles").select("name").eq("id", visit.staff_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = visit.customer_name || (acc?.name as string | null) || "";
  return {
    visit,
    customerEmail: (acc?.email as string | null) ?? null,
    customerFirst: name.trim().split(/\s+/)[0] || "there",
    estimatorName: (staff?.name as string | null) || "",
  };
}

/** The confirmation email with its .ics — once per booking start; a move confirms again. */
export async function sendVisitConfirmation(db: SupabaseClient, visitId: string): Promise<"sent" | "skipped"> {
  const ctx = await context(db, visitId);
  if (!ctx || ctx.visit.status !== "booked") return "skipped";
  const { visit } = ctx;
  const { messaging, company } = await loadMessaging(db);
  if (!automationOn(messaging, "visit_confirmation")) return "skipped";
  // Already confirmed for THIS start time.
  const stamp = `${visit.starts_at}`;
  if (visit.confirmation_sent_at && (visit.note ?? "").includes(`[confirmed ${stamp}]`)) return "skipped";
  if (!ctx.customerEmail || isTestEmail(ctx.customerEmail)) {
    await db.from("visits").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", visitId);
    return "skipped";
  }

  const companyName = company.name || "Paint Group";
  const estimator = ctx.estimatorName || companyName;
  const vars = { first_name: ctx.customerFirst, estimator_name: estimator, visit_when: visitWhen(visit.starts_at), address: visit.address || "your property", company_name: companyName };
  const subject = renderTemplate(messaging.visitConfirmSubject, vars);
  const body = renderTemplate(messaging.visitConfirmBody, vars);
  const { date, time, minutes } = visitDateTime(visit.starts_at, visit.ends_at);
  // SEQUENCE climbs with every confirmation so a moved visit EDITS the calendar entry.
  const { count } = await db.from("crm_events").select("id", { count: "exact", head: true }).eq("type", "visit_booked").contains("payload", { visitId });
  const kind = VISIT_KINDS.find((k) => k.key === visit.kind)?.label ?? "Visit";
  const ics = buildIcs({
    uid: `visit-${visit.id}@paintgroup`, sequence: Math.max(0, (count ?? 1) - 1), method: "REQUEST",
    summary: `${companyName} — ${kind.toLowerCase()} with ${estimator}`,
    description: `${estimator} from ${companyName} is visiting ${visit.address || "your property"} to look at the job with you.`,
    location: visit.address || undefined, date, time, durationMinutes: minutes,
    organizerEmail: company.email || "email@paintgroup.com.au", organizerName: companyName,
    attendeeEmail: ctx.customerEmail, attendeeName: visit.customer_name || "Customer", now: new Date(),
  });
  if (emailConfigured()) {
    const sent = await sendEmail({
      to: ctx.customerEmail, subject, replyTo: company.email || undefined,
      html: buildPlainEmailHtml({ heading: `Visit booked — ${visitWhen(visit.starts_at)}`, message: body, companyName, logoUrl: company.logoUrlLight || company.logoUrl, companyPhone: company.phone }),
      attachments: [{ filename: "visit.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; method=REQUEST" }],
      ctx: { accountId: visit.account_id, estimateId: visit.estimate_id, kind: "visit_confirmation" },
    });
    if (sent.status === "error") reportError(new Error(sent.message ?? "visit confirmation failed"), { where: "visits.confirm.send", extra: { visitId } });
  } else {
    console.log(`[visit-confirm:log-driver] visit=${visitId} to=${ctx.customerEmail} when=${visitWhen(visit.starts_at)}`);
  }
  await db.from("visits").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", visitId);
  return "sent";
}

/** A cancellation pulls the calendar entry (METHOD CANCEL). */
export async function sendVisitCancellation(db: SupabaseClient, visitId: string): Promise<void> {
  const ctx = await context(db, visitId);
  if (!ctx || !ctx.visit.confirmation_sent_at || !ctx.customerEmail || isTestEmail(ctx.customerEmail)) return;
  const { messaging, company } = await loadMessaging(db);
  if (!automationOn(messaging, "visit_confirmation") || !emailConfigured()) return;
  const companyName = company.name || "Paint Group";
  const { date, time, minutes } = visitDateTime(ctx.visit.starts_at, ctx.visit.ends_at);
  const ics = buildIcs({
    uid: `visit-${ctx.visit.id}@paintgroup`, sequence: 99, method: "CANCEL",
    summary: `${companyName} — visit`, location: ctx.visit.address || undefined, date, time, durationMinutes: minutes,
    organizerEmail: company.email || "email@paintgroup.com.au", organizerName: companyName,
    attendeeEmail: ctx.customerEmail, attendeeName: ctx.visit.customer_name || "Customer", now: new Date(),
  });
  await sendEmail({
    to: ctx.customerEmail, subject: `Visit cancelled — ${visitWhen(ctx.visit.starts_at)}`, replyTo: company.email || undefined,
    html: buildPlainEmailHtml({ heading: "Visit cancelled", message: `The visit on ${visitWhen(ctx.visit.starts_at)} has been taken out of the calendar. We'll be in touch to find another time.`, companyName, logoUrl: company.logoUrlLight || company.logoUrl, companyPhone: company.phone }),
    attachments: [{ filename: "visit-cancelled.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; method=CANCEL" }],
    ctx: { accountId: ctx.visit.account_id, estimateId: ctx.visit.estimate_id, kind: "visit_cancelled" },
  });
}

/** Pure: which booked visits are due a reminder now — tomorrow's, Melbourne, not yet reminded. */
export function dueForReminder(visits: Array<Pick<VisitRow, "id" | "starts_at" | "status" | "reminder_sent_at" | "customer_phone">>, now: Date): typeof visits {
  const p = melbourneParts(now);
  const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d) + 86_400_000);
  const key = `${tomorrow.getUTCFullYear()}-${two(tomorrow.getUTCMonth() + 1)}-${two(tomorrow.getUTCDate())}`;
  return visits.filter((v) => {
    if (v.status !== "booked" || v.reminder_sent_at || !v.customer_phone) return false;
    const s = melbourneParts(new Date(v.starts_at));
    return `${s.y}-${two(s.m)}-${two(s.d)}` === key;
  });
}

/** The evening sweep: text tomorrow's customers. Once per visit. */
export async function sendVisitReminders(db: SupabaseClient, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const { messaging, company } = await loadMessaging(db);
  if (!automationOn(messaging, "visit_reminder")) return { sent: 0, skipped: 0 };
  const { data } = await db.from("visits").select("id, starts_at, ends_at, status, reminder_sent_at, customer_phone, customer_name, address, staff_id, account_id, estimate_id")
    .eq("status", "booked").is("reminder_sent_at", null)
    .gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 2 * 86_400_000).toISOString()).limit(200);
  const due = dueForReminder((data ?? []) as VisitRow[], now);
  let sent = 0, skipped = 0;
  const companyName = company.name || "Paint Group";
  for (const v of due as VisitRow[]) {
    const to = toE164Au(v.customer_phone);
    if (!to) { skipped += 1; continue; }
    let estimator = companyName;
    if (v.staff_id) {
      const { data: s } = await db.from("profiles").select("name").eq("id", v.staff_id).maybeSingle();
      estimator = (s?.name as string | null) || companyName;
    }
    const body = renderTemplate(messaging.visitReminderSms, {
      first_name: (v.customer_name || "").split(/\s+/)[0] || "there", estimator_name: estimator,
      visit_when: visitWhen(v.starts_at).replace(/^\w+ \d+ \w+ /, ""), address: v.address || "your property", company_name: companyName,
    });
    const r = await sendSms({ to, body, ctx: { accountId: v.account_id, estimateId: v.estimate_id, kind: "visit_reminder" } });
    await db.from("visits").update({ reminder_sent_at: now.toISOString() }).eq("id", v.id);
    if (r.status === "sent") sent += 1; else skipped += 1;
  }
  return { sent, skipped };
}
