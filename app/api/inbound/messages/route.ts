import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyInboundSignature } from "@/lib/costs/inboundSig";
import { parseInboundEmail } from "@/lib/costs/inbound";
import { fetchReceivedEmailBody, resendConfigured } from "@/lib/costs/resendInbound";
import { htmlToPlain, recordMessage, replyTokenFrom, resolveAccount } from "@/lib/messaging/record";
import { reportError } from "@/lib/monitoring/report";
import { forwardEmail } from "@/lib/messaging/send";
import { loadMessaging } from "@/lib/messaging/load";
import { postStaffChatReply, stripQuotedReply } from "@/lib/estimates/chatReply";

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
 *
 * Tom, 17 Sep: the reply also goes to the office mailbox. Once stored, a
 * copy is relayed to the company email (Settings → Company, or
 * INBOUND_FORWARD_TO) with the customer as Reply-To, so the inbox sees every
 * reply exactly as it did before the reply domain took them. The relay is
 * best-effort AFTER the record is written — the CRM row is the source of
 * truth and a relay failure is reported, never allowed to lose the message.
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
  let parentKind: string | null = null;
  if (token) {
    const { data: parent } = await db.from("messages").select("id, account_id, thread_id, estimate_id, kind").eq("reply_token", token).maybeSingle();
    if (parent) {
      const p = parent as { id: string; account_id: string | null; thread_id: string | null; estimate_id: string | null; kind: string | null };
      accountId = p.account_id;
      threadId = p.thread_id ?? p.id;
      estimateId = p.estimate_id;
      parentKind = p.kind;
    }
  }

  // Tom, 20 Sep: "if we reply to the email, it automatically replies to
  // their chat box as well". The office's chat alert is recorded against
  // the estimate (kind staff_alert + estimate_id); a reply to THAT token from
  // a staff address is posted on the estimate chat as a staff reply, and the
  // customer gets the same text + email a reply from the builder sends.
  if (parentKind === "staff_alert" && estimateId) {
    const staffName = await staffNameForEmail(db, email.fromEmail);
    if (staffName !== null) {
      const body = stripQuotedReply(email.text);
      if (body) {
        const r = await postStaffChatReply(db, { estimateId, body, authorName: staffName || null });
        if (!r.ok) reportError(new Error(r.message), { where: "inboundMessages.chatReply", extra: { estimateId } });
        return NextResponse.json({ received: true, chatReply: r.ok, estimateId });
      }
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
    const forwarded = await relayToOffice(db, email, { accountId, messageId: id });
    return NextResponse.json({ received: true, id, matched: accountId != null, forwarded });
  } catch (e) {
    reportError(e, { where: "inboundMessages", extra: { messageId: email.messageId } });
    return new NextResponse("Storage failed.", { status: 500 });
  }
}

/**
 * The copy for the office mailbox: the customer's words under one line that
 * says who wrote and where the thread lives. Reply-To is the customer, so
 * "Reply" in the mailbox answers them, not the reply domain.
 */
async function relayToOffice(
  db: ReturnType<typeof createServiceClient> & object,
  email: { fromEmail: string; subject: string; text: string; html: string },
  about: { accountId: string | null; messageId: string | null },
): Promise<boolean> {
  try {
    const { company } = await loadMessaging(db);
    const to = (process.env.INBOUND_FORWARD_TO || company.email || "").trim();
    if (!to) return false;
    // Never relay a message to the address it came from — a mailbox rule
    // that auto-replies would otherwise bounce between the two forever.
    if (to.toLowerCase() === email.fromEmail.toLowerCase()) return false;
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const recordUrl = about.accountId && site ? `${site}/crm/customers/${about.accountId}` : null;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const intro = [
      `<p style="margin:0 0 12px;font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#555">`,
      `Reply from <b>${esc(email.fromEmail)}</b> — `,
      recordUrl
        ? `logged on <a href="${recordUrl}">their CRM record</a>. Reply to this email to answer them directly.`
        : `not yet matched to a customer; it is waiting on Today in the CRM to be attached. Reply to this email to answer them directly.`,
      `</p><hr style="border:0;border-top:1px solid #ddd;margin:0 0 12px">`,
    ].join("");
    const body = email.html?.trim() ? email.html : `<pre style="white-space:pre-wrap;font:inherit">${esc(email.text)}</pre>`;
    const subject = /^(re|fwd?):/i.test(email.subject.trim()) ? email.subject.trim() : `Re: ${email.subject.trim() || "(no subject)"}`;
    const r = await forwardEmail({ to, subject, html: intro + body, replyTo: email.fromEmail });
    if (r.status !== "sent") {
      if (r.status !== "not_configured") reportError(new Error(`Inbound relay ${r.status}`), { where: "inboundMessages.relay", extra: { ...about, status: r.status } });
      return false;
    }
    return true;
  } catch (e) {
    reportError(e, { where: "inboundMessages.relay", extra: about });
    return false;
  }
}

/** A staff login's display name when the sender is one of ours — "" when they have no name, null when not staff. */
async function staffNameForEmail(db: ReturnType<typeof createServiceClient> & object, fromEmail: string): Promise<string | null> {
  const wanted = fromEmail.trim().toLowerCase();
  if (!wanted) return null;
  const { data: rows, error } = await db.from("profiles").select("id, name").eq("role", "staff");
  if (error) throw error;
  for (const p of ((rows ?? []) as { id: string; name: string | null }[])) {
    const { data: u } = await db.auth.admin.getUserById(p.id);
    if ((u?.user?.email ?? "").trim().toLowerCase() === wanted) return p.name ?? "";
  }
  return null;
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
