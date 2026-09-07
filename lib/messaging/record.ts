import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";

// SERVER ONLY.
/**
 * CRM v2 P3 — the one funnel every message goes through (deep dive §4.2).
 *
 * `recordMessage` writes one row in `messages` for anything that reaches or
 * comes from a customer: an email or SMS the platform sent (with its body and
 * provider id), a reply that came in, a call the office logged. The two send
 * primitives call it themselves, so every one of the thirty send sites is
 * covered without each remembering to. Best-effort by design: a failure to
 * record is reported, never allowed to fail the send.
 *
 * Who the message belongs to: the caller's `accountId` when it knows; else
 * the recipient's address, resolved through `crm_find_account` (account
 * email → contact email → account phone → contact phone). Unresolved stays
 * null — an unmatched row the office can attach.
 */

export type MessageChannel = "email" | "sms" | "call" | "chat" | "portal" | "note";
export type MessageProvider = "resend" | "twilio" | "manual" | "system" | "portal" | "assistant";
export type MessageStatus = "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "not_configured" | "received";

/** What a send site may say about the message it is sending. */
export type MessageContext = {
  accountId?: string | null;
  contactId?: string | null;
  estimateId?: string | null;
  workOrderId?: string | null;
  invoiceId?: string | null;
  campaignMessageId?: string | null;
  /** A short tag for the kind of send — "estimate", "invoice", "update", "campaign", "reply"… */
  kind?: string;
  actorProfileId?: string | null;
  threadId?: string | null;
  /** True for a test send or a send that must not be recorded (rare). */
  skipRecord?: boolean;
};

export type MessageRow = {
  channel: MessageChannel;
  direction: "in" | "out";
  subject?: string | null;
  body: string;
  bodyHtml?: string | null;
  provider: MessageProvider;
  providerMessageId?: string | null;
  status: MessageStatus;
  toAddress?: string | null;
  fromAddress?: string | null;
  replyToken?: string | null;
  occurredAt?: string | null;
  meta?: Record<string, unknown>;
} & MessageContext;

const REPLY_LOCAL = "reply";

/** Reply-To that routes a customer's reply straight back to this thread. Only
 *  when REPLY_DOMAIN is set (decision 8.6: the DNS record is Tom's). */
export function replyAddress(token: string): string | null {
  const domain = process.env.REPLY_DOMAIN?.trim();
  if (!domain) return null;
  return `${REPLY_LOCAL}+${token}@${domain}`;
}

export function newReplyToken(): string {
  return randomBytes(12).toString("base64url");
}

/** The token from an inbound To address, or null. */
export function replyTokenFrom(address: string | null | undefined): string | null {
  // Tokens are base64url — case matters; only the mailbox and domain are case-blind.
  const m = String(address ?? "").match(/reply\+([A-Za-z0-9_-]{8,40})@/i);
  return m ? m[1] : null;
}

/** Plain text from an HTML body — for the row's searchable body. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Who this address belongs to, or null. Service role only — the RPC is staff-or-service. */
export async function resolveAccount(db: SupabaseClient, who: { email?: string | null; phone?: string | null }): Promise<string | null> {
  if (!who.email && !who.phone) return null;
  const { data, error } = await db.rpc("crm_find_account", { p_email: who.email ?? null, p_phone: who.phone ?? null });
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * Write the row. Uses the service client (the send primitives have no
 * session); resolves the account from the address when the caller did not
 * say. Returns the row id, or null when nothing could be written.
 */
export async function recordMessage(row: MessageRow, db?: SupabaseClient | null): Promise<string | null> {
  if (row.skipRecord) return null;
  const client = db ?? createServiceClient();
  if (!client) return null;
  try {
    let accountId = row.accountId ?? null;
    if (!accountId) {
      const address = row.direction === "out" ? row.toAddress : row.fromAddress;
      accountId = await resolveAccount(client, row.channel === "sms" || row.channel === "call" ? { phone: address } : { email: address });
    }
    const { data, error } = await client.from("messages").insert({
      account_id: accountId,
      contact_id: row.contactId ?? null,
      channel: row.channel,
      direction: row.direction,
      subject: row.subject ?? null,
      body: (row.body ?? "").slice(0, 20_000),
      body_html: row.bodyHtml ? row.bodyHtml.slice(0, 200_000) : null,
      provider: row.provider,
      provider_message_id: row.providerMessageId ?? null,
      thread_id: row.threadId ?? null,
      reply_token: row.replyToken ?? null,
      estimate_id: row.estimateId ?? null,
      work_order_id: row.workOrderId ?? null,
      invoice_id: row.invoiceId ?? null,
      campaign_message_id: row.campaignMessageId ?? null,
      status: row.status,
      status_at: new Date().toISOString(),
      actor_profile_id: row.actorProfileId ?? null,
      to_address: row.toAddress ?? null,
      from_address: row.fromAddress ?? null,
      occurred_at: row.occurredAt ?? new Date().toISOString(),
      meta: { ...(row.meta ?? {}), ...(row.kind ? { kind: row.kind } : {}) },
    }).select("id").single();
    if (error) {
      // A duplicate provider id is a retry — the first row stands.
      if (error.code === "23505") return null;
      reportError(error, { where: "messages.record", bestEffort: true, extra: { channel: row.channel, direction: row.direction } });
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    reportError(e, { where: "messages.record", bestEffort: true });
    return null;
  }
}

/** A delivery status from a provider webhook, matched by provider id. */
export async function updateMessageStatus(
  db: SupabaseClient,
  provider: MessageProvider,
  providerMessageId: string,
  status: MessageStatus,
  at: string = new Date().toISOString(),
): Promise<{ id: string; account_id: string | null; meta: Record<string, unknown> } | null> {
  const { data: row } = await db.from("messages").select("id, account_id, status, meta")
    .eq("provider", provider).eq("provider_message_id", providerMessageId).maybeSingle();
  if (!row) return null;
  const r = row as { id: string; account_id: string | null; status: MessageStatus; meta: Record<string, unknown> };
  // A status never goes backwards: "opened" after "delivered" is news; "delivered" after "opened" is not.
  const RANK: Record<MessageStatus, number> = { queued: 0, not_configured: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, received: 1, failed: 5, bounced: 5, complained: 6 };
  if (RANK[status] <= RANK[r.status] && status !== r.status && RANK[status] < 5) return r;
  await db.from("messages").update({ status, status_at: at }).eq("id", r.id);
  return r;
}
