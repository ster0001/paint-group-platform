/**
 * Session 3 of the messaging brief (16 Sep 2026) — money and sign-off
 * reminders. SERVER ONLY, service client. Runs from the 30-minute sweep.
 *
 *   invoice_reminder          due +N days (four rungs) while a balance is owing
 *   deposit_reminder          N days after issue, N days before the start date
 *   signoff_reminder          the database ladder (wo_signoff_sweep) records
 *                             0/24/48 h rungs as `signoff_nudge` events; this
 *                             sends each one exactly once
 *   variation_reminder        N h after a variation is priced, again later
 *   contractor_invoice_prompt at sign-off, again N days later if not submitted
 *   office_signoff_overdue    staff alert N h after the pack went out unsigned
 *   contractor_offer_reminder (Session 4, D7) 12 h and 20 h after an offer went
 *                             out with no answer; never between 22:00 and 04:59
 *                             Melbourne — held, unclaimed, for the first sweep
 *                             after 5 am, which re-checks the offer is still live
 *
 * Every rung is CLAIMED (automation_claims) before it is sent; only the latest
 * due rung fires (lib/automations/reminders.ts). "Still needed?" is asked
 * before the claim and again if the message is held or queued
 * (stillNeeded.ts). Nothing here writes money or dates — wording only.
 *
 * The planners (`invoiceRungDue` etc.) are pure and tested with a fixed clock.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { timingFor } from "../decide";
import { dueRungs, runLadder, type Rung } from "../reminders";
import { isTestEmail } from "@/lib/accounts/identity";
import { sendAutomation } from "../dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildPlainEmailHtml } from "@/lib/messaging/send";
import { buildInvoiceEmailHtml } from "@/lib/invoicing/sendInvoice";
import { notifyStaff } from "@/lib/staff/notify";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "@/lib/invoicing/pdf";
import { melbourneDateKey } from "../controls";
import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";
import { emailLogoUrl } from "@/lib/messaging/logo";

const OPEN = ["issued", "sent", "viewed", "partially_paid"];
const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateAU = (iso: string) => dayInstant(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" });
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";

// ---- pure planners -----------------------------------------------------------

/** Midday Melbourne on a calendar date — the instant a "due +N days" rung is measured from. */
export function dayInstant(isoDate: string, plusDays = 0): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const noon = melbourneInstant(y, m, d, 12);
  const p = melbourneParts(new Date(noon.getTime() + plusDays * 86_400_000));
  return melbourneInstant(p.y, p.m, p.d, 12);
}

export type InvoiceRow = {
  id: string; number: string | null; kind: string; status: string; due_on: string | null; issued_on: string | null;
  total_inc_cents: number; token: string; account_id: string | null; estimate_id: string; chase_hold_reason: string | null;
  paid_cents: number;
  estimates?: { accepted_name: string | null; contact_email: string | null; contact_phone: string | null; contact_first: string | null } | null;
};

/** The invoice ladder's rungs, in hours after the due date's midday. */
export function invoiceRungs(days: [number, number, number, number]): Rung[] {
  return days.map((d, i) => ({ id: `rung${i + 1}`, afterHours: d * 24 }));
}

/** Whether an invoice is chaseable at all: open, owing, not on hold, past due. */
export function invoiceChaseable(inv: Pick<InvoiceRow, "status" | "due_on" | "total_inc_cents" | "paid_cents" | "chase_hold_reason">, now: Date): boolean {
  if (!OPEN.includes(inv.status) || !inv.due_on || inv.chase_hold_reason) return false;
  if (inv.total_inc_cents - inv.paid_cents <= 0) return false;
  return dayInstant(inv.due_on).getTime() < now.getTime();
}

/** Deposit rungs: an instant each, or null when the input is missing. */
export function depositRungInstants(inv: { issued_on: string | null }, startDate: string | null, afterIssueDays: number, beforeStartDays: number): { afterIssue: Date | null; beforeStart: Date | null } {
  return {
    afterIssue: inv.issued_on ? dayInstant(inv.issued_on, afterIssueDays) : null,
    beforeStart: startDate ? dayInstant(startDate, -beforeStartDays) : null,
  };
}

/**
 * Only invoices that fell due in the last N days are chased: older ones are
 * history, not a burst of "please call us" texts on the day this ships.
 */
export const CHASE_WINDOW_DAYS = 60;

/**
 * One read for every candidate's claims, so the sweep skips a ladder whose
 * latest due rung already fired without a round trip each. Keeps a pass over
 * a busy month to a few queries, not hundreds.
 */
