import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MESSAGING, MESSAGING_KEY, automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildChatEmailHtml, type DeliveryResult } from "@/lib/messaging/send";
import { sendAutomation } from "@/lib/automations/dispatch";
import { DEFAULT_COMPANY, type CompanyProfile, type Contact } from "@/app/quote/company";
import { siteUrl } from "@/lib/invoicing/pdf";

/**
 * A staff reply on the estimate chat — ONE implementation (Tom, 20 Sep) for
 * the builder's reply box, the staff dock and an emailed reply routed back
 * by the inbound webhook. Inserts the message (the caller's client decides
 * the authority: a staff session through RLS, or the service client from
 * the webhook), then best-effort notifies the customer on BOTH channels: an
 * SMS whose link opens their estimate at the chat box, and an email that
 * shows the message with a Respond button. Delivery failures never lose
 * the message — they're reported back and logged on the activity feed.
 */
export type DeliveryOutcome = {
  email?: { status: DeliveryResult["status"] | "queued"; message?: string };
  sms?: { status: DeliveryResult["status"] | "queued"; message?: string };
};
export type StaffChatReplyResult = { ok: true; delivery: DeliveryOutcome } | { ok: false; message: string };

export async function postStaffChatReply(
  supabase: SupabaseClient,
  input: { estimateId: string; body: string; authorName: string | null },
): Promise<StaffChatReplyResult> {
  const { estimateId, body, authorName } = input;
  // 1. the message itself.
  const { error: insErr } = await supabase.from("estimate_messages").insert({
    estimate_id: estimateId, direction: "staff", body, author_name: authorName,
  });
  if (insErr) return { ok: false, message: `Couldn't post the message: ${insErr.message}` };

  // 2. notify the customer, best-effort.
  const [{ data: est, error: estErr }, { data: settingsRows, error: setErr }] = await Promise.all([
    supabase.from("estimates").select("share_token, builder_state").eq("id", estimateId).single(),
    supabase.from("settings").select("key, value").in("key", ["company_profile", MESSAGING_KEY]),
  ]);
  // The message is posted; a failed lookup here only costs the notification.
  if (estErr || setErr) return { ok: true, delivery: { email: { status: "error", message: `Posted, but the customer could not be notified: ${(estErr ?? setErr)!.message}` } } };
  const rows = (settingsRows as { key: string; value: unknown }[] | null) ?? [];
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((rows.find((r) => r.key === "company_profile")?.value as Partial<CompanyProfile>) ?? {}) };
  const chatMessaging: MessagingSettings = { ...DEFAULT_MESSAGING, ...((rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings>) ?? {}) };
  const contact = ((est?.builder_state as { contact?: Contact } | null)?.contact ?? null);
  const outcome: DeliveryOutcome = {};

  // Settings → Automations: "Reply on the estimate chat". Off = the reply is
  // posted (the record) and the customer sees it next time they open the chat.
  if (est?.share_token && automationOn(chatMessaging, "estimate_chat_reply")) {
    const link = `${siteUrl()}/e/${est.share_token}#chat`;
    const chatVars = { company_name: company.name, link };
    const phone = contact?.phone ? normalisePhoneAU(contact.phone) : null;
    const r = await sendAutomation(supabase, {
      key: "estimate_chat_reply",
      to: { email: contact?.email || null, phone },
      email: {
        subject: renderTemplate(chatMessaging.chatReplySubject, chatVars),
        replyTo: company.email || undefined,
        html: buildChatEmailHtml({
          message: body, link,
          companyName: company.name,
          logoUrl: company.logoUrlLight || company.logoUrl || undefined,
          estimatorName: company.estimatorName || undefined,
          companyPhone: company.phone || undefined,
        }),
      },
      sms: { body: renderTemplate(chatMessaging.chatReplySms, chatVars) },
      ctx: { estimateId, kind: "chat_reply" },
    });
    if (r.outcome === "sent") {
      if (r.results.email && contact?.email) {
        outcome.email = { status: r.results.email.status, ...("message" in r.results.email ? { message: r.results.email.message } : {}) };
        await logDelivery(supabase, estimateId, "email", contact.email, r.results.email);
      }
      if (r.results.sms && contact?.phone) {
        outcome.sms = { status: r.results.sms.status, ...("message" in r.results.sms ? { message: r.results.sms.message } : {}) };
        await logDelivery(supabase, estimateId, "sms", contact.phone, r.results.sms);
      }
    } else if (r.outcome === "pending") {
      outcome.email = { status: "queued", message: "Waiting for approval in Today → Messages to approve." };
    } else if (r.outcome === "held") {
      outcome.email = { status: "queued", message: `Held until sending hours open (${new Date(r.releaseAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", minute: "2-digit" })}).` };
    } else if (r.outcome === "error") {
      outcome.email = { status: "error", message: r.message };
    }
  }
  return { ok: true, delivery: outcome };
}

async function logDelivery(supabase: SupabaseClient, estimateId: string, channel: "email" | "sms", to: string, result: DeliveryResult) {
  if (result.status === "not_configured") return; // nothing happened — nothing to log
  await supabase.from("estimate_events").insert({
    estimate_id: estimateId,
    type: result.status === "sent" ? `${channel}_sent` : `${channel}_failed`,
    payload: { to, ...(result.status === "error" ? { error: result.message } : {}) },
  });
}

/**
 * The part of an emailed reply that is the reply: everything above the first
 * quoted block ("On … wrote:", "> …", "-----Original Message-----", a
 * "From:" header line) or a signature marker ("-- "). Pure; tested.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^On .{3,200} wrote:$/.test(t)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) break;
    if (/^(From|Sent|To|Subject):\s/.test(t) && out.length > 0) break;
    if (t === "--") break;
    out.push(line);
  }
  return out.join("\n").trim();
}
