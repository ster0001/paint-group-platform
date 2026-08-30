import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  classifyInbound, matchAccountsByPhone, twimlEmpty, twimlReply, verifyTwilioSignature,
} from "@/lib/campaigns/inboundSms";
import { buildEvent, dedupeKey } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * Twilio's inbound-SMS webhook — the other half of "Reply STOP to opt out".
 *
 * Configure on the Twilio number: Messaging → "a message comes in" →
 * POST {site}/api/sms/inbound. Twilio signs every request with the account's
 * auth token; an unsigned or mis-signed POST is refused, because this route's
 * one power is writing consent flags and anyone can reach a public URL.
 *
 * STOP  → marketing_unsubscribed_at is set on every account carrying that
 *         mobile, and the guard refuses them from the next check onward.
 * START → the flag clears: texting START is the industry-standard re-consent.
 * HELP  → identifies the business, as carriers require.
 * else  → logged to the customer's timeline, so a reply is never invisible.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: "not configured" }, { status: 503 });

  let params: Record<string, string>;
  try {
    params = Object.fromEntries([...(await req.formData()).entries()]
      .map(([k, v]) => [k, String(v)]));
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 400 });
  }

  // The signature is computed over the URL Twilio was CONFIGURED with, which
  // is the public one — never the internal host a proxy shows this process.
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://paint-group-platform.vercel.app").replace(/\/$/, "");
  const url = `${base}/api/sms/inbound`;
  if (!verifyTwilioSignature(url, params, token, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  const from = String(params.From ?? "");
  const kind = classifyInbound(params.Body);
  const db = createServiceClient();
  if (!db) return xml(twimlEmpty());

  try {
    const { data: accounts } = await db.from("accounts")
      .select("id, phone, marketing_unsubscribed_at").not("phone", "is", null).limit(10000);
    const matched = matchAccountsByPhone(accounts ?? [], from);

    if (kind === "stop") {
      for (const a of matched) {
        if (!a.marketing_unsubscribed_at) {
          await db.from("accounts")
            .update({ marketing_unsubscribed_at: new Date().toISOString() }).eq("id", a.id);
        }
        await db.rpc("crm_log_event", buildEvent({
          type: "campaign_unsubscribed",
          accountId: a.id as string,
          source: "customer",
          payload: { channel: "sms" },
          dedupeKey: dedupeKey("sms-stop", a.id as string, String(params.MessageSid ?? "")),
        }));
      }
      // Confirmed even when no account matched: the sender asked to stop, and
      // "we don't know you" is not an answer a compliance keyword may get.
      return xml(twimlReply("You're unsubscribed from Paint Group marketing and won't hear from us again. Reply START to rejoin."));
    }

    if (kind === "start") {
      for (const a of matched) {
        await db.from("accounts").update({ marketing_unsubscribed_at: null }).eq("id", a.id);
        await db.rpc("crm_log_event", buildEvent({
          type: "sms_reply",
          accountId: a.id as string,
          source: "customer",
          payload: { body: "START — resubscribed" },
          dedupeKey: dedupeKey("sms-start", a.id as string, String(params.MessageSid ?? "")),
        }));
      }
      return xml(twimlReply("Welcome back — you'll hear from Paint Group again. Reply STOP any time."));
    }

    if (kind === "help") {
      return xml(twimlReply("Paint Group — 03 8840 9414 or info@paintgroup.com.au. Reply STOP to opt out of marketing."));
    }

    // An ordinary reply: put it on the timeline, answer nothing. An SMS
    // conversation is a human's job; a reply nobody can see is the bug.
    for (const a of matched) {
      await db.rpc("crm_log_event", buildEvent({
        type: "sms_reply",
        accountId: a.id as string,
        source: "customer",
        payload: { body: String(params.Body ?? "").slice(0, 500) },
        dedupeKey: dedupeKey("sms-reply", a.id as string, String(params.MessageSid ?? "")),
      }));
    }
    return xml(twimlEmpty());
  } catch (e) {
    reportError(e, { where: "sms.inbound", bestEffort: true });
    // Twilio retries on errors; a webhook that flaps causes duplicate events,
    // and the dedupe keys above make retries harmless — so let it retry.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