async function claimedSet(db: SupabaseClient, key: string, entityIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < entityIds.length; i += 200) {
    const { data } = await db.from("automation_claims").select("entity_id, rung").eq("automation_key", key).in("entity_id", entityIds.slice(i, i + 200));
    for (const c of (data ?? []) as { entity_id: string; rung: string }[]) out.add(`${c.entity_id}:${c.rung}`);
  }
  return out;
}

/** Pure: the rung a ladder would fire now, or null when nothing is due or it already fired. */
export function rungToFire(anchor: Date, rungs: Rung[], now: Date, claimed: Set<string>, entityId: string): Rung | null {
  const due = dueRungs(anchor, rungs, now);
  if (due.length === 0) return null;
  const latest = due[due.length - 1];
  return claimed.has(`${entityId}:${latest.id}`) ? null : latest;
}

// ---- Session 4: offer reminders (pure parts) ------------------------------------

/** D7: the two rungs, in hours after `booking_offers.offered_at`. */
export function offerReminderRungs(firstHours: number, secondHours: number): Rung[] {
  return [{ id: "first", afterHours: firstHours }, { id: "second", afterHours: secondHours }];
}

/** Tom, 16 Sep (late): no offer reminder between 22:00 and 04:59 Melbourne. Measured from the zone, never a written offset. */
export const OFFER_WINDOW_OPEN_HOUR = 5;
export const OFFER_WINDOW_CLOSE_HOUR = 22;
export function inOfferReminderWindow(now: Date): boolean {
  const h = melbourneParts(now).h;
  return h >= OFFER_WINDOW_OPEN_HOUR && h < OFFER_WINDOW_CLOSE_HOUR;
}

const expiryFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
});
/** "3:15 pm Tue 22 Sep" — the expiry as the painter's phone would read it, in Melbourne. */
export function formatOfferExpiry(at: Date): string {
  const p: Record<string, string> = {};
  for (const part of expiryFmt.formatToParts(at)) p[part.type] = part.value;
  return `${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()} ${p.weekday} ${p.day} ${p.month}`;
}

/**
 * The suburb out of a job address as the work order snapshot holds it
 * ("12 Elm Grove, Thornbury VIC 3071" → "Thornbury"). Falls back to the whole
 * address when there is no comma, and to the fallback when there is nothing.
 */
