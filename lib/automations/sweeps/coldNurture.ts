/**
 * R5 — cold nurture (automations brief §4.5; 17 Nov 2026). SERVER ONLY,
 * service client, off the half-hour campaign sweep (`?only=nurture` is the
 * hand run). Ships off; marketing (STOP, unsubscribe and declined permits
 * stop it, in sendAutomation).
 *
 * Who is cold, and once a quarter, is lib/automations/coldNurture.ts. The
 * message is a chat step on their last estimate's page with the email
 * (sendChatStep): the season's line, a finished job like theirs with its
 * price (lib/automations/showcasePick.ts — none, nothing sent), and the link
 * to a fresh range.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { claimRung } from "../reminders";
import { sendChatStep } from "../chatStep";
import { streetOf } from "../leadSequence";
import { coldPerCustomer, nurtureHour, quarterKey, seasonalLine, COLD_UNTIL_DAYS, type ColdCandidate } from "../coldNurture";
import { pickShowcase, suburbOf } from "../showcasePick";
import { loadShowcaseForMessages, showcaseVars } from "../showcaseLoad";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { brandRecord, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { siteUrl } from "@/lib/invoicing/pdf";
import { isTestEmail } from "@/lib/accounts/identity";
import { parseLeadSnapshot } from "@/lib/estimate/leadSnapshot";
import { realOnly } from "@/lib/demo/scope";
import { forBrand, loadBrandWording } from "@/lib/messaging/brandWording";
import { reportError } from "@/lib/monitoring/report";

export type ColdNurtureResult = { cold: number; sent: number; noShowcase: number; skipped?: "off" | "hours"; error?: string };

type Row = ColdCandidate & {
  share_token: string | null; brand: string | null; title: string | null; lead_snapshot: unknown;
  sent_snapshot: { jobAddress?: string; contactName?: string; contactEmail?: string } | null;
  contact_name: string | null; contact_email: string | null; job_type: string | null;
};

export async function runColdNurtureSweep(db: SupabaseClient, now = new Date()): Promise<ColdNurtureResult> {
  const out: ColdNurtureResult = { cold: 0, sent: 0, noShowcase: 0 };
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!automationByKey("cold_nurture") || !automationOn(messaging, "cold_nurture")) return { ...out, skipped: "off" };
    if (!nurtureHour(now)) return { ...out, skipped: "hours" };

    const since = new Date(now.getTime() - COLD_UNTIL_DAYS * 86_400_000).toISOString();
    const { data, error } = await realOnly(db.from("estimates")
      .select("id, status, account_id, created_at, sent_at, declined_at, valid_until, accepted_at, share_token, brand, title, lead_snapshot, sent_snapshot, contact_name:builder_state->contact->>name, contact_email:builder_state->contact->>email, job_type:builder_state->wizard->state->>jobType"))
      .gte("created_at", since).not("share_token", "is", null).order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as Array<Omit<Row, "lead">>).map((r) => ({ ...r, lead: r.lead_snapshot != null }) as Row);
    const cold = coldPerCustomer(rows, now);
    out.cold = cold.length;
    if (cold.length === 0) return out;

    const showcase = await loadShowcaseForMessages(db);
    const bw = await loadBrandWording(db);
    if (bw.error) reportError(new Error(`brand wording: ${bw.error}`), { where: "automations.coldNurture.brandWording", bestEffort: true });
    const quarter = quarterKey(now);
    for (const { estimate: e, customer } of cold) {
      const email = (e.contact_email || e.sent_snapshot?.contactEmail || "").trim() || null;
      if (!email || isTestEmail(email)) continue;
      const snap = parseLeadSnapshot(e.lead_snapshot);
      const address = e.sent_snapshot?.jobAddress || snap?.address || e.title || "";
      const brand = messageBrandOf(e.brand);
      const pick = pickShowcase(showcase.jobs, { suburb: suburbOf(address), jobType: snap?.jobType ?? e.job_type, brand, paintHomeCapCents: showcase.paintHomeCapCents });
      if (!pick) { out.noShowcase += 1; continue; }
      if (!(await claimRung(db, "cold_nurture", customer, quarter))) continue;
      const origin = publicOriginFor(brand, siteUrl());
      const m = forBrand(messaging, bw.wording, brand);
      const name = (e.sent_snapshot?.contactName || e.contact_name || snap?.firstName || "").trim();
      const vars = {
        first_name: name.split(/\s+/)[0] || "there", address: streetOf(address) || "your place", brand: brandRecord(brand).name,
        seasonal_line: seasonalLine(now, m), link: `${origin}/wizard`, ...showcaseVars(pick, origin),
      };
      const ok = await sendChatStep(db, {
        key: "cold_nurture", estimateId: e.id, accountId: e.account_id, email, brand, company,
        subject: renderTemplate(m.coldNurtureSubject, vars), body: renderTemplate(m.coldNurtureBody, vars),
        link: `${origin}/e/${e.share_token}`, now,
      });
      if (ok) out.sent += 1;
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    reportError(err, { where: "automations.coldNurture" });
  }
  return out;
}
