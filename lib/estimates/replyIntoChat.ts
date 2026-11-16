import type { SupabaseClient } from "@supabase/supabase-js";
import { stripQuotedReply } from "@/lib/estimates/chatReply";
import { reportError } from "@/lib/monitoring/report";
import { realOnly } from "@/lib/demo/scope";

/**
 * Automations ruling A‑G (Tom, 11 Nov 2026): a customer's reply to one of our
 * emails or texts lands in the estimate CHAT, so the customer's page and the
 * office read one conversation. SERVICE CLIENT ONLY (the inbound webhooks).
 *
 * Routing is by what is certain, never a guess at the customer's intent:
 *   · email — the reply+<token>@ address names the message it answers; when
 *     that message was about an estimate, the reply goes on its chat;
 *   · SMS — a text has no token, so it goes on the estimate of the LAST text
 *     we sent that number about an estimate, within SMS_REPLY_WINDOW_DAYS.
 *     Older than that, or never about an estimate: it stays a CRM message.
 * The CRM row is written first by the route (the record); this only adds the
 * chat row (`estimate_message_from_reply`, migration 20270314), once per
 * CRM message however often the provider retries.
 */
export const SMS_REPLY_WINDOW_DAYS = 30;

export type ReplyVia = "email" | "sms";
export type ReplyIntoChatStatus = "ok" | "duplicate" | "empty" | "not_found" | "no_message" | "bad_via" | "error";

/** The words that go on the chat: an email loses its quoted history and signature. */
export function replyBodyFor(via: ReplyVia, text: string): string {
  return (via === "email" ? stripQuotedReply(text) : text).trim().slice(0, 4000);
}

/** Message kinds that are NOT a customer conversation: a reply to one of these is staff mail, or a keyword. */
const NOT_CUSTOMER_KINDS = new Set(["staff_alert", "stop", "start", "help"]);
export function answersCustomerMessage(kind: string | null | undefined): boolean {
  return !NOT_CUSTOMER_KINDS.has(kind ?? "");
}

type OutboundSms = { estimate_id: string | null; occurred_at: string };
/** The estimate a text reply belongs to: the newest text we sent about one, inside the window. */
export function pickSmsReplyEstimate(rows: readonly OutboundSms[], now: Date): string | null {
  const floor = now.getTime() - SMS_REPLY_WINDOW_DAYS * 86_400_000;
  const best = rows
    .filter((r) => r.estimate_id && Date.parse(r.occurred_at) >= floor && Date.parse(r.occurred_at) <= now.getTime())
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0];
  return best?.estimate_id ?? null;
}

/** "+61412345678" and "0412345678": the two ways an outbound text records the same mobile. */
export function smsAddressForms(e164: string): string[] {
  const forms = new Set([e164]);
  if (/^\+61\d{9}$/.test(e164)) forms.add(`0${e164.slice(3)}`);
  return [...forms];
}

/** Find the estimate for an inbound text from `e164`. Null when none is certain enough. */
export async function estimateForSmsReply(db: SupabaseClient, e164: string, now = new Date()): Promise<{ estimateId: string | null; error: string | null }> {
  const since = new Date(now.getTime() - SMS_REPLY_WINDOW_DAYS * 86_400_000).toISOString();
  // The demo wall: a demo job's texts never decide where a real reply goes.
  const { data, error } = await realOnly(db.from("messages").select("estimate_id, occurred_at"))
    .eq("channel", "sms").eq("direction", "out")
    .in("to_address", smsAddressForms(e164))
    .not("estimate_id", "is", null)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) return { estimateId: null, error: error.message };
  return { estimateId: pickSmsReplyEstimate((data ?? []) as OutboundSms[], now), error: null };
}

/** Post the reply on the estimate chat. Reported, never thrown: the CRM row already holds the reply. */
export async function postReplyIntoChat(db: SupabaseClient, input: { estimateId: string; messageId: string; text: string; via: ReplyVia }): Promise<ReplyIntoChatStatus> {
  const body = replyBodyFor(input.via, input.text);
  if (!body) return "empty";
  const { data, error } = await db.rpc("estimate_message_from_reply", { p_estimate: input.estimateId, p_message: input.messageId, p_body: body, p_via: input.via });
  if (error) {
    reportError(error, { where: "replyIntoChat", extra: { estimateId: input.estimateId, via: input.via } });
    return "error";
  }
  const status = String(data ?? "error") as ReplyIntoChatStatus;
  if (status !== "ok" && status !== "duplicate" && status !== "empty") {
    reportError(new Error(`reply not posted: ${status}`), { where: "replyIntoChat", bestEffort: true, extra: { estimateId: input.estimateId, via: input.via } });
  }
  return status;
}