export function suburbFromAddress(address: string | null | undefined, fallback: string): string {
  const raw = (address ?? "").trim();
  if (!raw) return fallback;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const candidate = parts.length > 1 ? parts[1] : parts[0];
  const cleaned = candidate
    .replace(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT|Victoria|Australia)\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

// ---- recipients ---------------------------------------------------------------

type Recipient = { email: string | null; phone: string | null; firstName: string; accountId: string | null };

/**
 * Who gets a money message. Trade accounts: the finance seat's login email
 * when one exists (else admins/owners); everyone else: the estimate's
 * contact. The phone is always the estimate contact's.
 */
async function moneyRecipient(db: SupabaseClient, inv: Pick<InvoiceRow, "estimates" | "account_id">): Promise<Recipient> {
  const e = inv.estimates ?? null;
  const accountId = inv.account_id;
  const out: Recipient = {
    email: e?.contact_email?.trim() || null,
    phone: e?.contact_phone ? normalisePhoneAU(e.contact_phone) : null,
    firstName: (e?.contact_first || first(e?.accepted_name)).trim() || "there",
    accountId,
  };
  if (!accountId) return out;
  try {
    const { data: acc } = await db.from("accounts").select("account_type").eq("id", accountId).maybeSingle();
    if ((acc as { account_type?: string } | null)?.account_type !== "trade") return out;
    const { data: members } = await db.from("account_users").select("profile_id, role").eq("account_id", accountId);
    const rows = (members ?? []) as { profile_id: string; role: string }[];
    const pick = rows.find((m) => m.role === "finance") ?? rows.find((m) => m.role === "admin" || m.role === "owner");
    if (!pick) return out;
    const { data: u } = await db.auth.admin.getUserById(pick.profile_id);
    const email = u?.user?.email?.trim();
    if (email) out.email = email;
  } catch (e) {
    reportError(e, { where: "moneySignoff.tradeRecipient", bestEffort: true });
  }
  return out;
}

// ---- the sweeps ----------------------------------------------------------------

export type MoneySignoffResult = {
  invoices: { fired: number; stopped: number };
  deposits: { fired: number; stopped: number };
  signoff: { fired: number; nudged: number };
  variations: { fired: number; stopped: number };
  contractorPrompts: { fired: number; stopped: number };
  /** Session 4: `held` = a rung was due inside the night window and waits, unclaimed, for the morning sweep. */
  offerReminders: { fired: number; stopped: number; held: number };
  signoffOverdue: number;
  /** Milliseconds per section — the cron log reads these. */
  ms: Record<string, number>;
};

export type MoneySignoffOptions = {
  /** The e2e (and a deliberate hand run) only: send offer reminders regardless of the Melbourne night window. */
  ignoreOfferWindow?: boolean;
};

export async function runMoneySignoffSweep(db: SupabaseClient, now = new Date(), opts: MoneySignoffOptions = {}): Promise<MoneySignoffResult> {
  const out: MoneySignoffResult = {
    invoices: { fired: 0, stopped: 0 }, deposits: { fired: 0, stopped: 0 }, signoff: { fired: 0, nudged: 0 },
    variations: { fired: 0, stopped: 0 }, contractorPrompts: { fired: 0, stopped: 0 },
    offerReminders: { fired: 0, stopped: 0, held: 0 }, signoffOverdue: 0, ms: {},
  };
  const timed = async (name: string, fn: () => Promise<void>) => {
    const t = Date.now();
    try { await fn(); } catch (e) { reportError(e, { where: `moneySignoff.${name}` }); }
    out.ms[name] = Date.now() - t;
  };
  const { messaging, company } = await loadMessaging(db);
  const companyName = company.name || "Paint Group";
  const brand = { companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone };

  await timed("invoices", () => invoiceReminders(db, messaging, brand, now, out));
  await timed("deposits", () => depositReminders(db, messaging, brand, now, out));
  await timed("signoff", () => signoffReminders(db, messaging, brand, now, out));
  await timed("variations", () => variationReminders(db, messaging, now, out));
  await timed("contractorPrompts", () => contractorInvoicePrompts(db, messaging, now, out));
  await timed("offerReminders", () => offerReminders(db, messaging, now, out, opts.ignoreOfferWindow === true));
  await timed("signoffOverdue", () => signoffOverdueAlerts(db, messaging, now, out));
  return out;
}

type Brand = { companyName: string; logoUrl?: string; companyPhone?: string };

/** One invoice, fresh: open, owing, not on hold — the "still needed?" question. */
async function stillOwing(db: SupabaseClient, invoiceId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data } = await db.from("invoices").select("status, total_inc_cents, chase_hold_reason").eq("id", invoiceId).maybeSingle();
  const inv = data as { status: string; total_inc_cents: number; chase_hold_reason: string | null } | null;
  if (!inv || !OPEN.includes(inv.status)) return { ok: false, reason: "The invoice is no longer open." };
  if (inv.chase_hold_reason) return { ok: false, reason: `Reminders paused: ${inv.chase_hold_reason}` };
  const { data: pays } = await db.from("payments").select("amount_cents").eq("invoice_id", invoiceId).eq("status", "succeeded");
  const paid = ((pays ?? []) as { amount_cents: number }[]).reduce((n, p) => n + p.amount_cents, 0);
  return paid >= inv.total_inc_cents ? { ok: false, reason: "Paid." } : { ok: true };
}

async function openInvoices(db: SupabaseClient, kinds?: string[]): Promise<InvoiceRow[]> {
  const since = melbourneDateKey(new Date(Date.now() - CHASE_WINDOW_DAYS * 86_400_000));
  let q = db.from("invoices")
    .select("id, number, kind, status, due_on, issued_on, total_inc_cents, token, account_id, estimate_id, chase_hold_reason, estimates(accepted_name, contact_email:sent_snapshot->>contactEmail, contact_phone:builder_state->contact->>phone, contact_first:builder_state->contact->>first_name)")
    .in("status", OPEN).gte("due_on", since).order("due_on", { ascending: false }).limit(500);
  if (kinds) q = q.in("kind", kinds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Omit<InvoiceRow, "paid_cents">[];
  if (rows.length === 0) return [];
  const { data: pays } = await db.from("payments").select("invoice_id, amount_cents, status").in("invoice_id", rows.map((r) => r.id)).eq("status", "succeeded");
  const paid = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount_cents: number }[]) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + p.amount_cents);
  return rows.map((r) => ({ ...r, paid_cents: paid.get(r.id) ?? 0 }));
}

