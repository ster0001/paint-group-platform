/**
 * Lead L12 (17 Nov 2026): the text after a no-show. SERVER ONLY.
 *
 * When staff mark a visit No show (lib/visits/book.ts setVisitStatus — the
 * one place a visit's status changes from the app), the customer is texted
 * Appendix A's line with a link back to their range page, whose Book a visit
 * button is the way back in (on another phone, after a code to the mobile on
 * file). Ships off (A‑D); a service message, so quiet hours hold it and STOP
 * for marketing does not stop it. Once per visit (automation_claims). A
 * visit whose estimate has no range page is not texted — the Today card
 * ("visit was a no-show, rebook it") is how that one is rebooked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { brandRecord, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { dispatched, sendAutomation } from "@/lib/automations/dispatch";
import { claimRung } from "@/lib/automations/reminders";
import { siteUrl } from "@/lib/invoicing/pdf";
import { toE164Au } from "@/lib/campaigns/sms";
import { streetOf } from "@/lib/automations/leadSequence";
import { reportError } from "@/lib/monitoring/report";
import { forBrand, loadBrandWording } from "@/lib/messaging/brandWording";

export type NoShowOutcome = "sent" | "off" | "already" | "no_link" | "no_mobile" | "not_sent" | "error";

/** Text the customer of a visit just marked No show. Best effort: never undoes the status change. */
export async function sendVisitNoShow(visitId: string, now = new Date(), db?: SupabaseClient): Promise<NoShowOutcome> {
  const svc = db ?? createServiceClient();
  if (!svc) return "off";
  try {
    const { messaging, company } = await loadMessaging(svc);
    if (!automationOn(messaging, "visit_no_show")) return "off";
    const { data: v, error } = await svc.from("visits")
      .select("id, status, customer_name, customer_phone, address, staff_id, account_id, estimate_id, estimates(share_token, brand)")
      .eq("id", visitId).maybeSingle();
    if (error) throw new Error(`visit: ${error.message}`);
    const visit = v as unknown as {
      id: string; status: string; customer_name: string | null; customer_phone: string | null; address: string | null;
      staff_id: string | null; account_id: string | null; estimate_id: string | null;
      estimates: { share_token: string | null; brand: string | null } | null;
    } | null;
    if (!visit || visit.status !== "no_show") return "not_sent";
    const to = toE164Au(visit.customer_phone);
    if (!to) return "no_mobile";
    const token = visit.estimates?.share_token;
    if (!token) return "no_link";
    if (!(await claimRung(svc, "visit_no_show", visit.id, ""))) return "already";
    const brand = messageBrandOf(visit.estimates?.brand);
    let estimator = company.name || brandRecord(brand).name;
    if (visit.staff_id) {
      const { data: s, error: sErr } = await svc.from("profiles").select("name").eq("id", visit.staff_id).maybeSingle();
      if (sErr) reportError(sErr, { where: "visits.noShow.estimator", bestEffort: true });
      estimator = ((s?.name as string | null) || "").trim().split(/\s+/)[0] || estimator;
    }
    const bw = await loadBrandWording(svc);
    if (bw.error) reportError(new Error(`brand wording: ${bw.error}`), { where: "visits.noShow.brandWording", bestEffort: true });
    const body = renderTemplate(forBrand(messaging, bw.wording, brand).visitNoShowSms, {
      first_name: (visit.customer_name || "").trim().split(/\s+/)[0] || "there",
      estimator_name: estimator, company_name: brandRecord(brand).name,
      address: visit.address ? streetOf(visit.address) : "your place",
      link: `${publicOriginFor(brand, siteUrl())}/e/${token}`,
    });
    const r = await sendAutomation(svc, {
      key: "visit_no_show", to: { phone: to }, sms: { body },
      ctx: { accountId: visit.account_id, estimateId: visit.estimate_id, kind: "visit_no_show" }, now,
    });
    return dispatched(r) ? "sent" : "not_sent";
  } catch (e) {
    reportError(e, { where: "visits.noShow", extra: { visitId } });
    return "error";
  }
}
