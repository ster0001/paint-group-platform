/**
 * "Estimate accepted — tell the office" (Tom, 4 Sep 2026). SERVER ONLY.
 *
 * Acceptance happens in three places — the customer's /e page (a browser →
 * Postgres RPC with no server seam), the trade portal's in-app approval and
 * the external approver's /a link (both server actions). All three end here:
 * the /e page pings /api/estimates/accepted with its token, the two server
 * paths call this directly. Idempotent off estimate_events
 * (`office_accept_notified`), so a re-ping is a no-op. Best-effort: an
 * acceptance never fails over an email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildEstimateEmailHtml, emailConfigured, sendEmail } from "@/lib/messaging/send";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";

const money = (c: number | null | undefined) => "$" + ((c ?? 0) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function notifyOfficeOfAcceptance(service: SupabaseClient, estimateId: string): Promise<"sent" | "skipped" | "already" | "not_accepted"> {
  try {
    const { data } = await service
      .from("estimates")
      .select("id, title, status, accepted_name, accepted_at, accepted_total_cents, total_cents, sent_snapshot")
      .eq("id", estimateId).maybeSingle();
    const est = data as {
      id: string; title: string | null; status: string; accepted_name: string | null; accepted_at: string | null;
      accepted_total_cents: number | null; total_cents: number | null;
      sent_snapshot: { jobAddress?: string; depositPct?: number; totalCents?: number } | null;
    } | null;
    if (!est || est.status !== "accepted") return "not_accepted";

    const { data: prior } = await service.from("estimate_events").select("id")
      .eq("estimate_id", estimateId).eq("type", "office_accept_notified").limit(1);
    if ((prior ?? []).length > 0) return "already";

    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "office_estimate_accepted")) return "skipped";
    const to = (messaging.officeEmail || company.email || "").trim();
    if (!to) return "skipped";

    const total = est.accepted_total_cents ?? est.sent_snapshot?.totalCents ?? est.total_cents ?? 0;
    // The deposit the RPC drafted: the snapshot's percentage of the accepted total.
    const deposit = Math.round(total * ((est.sent_snapshot?.depositPct ?? 0) / 100));
    const title = [est.title, est.sent_snapshot?.jobAddress].filter(Boolean).join(" · ") || "an estimate";
    const link = `${siteUrl()}/quote?id=${est.id}`;
    const vars = {
      estimate_title: title, accepted_name: est.accepted_name || "The customer",
      accepted_at: est.accepted_at ? new Date(est.accepted_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" }) : "just now",
      total: money(total), deposit: money(deposit), company_name: company.name || "Paint Group", link,
    };
    const subject = renderTemplate(messaging.acceptedOfficeSubject, vars);
    const intro = renderTemplate(messaging.acceptedOfficeBody, vars);

    let outcome = "not_configured";
    if (!emailConfigured()) {
      console.log(`[office-accept:log-driver] to=${to} subject="${subject}" link=${link}`);
    } else {
      const r = await sendEmail({
        to, subject,
        html: buildEstimateEmailHtml({ intro, link, companyName: vars.company_name, logoUrl: company.logoUrlLight || company.logoUrl, buttonLabel: "Open the estimate" }),
      });
      outcome = r.status;
      if (r.status === "error") reportError(new Error(r.message), { where: "officeAccept.send", extra: { estimateId } });
    }
    await service.from("estimate_events").insert({ estimate_id: estimateId, type: "office_accept_notified", payload: { to, outcome } });
    return "sent";
  } catch (e) {
    reportError(e, { where: "notifyOfficeOfAcceptance", extra: { estimateId } });
    return "skipped";
  }
}

/** The /e page has only its token — resolve it, then notify. */
export async function notifyOfficeOfAcceptanceByToken(service: SupabaseClient, shareToken: string) {
  const { data } = await service.from("estimates").select("id").eq("share_token", shareToken).maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) return "not_accepted" as const;
  return notifyOfficeOfAcceptance(service, id);
}