async function invoiceReminders(db: SupabaseClient, messaging: MessagingSettings, brand: Brand, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("invoice_reminder");
  if (!a || !automationOn(messaging, a.key)) return;
  const days: [number, number, number, number] = [timingFor(a, messaging, "rung1"), timingFor(a, messaging, "rung2"), timingFor(a, messaging, "rung3"), timingFor(a, messaging, "rung4")];
  const rungs = invoiceRungs(days);
  const candidates = (await openInvoices(db)).filter((inv) => invoiceChaseable(inv, now));
  const claimed = await claimedSet(db, a.key, candidates.map((c) => c.id));
  for (const inv of candidates) {
    if (!rungToFire(dayInstant(inv.due_on!), rungs, now, claimed, inv.id)) continue;
    // Test fixtures never get chased, nor claimed — decided before any lookup.
    const contactEmail = inv.estimates?.contact_email?.trim() ?? "";
    if (!contactEmail || isTestEmail(contactEmail)) continue;
    const who = await moneyRecipient(db, inv);
    if (!who.email) continue;
    const r = await runLadder(db, {
      key: a.key, entityId: inv.id, anchor: dayInstant(inv.due_on!), rungs, now,
      stillNeeded: () => stillOwing(db, inv.id),
      send: async (rung) => {
        const n = Number(rung.id.replace("rung", "")) as 1 | 2 | 3 | 4;
        const link = `${siteUrl()}/i/${inv.token}`;
        const daysOverdue = Math.max(1, Math.floor((now.getTime() - dayInstant(inv.due_on!).getTime()) / 86_400_000));
        const vars = {
          first_name: who.firstName, invoice_number: inv.number ?? "", amount: money(inv.total_inc_cents - inv.paid_cents),
          due_date: dateAU(inv.due_on!), days_overdue: String(daysOverdue), company_name: brand.companyName, link,
        };
        const subjectField = `invoiceReminder${n}Subject` as const;
        const bodyField = `invoiceReminder${n}Body` as const;
        const subject = renderTemplate(messaging[subjectField], vars);
        const intro = renderTemplate(messaging[bodyField], vars);
        await sendAutomation(db, {
          key: a.key,
          to: { email: who.email, phone: n >= 3 ? who.phone : null },
          email: { subject, html: buildInvoiceEmailHtml({ companyName: brand.companyName, heading: subject, intro, link, buttonLabel: "View and pay the invoice", bank: {}, reference: null }) },
          sms: n >= 3 ? { body: renderTemplate(messaging.invoiceReminderSms, vars) } : undefined,
          ctx: { accountId: inv.account_id, estimateId: inv.estimate_id, invoiceId: inv.id, kind: "invoice_reminder" }, now,
        });
      },
    });
    if (r.fired) out.invoices.fired += 1;
    if (r.stopped) out.invoices.stopped += 1;
  }
}

async function depositReminders(db: SupabaseClient, messaging: MessagingSettings, brand: Brand, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("deposit_reminder");
  if (!a || !automationOn(messaging, a.key)) return;
  const afterIssue = timingFor(a, messaging, "afterIssue");
  const beforeStart = timingFor(a, messaging, "beforeStart");
  const deposits = (await openInvoices(db, ["deposit"])).filter((i) => i.total_inc_cents - i.paid_cents > 0 && !i.chase_hold_reason);
  if (deposits.length === 0) return;
  const claimed = await claimedSet(db, a.key, deposits.map((d) => d.id));
  const { data: wos } = await db.from("work_orders").select("estimate_id, start_date").in("estimate_id", deposits.map((d) => d.estimate_id));
  const startOf = new Map(((wos ?? []) as { estimate_id: string; start_date: string | null }[]).map((w) => [w.estimate_id, w.start_date]));
  for (const inv of deposits) {
    const at = depositRungInstants(inv, startOf.get(inv.estimate_id) ?? null, afterIssue, beforeStart);
    // Two independent rungs, each anchored on its own date; both stop on payment.
    const rungs: Rung[] = [];
    if (at.afterIssue) rungs.push({ id: "afterIssue", afterHours: (at.afterIssue.getTime() - now.getTime()) / 3_600_000 });
    if (at.beforeStart) rungs.push({ id: "beforeStart", afterHours: (at.beforeStart.getTime() - now.getTime()) / 3_600_000 });
    if (rungs.length === 0 || !rungToFire(now, rungs, now, claimed, inv.id)) continue;
    const depositEmail = inv.estimates?.contact_email?.trim() ?? "";
    if (!depositEmail || isTestEmail(depositEmail)) continue;
    const who = await moneyRecipient(db, inv);
    if (!who.email) continue;
    const r = await runLadder(db, {
      key: a.key, entityId: inv.id, anchor: now, rungs, now,
      stillNeeded: () => stillOwing(db, inv.id),
      send: async () => {
        const link = `${siteUrl()}/i/${inv.token}`;
        const start = startOf.get(inv.estimate_id);
        const vars = { first_name: who.firstName, company_name: brand.companyName, amount: money(inv.total_inc_cents - inv.paid_cents), start_date: start ? dateAU(start) : "your start date", invoice_number: inv.number ?? "", link };
        const body = renderTemplate(messaging.depositReminderSms, vars);
        await sendAutomation(db, {
          key: a.key, to: { phone: who.phone, email: who.email },
          sms: { body },
          email: { subject: `Your deposit holds your start date — ${brand.companyName}`, html: buildPlainEmailHtml({ heading: "A reminder about your deposit", message: body, companyName: brand.companyName, logoUrl: brand.logoUrl, companyPhone: brand.companyPhone }) },
          ctx: { accountId: inv.account_id, estimateId: inv.estimate_id, invoiceId: inv.id, kind: "deposit_reminder" }, now,
        });
      },
    });
    if (r.fired) out.deposits.fired += 1;
    if (r.stopped) out.deposits.stopped += 1;
  }
}

