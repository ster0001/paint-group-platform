/**
 * After the job: R1 review request, R3 and R4 anniversaries (automations brief
 * §4.5; 17 Nov 2026). SERVER ONLY, service client, off the half-hour campaign
 * sweep (`?only=aftercare` is the hand run). All ship off.
 *
 * The anchor is the warranty row a sign-off writes (`warranties.starts_on` =
 * the sign-off day, `ends_on` = when it finishes), so a job is only ever
 * asked after it was signed off.
 *
 *   R1  review_request      text  9 am the day after sign-off, with the brand's
 *                                 Google review link (Settings → Automations);
 *                                 recorded as asked by `wo_review_requested`
 *                                 (PC Command shows it); not sent when staff
 *                                 already asked, or the brand has no link
 *   R3  anniversary_12      chat  12 months after sign-off
 *   R4  anniversary_24      chat  24 months after: the warranty end date, and
 *                                 an exterior line for a job with exterior work
 *
 * From 9 am Melbourne on the day, for a day (`morningBeforeDue`); once per
 * job (automation_claims). R1 is transactional; R3 and R4 are marketing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { morningBeforeDue } from "../dateOffset";
import { sendChatStep } from "../chatStep";
import { streetOf } from "../leadSequence";
import { expiryWords } from "../estimateSequence";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { brandRecord, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { siteUrl } from "@/lib/invoicing/pdf";
import { isTestEmail } from "@/lib/accounts/identity";
import { hasExteriorBlock } from "@/lib/wizard/policy";
import { realOnly } from "@/lib/demo/scope";
import { reportError } from "@/lib/monitoring/report";

export type AftercareResult = { candidates: number; review: number; year1: number; year2: number; noReviewLink: number; error?: string };

const MEL = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
/** The Melbourne calendar day `months` months after `ymd` (the same day of the month, clamped). */
export function monthsAfter(ymd: string, months: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
const dayKey = (d: Date) => MEL.format(d);
const minusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The brand's Google review link, or null when none is set (R1 then sends nothing for that brand). */
export function reviewLinkFor(messaging: MessagingSettings, brand: string): string | null {
  const link = (brand === "painthome" ? messaging.googleReviewLinkPaintHome : messaging.googleReviewLink).trim();
  return /^https?:\/\//.test(link) ? link : null;
}

type W = {
  work_order_id: string; estimate_id: string | null; starts_on: string; ends_on: string;
  estimates: { share_token: string | null; brand: string | null; title: string | null; account_id: string | null;
    sent_snapshot: { jobAddress?: string; contactName?: string; contactEmail?: string } | null;
    builder_state: { blocks?: unknown[]; contact?: { name?: string | null; email?: string | null; phone?: string | null } } | null } | null;
};

export async function runAftercareSweep(db: SupabaseClient, now = new Date()): Promise<AftercareResult> {
  const out: AftercareResult = { candidates: 0, review: 0, year1: 0, year2: 0, noReviewLink: 0 };
  try {
    const { messaging, company } = await loadMessaging(db);
    const on = (k: string) => Boolean(automationByKey(k)) && automationOn(messaging, k);
    const r1 = on("review_request"), r3 = on("anniversary_12"), r4 = on("anniversary_24");
    if (!r1 && !r3 && !r4) return out;

    // The sign-off days each step can be due for: yesterday (R1), a year and two years back (R3, R4) — a day either side.
    const today = dayKey(now);
    const days = new Set<string>();
    if (r1) for (const n of [0, 1, 2]) days.add(minusDays(today, n));
    for (const [flag, months] of [[r3, 12], [r4, 24]] as const) {
      if (!flag) continue;
      for (const n of [-1, 0, 1, 2]) days.add(monthsAfter(minusDays(today, n), -months));
    }
    const { data, error } = await realOnly(db.from("warranties")
      .select("work_order_id, estimate_id, starts_on, ends_on, estimates(share_token, brand, title, account_id, sent_snapshot, builder_state)"))
      .in("starts_on", [...days]).limit(500);
    if (error) throw error;
    const rows = (data ?? []) as unknown as W[];
    out.candidates = rows.length;
    if (rows.length === 0) return out;

    const asked = new Set<string>();
    if (r1) {
      const { data: rr, error: rErr } = await db.from("review_requests").select("work_order_id").in("work_order_id", rows.map((r) => r.work_order_id)).not("sent_at", "is", null);
      if (rErr) throw rErr;
      for (const r of (rr ?? []) as { work_order_id: string }[]) asked.add(r.work_order_id);
    }

    for (const w of rows) {
      const e = w.estimates;
      if (!e || !w.estimate_id) continue;
      const c = e.builder_state?.contact ?? {};
      const email = (c.email || e.sent_snapshot?.contactEmail || "").trim() || null;
      if (email && isTestEmail(email)) continue;
      const brand = messageBrandOf(e.brand);
      const name = (e.sent_snapshot?.contactName || c.name || "").trim();
      const link = e.share_token ? `${publicOriginFor(brand, siteUrl())}/e/${e.share_token}` : `${publicOriginFor(brand, siteUrl())}/account`;
      const vars = {
        first_name: name.split(/\s+/)[0] || "there", address: streetOf(e.sent_snapshot?.jobAddress || e.title || "") || "your place",
        brand: brandRecord(brand).name, link, warranty_end: expiryWords(w.ends_on),
        exterior_line: hasExteriorBlock(e.builder_state?.blocks ?? []) ? messaging.anniversaryExteriorLine : "",
      };

      // R1: the morning after sign-off.
      if (r1 && morningBeforeDue(w.starts_on, -1, now) && !asked.has(w.work_order_id)) {
        const reviewLink = reviewLinkFor(messaging, brand);
        const phone = c.phone ? normalisePhoneAU(c.phone) : null;
        if (!reviewLink) out.noReviewLink += 1;
        else if (phone && (await claimRung(db, "review_request", w.work_order_id, ""))) {
          const r1Vars = { ...vars, review_link: reviewLink };
          const o = await sendAutomation(db, { key: "review_request", to: { phone }, sms: { body: renderTemplate(messaging.reviewRequestSms, r1Vars) }, ctx: { estimateId: w.estimate_id, accountId: e.account_id }, now });
          const word = outcomeWord(o);
          if (word === "sent" || word === "not_configured" || o.outcome === "held") {
            const { data: rec, error: recErr } = await db.rpc("wo_review_requested", { p_work_order_id: w.work_order_id, p_via: "automation" });
            if (recErr || (typeof rec === "string" && rec.startsWith("error"))) reportError(new Error(`wo_review_requested: ${recErr?.message ?? rec}`), { where: "automations.aftercare.review", bestEffort: true });
            out.review += 1;
          }
        }
      }
      // R3 / R4: the anniversaries, on the chat.
      for (const [flag, months, key, subjectT, bodyT] of [
        [r3, 12, "anniversary_12", messaging.anniversary12Subject, messaging.anniversary12Body],
        [r4, 24, "anniversary_24", messaging.anniversary24Subject, messaging.anniversary24Body],
      ] as const) {
        if (!flag || !e.share_token || !morningBeforeDue(monthsAfter(w.starts_on, months), 0, now)) continue;
        if (!(await claimRung(db, key, w.work_order_id, ""))) continue;
        const ok = await sendChatStep(db, {
          key, estimateId: w.estimate_id, accountId: e.account_id, email, brand, company,
          subject: renderTemplate(subjectT, vars), body: renderTemplate(bodyT, vars).trim(), link, now,
        });
        if (ok) { if (months === 12) out.year1 += 1; else out.year2 += 1; }
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    reportError(err, { where: "automations.aftercare" });
  }
  return out;
}
