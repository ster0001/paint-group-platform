import { NextResponse } from "next/server";
import { staffForChannel, syncStaffFromGoogle, webhookToken } from "@/lib/gcal/inbound";
import { forgetGoogleReads } from "@/lib/gcal/read";
import { reportError } from "@/lib/monitoring/report";

/**
 * Google Calendar push notifications (visit booking addendum A §4.6, S5).
 *
 * Google POSTs here with no body worth reading — the headers say which channel
 * fired and why. The channel token is an HMAC of the channel id made with
 * CRON_SECRET (the shared-secret rule for webhooks), so a request that does
 * not carry the right token is dropped before any lookup. A `sync` state is
 * the channel's hello; `exists` means something in the calendar changed and
 * the estimator's visit events are re-read. Always 200 quickly: Google retries
 * on anything else, and the five-minute sweep catches what a miss leaves.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token");
  const state = request.headers.get("x-goog-resource-state");
  if (!process.env.CRON_SECRET) return NextResponse.json({ ok: false }, { status: 503 });
  if (!channelId || !token || token !== webhookToken(channelId)) return NextResponse.json({ ok: false }, { status: 403 });
  if (state === "sync") return NextResponse.json({ ok: true, hello: true });
  const staffId = await staffForChannel(channelId);
  if (!staffId) return NextResponse.json({ ok: true, unknown: true });
  try {
    const r = await syncStaffFromGoogle(staffId);
    forgetGoogleReads(staffId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    reportError(e, { where: "gcal.webhook", bestEffort: true, extra: { channelId } });
    return NextResponse.json({ ok: true, error: true });
  }
}