/**
 * The database ladder records each rung as a `signoff_nudge` wo_event with
 * the compliant wording; this sends every recorded rung once. Ordering: run
 * the RPC first so a rung due this half-hour is recorded and sent together.
 */
async function signoffReminders(db: SupabaseClient, messaging: MessagingSettings, brand: Brand, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("signoff_reminder");
  if (!a || !automationOn(messaging, a.key)) return;
  const { data: swept } = await db.rpc("wo_signoff_sweep");
  out.signoff.nudged = Number((swept as { nudged?: number } | null)?.nudged ?? 0);
  // A rung the RPC recorded a moment ago is stamped AFTER the pass began —
  // measure "due" from this instant, not the sweep's start, or it waits half an hour.
  now = new Date(Math.max(now.getTime(), Date.now()));
  // Fresh jobs only: a pack sent in the last week. Older unsigned jobs are the
  // office's call, not a burst of reminders the day this ships.
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data: fresh } = await db.from("wo_signoff")
    .select("work_order_id, customer_token, nudges, signed_at, work_orders(stage, estimate_id, wo_snapshot, estimates(account_id, accepted_name, contact_email:sent_snapshot->>contactEmail, contact_phone:builder_state->contact->>phone, contact_first:builder_state->contact->>first_name, job_address:sent_snapshot->>jobAddress))")
    .is("signed_at", null).gte("evidence_pack_sent_at", weekAgo).not("customer_token", "is", null).limit(200);
  type Row = { work_order_id: string; customer_token: string; nudges: Record<string, string> | null; signed_at: string | null;
    work_orders: { stage: string; estimate_id: string; wo_snapshot: { jobAddress?: string } | null; estimates: { account_id: string | null; accepted_name: string | null; contact_email: string | null; contact_phone: string | null; contact_first: string | null; job_address: string | null } | null } | null };
  const rows = ((fresh ?? []) as unknown as Row[]).filter((r) => r.work_orders?.stage === "walkthrough");
  if (rows.length === 0) return;
  const claimed = await claimedSet(db, a.key, rows.map((r) => r.work_order_id));
  const { data: events } = await db.from("wo_events").select("work_order_id, meta, created_at").eq("type", "signoff_nudge").in("work_order_id", rows.map((r) => r.work_order_id)).limit(1000);
  const copyOf = new Map<string, string>();
  for (const ev of (events ?? []) as { work_order_id: string; meta: { rung?: number; copy?: string } | null }[]) {
    if (ev.meta?.copy != null) copyOf.set(`${ev.work_order_id}:${ev.meta.rung ?? 0}`, ev.meta.copy);
  }
  for (const r of rows) {
    // The highest rung the database ladder has recorded for this job.
    const recorded = Object.keys(r.nudges ?? {}).map(Number).filter((n) => Number.isFinite(n));
    if (recorded.length === 0) continue;
    const rung = Math.max(...recorded);
    // A recorded rung is due by definition; the database clock may sit a few
    // seconds ahead of this one, so never let its stamp read as "not yet".
    const at = new Date(Math.min(new Date((r.nudges ?? {})[String(rung)]).getTime(), now.getTime()));
    const ladder: Rung[] = [{ id: `nudge${rung}`, afterHours: 0 }];
    if (!rungToFire(at, ladder, now, claimed, r.work_order_id)) continue;
    const e = r.work_orders?.estimates;
    if (!e?.contact_email || isTestEmail(e.contact_email)) continue;
    const res = await runLadder(db, {
      key: a.key, entityId: r.work_order_id, anchor: at, rungs: ladder, now,
      stillNeeded: async () => {
        const { data: s } = await db.from("wo_signoff").select("signed_at").eq("work_order_id", r.work_order_id).maybeSingle();
        return (s as { signed_at: string | null } | null)?.signed_at ? { ok: false, reason: "Signed off." } : { ok: true };
      },
      send: async () => {
        const link = `${siteUrl()}/s/${r.customer_token}`;
        const vars = {
          first_name: (e.contact_first || first(e.accepted_name)).trim() || "there",
          address: e.job_address || r.work_orders?.wo_snapshot?.jobAddress || "your property",
          reminder: copyOf.get(`${r.work_order_id}:${rung}`) ?? "", company_name: brand.companyName, link,
        };
        await sendAutomation(db, {
          key: a.key,
          to: { email: e.contact_email, phone: e.contact_phone ? normalisePhoneAU(e.contact_phone) : null },
          email: { subject: renderTemplate(messaging.signoffReminderSubject, vars), html: buildPlainEmailHtml({ heading: "Please review and sign off", message: renderTemplate(messaging.signoffReminderBody, vars), companyName: brand.companyName, logoUrl: brand.logoUrl, companyPhone: brand.companyPhone }) },
          sms: { body: renderTemplate(messaging.signoffReminderSms, vars) },
          ctx: { accountId: e.account_id ?? null, estimateId: r.work_orders?.estimate_id ?? null, workOrderId: r.work_order_id, kind: "signoff_reminder" }, now,
        });
      },
    });
    if (res.fired) out.signoff.fired += 1;
  }
}

