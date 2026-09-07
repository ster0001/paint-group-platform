import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyInboundSignature } from "@/lib/costs/inboundSig";
import { parseInboundEmail } from "@/lib/costs/inbound";
import { fetchReceivedEmailBody, resendConfigured } from "@/lib/costs/resendInbound";
import { htmlToPlain, recordMessage, replyTokenFrom, resolveAccount } from "@/lib/messaging/record";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM v2 P3 — a customer's email reply (deep dive §4.2.3).
 *
 * Resend's inbound webhook for the reply domain lands here (svix-signed with
 * MESSAGES_INBOUND_SECRET, the same scheme as bills@). Routing, in order:
 *   1. the To address carries reply+<token>@ — the token names the outbound
 *      message it answers, so the thread and the customer are certain;
 *   2. else the sender's address, through crm_find_account;
 *   3. else STORED with no account — a Today item for a person to attach.
 * The email is data, never instructions. 503 until the secret is set.
 */
export async function POST(req: Request) {
  const secret = process.env.MESSAGES_INBOUND_SECRET;
  if (!secret) return new NextResponse("Webhook not configured.", { status: 503 });

  const payload = await req.text();
  const headers = {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  };
  if (!verifyInboundSignature(payload, headers, secret)) return new NextResponse("Bad signature.", { status: 400 });

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  const email = parseInboundEmail(json, headers.id ?? "");
  if (!email || !email.messageId) return new NextResponse("Bad payload.", { status: 400 });

  const db = createServiceClient();
  if (!db) return new NextResponse("Service unavailable.", { status: 503 });

  // Resend's webhook is metadata-only; the body sits behind the API.
  if (!email.text.trim() && email.emailId && resendConfigured()) {
    const body = await fetchReceivedEmailBody(email.emailId);
    if (body) {
      email.text = body.text.trim() ? body.text : htmlToPlain(body.html);
      email.html = body.html;
    }
  }

  // Where it was addressed: the reply token, when there is one.
  const token = replyTokenFrom(firstTo(json));
  let accountId: string | null = null;
  let threadId: string | null = null;
  let estimateId: string | null = null;
  if (token) {
    const { data: parent } = await db.from("messages").select("id, account_id, thread_id, estimate_id").eq("reply_token", token).maybeSingle();
    if (parent) {
      const p = parent as { id: string; account_id: string | null; thread_id: string | null; estimate_id: string | null };
      accountId = p.account_id;
      threadId = p.thread_id ?? p.id;
      estimateId = p.estimate_id;
    }
  }
  if (!accountId) accountId = await resolveAccount(db, { email: email.fromEmail });

  try {
    const id = await recordMessage({
      channel: "email", direction: "in", subject: email.subject, body: email.text, bodyHtml: email.html || null,
      provider: "resend", providerMessageId: email.messageId, status: "received",
      fromAddress: email.fromEmail, toAddress: firstTo(json), accountId, threadId, estimateId,
      kind: "reply", meta: { resendEmailId: email.emailId },
    }, db);
    return NextResponse.json({ received: true, id, matched: accountId != null });
  } catch (e) {
    reportError(e, { where: "inboundMessages", extra: { messageId: email.messageId } });
    return new NextResponse("Storage failed.", { status: 500 });
  }
}

/** The first To address in the raw payload, whatever shape the provider used. */
function firstTo(json: unknown): string | null {
  const root = (json && typeof json === "object" ? (json as Record<string, unknown>) : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
  const to = data.to;
  const first = Array.isArray(to) ? to[0] : to;
  if (!first) return null;
  if (typeof first === "string") {
    const angled = first.match(/<([^>]+)>/);
    return (angled ? angled[1] : first).trim().toLowerCase();
  }
  if (typeof first === "object") {
    const o = first as { address?: string; email?: string };
    return (o.address ?? o.email ?? "").trim().toLowerCase() || null;
  }
  return null;
}
