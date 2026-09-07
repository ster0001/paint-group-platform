import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyTwilioSignature } from "@/lib/campaigns/inboundSms";
import { updateMessageStatus, type MessageStatus } from "@/lib/messaging/record";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM v2 P3 — Twilio's delivery receipt for a text we sent (StatusCallback on
 * every sendSms). Signed like the inbound route; updates the message row.
 */
const STATUS_OF: Record<string, MessageStatus> = {
  queued: "queued", accepted: "queued", sending: "queued", sent: "sent", delivered: "delivered",
  undelivered: "failed", failed: "failed",
};

export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: "not configured" }, { status: 503 });
  let params: Record<string, string>;
  try {
    params = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 400 });
  }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://paint-group-platform.vercel.app").replace(/\/$/, "");
  if (!verifyTwilioSignature(`${base}/api/sms/status`, params, token, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }
  const sid = params.MessageSid ?? params.SmsSid;
  const status = STATUS_OF[(params.MessageStatus ?? params.SmsStatus ?? "").toLowerCase()];
  if (!sid || !status) return NextResponse.json({ received: true, ignored: true });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "no service client" }, { status: 503 });
  try {
    const row = await updateMessageStatus(db, "twilio", sid, status);
    return NextResponse.json({ received: true, matched: row != null });
  } catch (e) {
    reportError(e, { where: "sms.status", bestEffort: true });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