async function variationReminders(db: SupabaseClient, messaging: MessagingSettings, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("variation_reminder");
  if (!a || !automationOn(messaging, a.key)) return;
  const companyName = (await loadMessaging(db)).company.name || "Paint Group";
  const rungs: Rung[] = [{ id: "first", afterHours: timingFor(a, messaging, "first") }, { id: "second", afterHours: timingFor(a, messaging, "second") }];
  const { data: vs } = await db.from("wo_variations")
    .select("id, work_order_id, customer_token, status, customer_responded_at, signed_at, work_orders(wo_ref, estimate_id, estimates(account_id, accepted_name, contact_phone:builder_state->contact->>phone, contact_first:builder_state->contact->>first_name, contact_email:sent_snapshot->>contactEmail))")
    .eq("status", "priced").not("customer_token", "is", null).limit(300);
  const rows = (vs ?? []) as unknown as Array<{ id: string; work_order_id: string; customer_token: string; status: string; customer_responded_at: string | null; signed_at: string | null;
    work_orders: { wo_ref: string; estimate_id: string; estimates: { account_id: string | null; accepted_name: string | null; contact_phone: string | null; contact_first: string | null; contact_email: string | null } | null } | null }>;
  if (rows.length === 0) return;
  const { data: priced } = await db.from("wo_events").select("work_order_id, created_at, meta").eq("type", "variation_priced").in("work_order_id", rows.map((r) => r.work_order_id)).order("created_at", { ascending: false }).limit(1000);
  const pricedAt = new Map<string, string>();
  for (const ev of (priced ?? []) as { work_order_id: string; created_at: string; meta: { variation_id?: string } | null }[]) {
    const vid = ev.meta?.variation_id;
    if (vid && !pricedAt.has(vid)) pricedAt.set(vid, ev.created_at);
  }
  const claimed = await claimedSet(db, a.key, rows.map((r) => r.id));
  for (const v of rows) {
    const anchorIso = pricedAt.get(v.id);
    if (!anchorIso) continue;   // no priced stamp — never guess the anchor
    if (!rungToFire(new Date(anchorIso), rungs, now, claimed, v.id)) continue;
    const e = v.work_orders?.estimates;
    if (e?.contact_email && isTestEmail(e.contact_email)) continue;
    const r = await runLadder(db, {
      key: a.key, entityId: v.id, anchor: new Date(anchorIso), rungs, now,
      stillNeeded: async () => {
        const { data: f } = await db.from("wo_variations").select("status, customer_responded_at, signed_at").eq("id", v.id).maybeSingle();
        const row = f as { status: string; customer_responded_at: string | null; signed_at: string | null } | null;
        if (!row || row.status !== "priced" || row.customer_responded_at || row.signed_at) return { ok: false, reason: "The customer has answered." };
        return { ok: true };
      },
      send: async () => {
        const link = `${siteUrl()}/v/${v.customer_token}`;
        const vars = { first_name: (e?.contact_first || first(e?.accepted_name)).trim() || "there", company_name: companyName, wo_ref: v.work_orders?.wo_ref ?? "", link };
        const body = renderTemplate(messaging.variationReminderSms, vars);
        await sendAutomation(db, {
          key: a.key, to: { phone: e?.contact_phone ? normalisePhoneAU(e.contact_phone) : null, email: e?.contact_email?.trim() || null },
          sms: { body },
          email: { subject: "A change to your painting job is waiting for your approval", html: buildPlainEmailHtml({ heading: "A change is waiting for your approval", message: body, companyName }) },
          ctx: { accountId: e?.account_id ?? null, estimateId: v.work_orders?.estimate_id ?? null, workOrderId: v.work_order_id, kind: "variation_reminder" }, now,
        });
      },
    });
    if (r.fired) out.variations.fired += 1;
    if (r.stopped) out.variations.stopped += 1;
  }
}

