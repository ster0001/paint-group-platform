import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyInboundSignature } from "@/lib/costs/inboundSig";
import { updateMessageStatus, type MessageStatus } from "@/lib/messaging/record";
import { buildEvent, dedupeKey } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM v2 P3 — delivery events from Resend (both accounts point here).
 * svix-signed with RESEND_WEBHOOK_SECRET. Each event updates the message row
 * by provider id; a hard bounce marks the customer undeliverable and a spam
 * complaint unsubscribes them — the two columns the guard chain reads but
 * nothing ever wrote.
 */
const STATUS_OF: Record<string, MessageStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "queued",
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("Webhook not configured.", { status: 503 });
  const payload = await req.text();
  const headers = { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") };
  if (!verifyInboundSignature(payload, headers, secret)) return new NextResponse("Bad signature.", { status: 400 });

  let event: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { type?: string } } };
  try {
    event = JSON.parse(payload);
  } catch {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  const status = STATUS_OF[event.type ?? ""];
  const emailId = event.data?.email_id;
  if (!status || !emailId) return NextResponse.json({ received: true, ignored: true });
  if (status === "queued") return NextResponse.json({ received: true, ignored: true });

  const db = createServiceClient();
  if (!db) return new NextResponse("Service unavailable.", { status: 503 });
  try {
    const row = await updateMessageStatus(db, "resend", emailId, status, event.created_at ?? new Date().toISOString());
    if (row?.account_id && (status === "bounced" || status === "complained")) {
      const hard = status === "complained" || (event.data?.bounce?.type ?? "").toLowerCase().includes("permanent") || !event.data?.bounce?.type;
      if (status === "bounced" && hard) {
        await db.from("accounts").update({ marketing_undeliverable_at: new Date().toISOString() }).eq("id", row.account_id).is("marketing_undeliverable_at", null);
      }
      if (status === "complained") {
        await db.from("accounts").update({ marketing_unsubscribed_at: new Date().toISOString() }).eq("id", row.account_id).is("marketing_unsubscribed_at", null);
      }
      if (row.meta?.kind === "campaign") {
        await db.rpc("crm_log_event", buildEvent({
          type: "campaign_bounced", accountId: row.account_id, source: "system",
          payload: { campaignKey: String(row.meta.campaignKey ?? "campaign"), channel: "email", hard },
          dedupeKey: dedupeKey("bounce", emailId),
        }));
      }
    }
    return NextResponse.json({ received: true, matched: row != null });
  } catch (e) {
    reportError(e, { where: "webhooks.resend", bestEffort: true });
    return new NextResponse("Failed.", { status: 500 });
  }
}
