import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyStaff } from "@/lib/staff/notify";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { buildEstimateEmailHtml, emailConfigured, sendEmail } from "@/lib/messaging/send";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { officeOpenAt, OFFICE_HOURS_LINE } from "@/lib/messaging/officeHours";

/**
 * A customer's message on their estimate chat (Tom, 20 Sep 2026): "all
 * messages the customer sends in the chat are sent to the chat in the
 * software — please also send an email and text message when someone wants
 * to chat". SERVICE CLIENT ONLY; the token is the customer's authorisation.
 *
 * 1. The message lands through the same RPC the page always used
 *    (post_estimate_message_by_token → estimate_messages + the event row,
 *    which the CRM mirrors into `messages`), so the thread has one home.
 * 2. The office is told through the staff-alert path (`office_estimate_chat`
 *    in the registry, per-person routing under Staff logins). With nobody
 *    routed, the office address is emailed, so a message is never silent.
 * Best-effort after step 1: an alert failure never loses the message.
 */
export type CustomerChatOutcome = { status: "ok" | "not_found" | "empty"; afterHours: boolean };

type Est = { id: string; title: string | null; builder_state: { contact?: { name?: string | null } } | null; sent_snapshot: { jobAddress?: string; contactName?: string } | null };

export async function postCustomerChatMessage(service: SupabaseClient, input: { token: string; body: string }, now = new Date()): Promise<CustomerChatOutcome> {
  const afterHours = !officeOpenAt(now);
  const { data: status, error } = await service.rpc("post_estimate_message_by_token", { p_token: input.token, p_body: input.body });
  if (error) throw error;
  if (status !== "ok") return { status: status === "not_found" ? "not_found" : "empty", afterHours };

  try {
    const { data: estRow, error: estErr } = await service.from("estimates").select("id, title, builder_state, sent_snapshot").eq("share_token", input.token).maybeSingle();
    if (estErr) throw estErr;
    const est = estRow as Est | null;
    if (!est) return { status: "ok", afterHours };
    const { data: last, error: lastErr } = await service.from("estimate_messages").select("id, body").eq("estimate_id", est.id).eq("direction", "customer").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastErr) throw lastErr;
    const msg = last as { id: string; body: string } | null;
    if (!msg) return { status: "ok", afterHours };

    const customer = (est.sent_snapshot?.contactName || est.builder_state?.contact?.name || "A customer").trim();
    const job = (est.sent_snapshot?.jobAddress || est.title || "their estimate").trim();
    const link = `${siteUrl()}/quote?id=${est.id}`;
    const vars = {
      customer, job, message: msg.body,
      hours_tag: afterHours ? " (after hours)" : "",
      hours_line: afterHours ? `\n\nSent outside office hours (${OFFICE_HOURS_LINE}); they have been told we will reply when open.` : "",
    };
    const outcome = await notifyStaff(service, {
      key: "office_estimate_chat", entityId: msg.id,
      subject: renderTemplate("Chat from {{customer}} — {{job}}{{hours_tag}}", vars),
      message: renderTemplate("{{customer}} wrote on the chat for {{job}}:\n\n“{{message}}”\n\nReply from the chat pop-up on any staff page, or open the estimate.{{hours_line}}", vars),
      link,
      templates: { subject: "officeEstimateChatSubject", body: "officeEstimateChatBody" },
      vars,
      // Recorded with the estimate, so an email REPLY to the alert can be
      // routed back into the chat (app/api/inbound/messages).
      estimateId: est.id,
    });
    if (outcome === "nobody") await emailOfficeFallback(service, est.id, vars, link);
  } catch (e) {
    reportError(e, { where: "postCustomerChatMessage.alert", bestEffort: true });
  }
  return { status: "ok", afterHours };
}

/** Nobody routed under Staff logins → the office address still hears. */
async function emailOfficeFallback(service: SupabaseClient, estimateId: string, vars: Record<string, string>, link: string) {
  const { messaging, company } = await loadMessaging(service);
  if (!automationOn(messaging, "office_estimate_chat")) return;
  const to = (messaging.officeEmail || company.email || "").trim();
  if (!to || !emailConfigured()) return;
  const subject = renderTemplate(messaging.officeEstimateChatSubject, { ...vars, link });
  const intro = renderTemplate(messaging.officeEstimateChatBody, { ...vars, link });
  await sendEmail({
    to, subject,
    html: buildEstimateEmailHtml({ intro, link, companyName: company.name || "Paint Group", logoUrl: company.logoUrlLight || company.logoUrl, buttonLabel: "Open the estimate" }),
    ctx: { estimateId, kind: "staff_alert" },
  });
}