async function contractorInvoicePrompts(db: SupabaseClient, messaging: MessagingSettings, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("contractor_invoice_prompt");
  if (!a || !automationOn(messaging, a.key)) return;
  const again = timingFor(a, messaging, "again");
  const rungs: Rung[] = [{ id: "atSignoff", afterHours: 0 }, { id: "again", afterHours: again * 24 }];
  const { data: drafts } = await db.from("contractor_invoices")
    .select("id, work_order_id, contractor_id, status, created_at, work_orders(wo_ref)")
    .eq("status", "draft").eq("auto_draft_source", "signoff").gte("created_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()).limit(300);
  const { contactFor } = await import("@/lib/contractor/notify");
  const { company } = await loadMessaging(db);
  const ciRows = (drafts ?? []) as unknown as Array<{ id: string; work_order_id: string; contractor_id: string; status: string; created_at: string; work_orders: { wo_ref: string } | null }>;
  const claimed = await claimedSet(db, a.key, ciRows.map((c) => c.id));
  for (const ci of ciRows) {
    if (!rungToFire(new Date(ci.created_at), rungs, now, claimed, ci.id)) continue;
    const r = await runLadder(db, {
      key: a.key, entityId: ci.id, anchor: new Date(ci.created_at), rungs, now,
      stillNeeded: async () => {
        const { data: f } = await db.from("contractor_invoices").select("status").eq("id", ci.id).maybeSingle();
        const s = (f as { status?: string } | null)?.status;
        return s === "draft" ? { ok: true } : { ok: false, reason: `Invoice ${s ?? "gone"}.` };
      },
      send: async () => {
        const c = await contactFor(db, ci.contractor_id);
        const link = `${siteUrl()}/portal/money`;
        const body = renderTemplate(messaging.contractorInvoicePromptSms, { first_name: c.firstName, company_name: company.name || "Paint Group", wo_ref: ci.work_orders?.wo_ref ?? "", link });
        await sendAutomation(db, { key: a.key, to: { phone: c.phone }, sms: { body }, ctx: { workOrderId: ci.work_order_id, kind: "contractor_invoice_prompt" }, contractorId: ci.contractor_id, now });
      },
    });
    if (r.fired) out.contractorPrompts.fired += 1;
    if (r.stopped) out.contractorPrompts.stopped += 1;
  }
}

type OfferRow = {
  id: string; work_order_id: string; contractor_id: string; state: string; offered_at: string; expires_at: string; start_date: string | null;
  work_orders: { wo_ref: string; wo_snapshot: { jobAddress?: string | null } | null } | null;
};

/**
 * Session 4 (D7): the offer is still waiting. Only live, unexpired offers are
 * candidates, so an answered or lapsed one simply stops being asked about;
 * `stillNeeded` re-reads the row at send time for the race in between.
 * Outside 05:00–21:59 Melbourne a due rung is counted as `held` and left
 * UNCLAIMED — the first sweep after 5 am picks it up, or drops it if the
 * offer was answered overnight. `ignoreWindow` is the e2e's door only.
 */
async function offerReminders(db: SupabaseClient, messaging: MessagingSettings, now: Date, out: MoneySignoffResult, ignoreWindow: boolean) {
  const a = automationByKey("contractor_offer_reminder");
  if (!a || !automationOn(messaging, a.key)) return;
  const rungs = offerReminderRungs(timingFor(a, messaging, "first"), timingFor(a, messaging, "second"));
  const { data, error } = await db.from("booking_offers")
    .select("id, work_order_id, contractor_id, state, offered_at, expires_at, start_date, work_orders(wo_ref, wo_snapshot)")
    .eq("state", "offered").gt("expires_at", now.toISOString())
    .gte("offered_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .order("offered_at", { ascending: true }).limit(300);
  if (error) throw error;
  const offers = (data ?? []) as unknown as OfferRow[];
  if (offers.length === 0) return;
  const claimed = await claimedSet(db, a.key, offers.map((o) => o.id));
  const inWindow = ignoreWindow || inOfferReminderWindow(now);
  const { contactFor } = await import("@/lib/contractor/notify");
  const { company } = await loadMessaging(db);
  for (const o of offers) {
    const anchor = new Date(o.offered_at);
    if (!rungToFire(anchor, rungs, now, claimed, o.id)) continue;
    if (!inWindow) { out.offerReminders.held += 1; continue; }
    const r = await runLadder(db, {
      key: a.key, entityId: o.id, anchor, rungs, now,
      stillNeeded: async () => {
        const { data: f, error: fErr } = await db.from("booking_offers").select("state, expires_at").eq("id", o.id).maybeSingle();
        if (fErr) throw fErr;
        const row = f as { state: string; expires_at: string } | null;
        if (!row || row.state !== "offered") return { ok: false, reason: `The offer has been ${row?.state ?? "removed"}.` };
        if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "The offer has expired." };
        return { ok: true };
      },
      send: async () => {
        const c = await contactFor(db, o.contractor_id);
        const woRef = o.work_orders?.wo_ref ?? "";
        const vars = {
          first_name: c.firstName, company_name: company.name || "Paint Group", wo_ref: woRef,
          suburb: suburbFromAddress(o.work_orders?.wo_snapshot?.jobAddress, woRef || "the job"),
          start_date: o.start_date ? dateAU(o.start_date) : "date to be confirmed",
          expiry_time: formatOfferExpiry(new Date(o.expires_at)),
          link: `${siteUrl()}/portal/requests`,
        };
        const body = renderTemplate(messaging.offerReminderSms, vars);
        await sendAutomation(db, { key: a.key, to: { phone: c.phone }, sms: { body }, ctx: { workOrderId: o.work_order_id, kind: "offer_reminder" }, contractorId: o.contractor_id, now });
      },
    });
    if (r.fired) out.offerReminders.fired += 1;
    if (r.stopped) out.offerReminders.stopped += 1;
  }
}

async function signoffOverdueAlerts(db: SupabaseClient, messaging: MessagingSettings, now: Date, out: MoneySignoffResult) {
  const a = automationByKey("office_signoff_overdue");
  if (!a || !automationOn(messaging, a.key)) return;
  const hours = timingFor(a, messaging, "after");
  const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const { data } = await db.from("wo_signoff")
    .select("work_order_id, evidence_pack_sent_at, work_orders(wo_ref, stage, wo_snapshot, estimates(title, accepted_name, job_address:sent_snapshot->>jobAddress))")
    .is("signed_at", null).lte("evidence_pack_sent_at", cutoff).not("evidence_pack_sent_at", "is", null).limit(200);
  for (const s of (data ?? []) as unknown as Array<{ work_order_id: string; evidence_pack_sent_at: string; work_orders: { wo_ref: string; stage: string; wo_snapshot: { jobAddress?: string } | null; estimates: { title: string | null; accepted_name: string | null; job_address: string | null } | null } | null }>) {
    if (s.work_orders?.stage !== "walkthrough") continue;
    const job = s.work_orders.estimates?.job_address || s.work_orders.wo_snapshot?.jobAddress || s.work_orders.estimates?.title || s.work_orders.wo_ref;
    const hoursSince = String(Math.floor((now.getTime() - new Date(s.evidence_pack_sent_at).getTime()) / 3_600_000));
    const outcome = await notifyStaff(db, {
      key: "office_signoff_overdue", entityId: s.work_order_id,
      subject: `Sign-off overdue — ${job}`,
      message: `The walkthrough on ${s.work_orders.wo_ref} (${job}) was done and the completion pack sent ${hoursSince} hours ago, but ${s.work_orders.estimates?.accepted_name || "the customer"} has not signed off. Worth a call.`,
      link: `${siteUrl()}/pc/wo/${s.work_order_id}`,
      templates: { subject: "officeSignoffOverdueSubject", body: "officeSignoffOverdueBody" },
      vars: { job, wo_ref: s.work_orders.wo_ref, customer_name: s.work_orders.estimates?.accepted_name || "the customer", hours_since: hoursSince },
    });
    if (outcome === "sent") out.signoffOverdue += 1;
  }
}

/** Exported for the cron log: the Melbourne day this pass counted as. */
export const sweepDay = (now: Date) => melbourneDateKey(now);
