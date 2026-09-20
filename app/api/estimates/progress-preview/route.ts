import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { reportError } from "@/lib/monitoring/report";
import { logCrmEvent } from "@/lib/crm/events";
import { PROGRESS_PREVIEW_EVENTS } from "@/lib/progress-preview/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live-progress phone on the estimate (brief v4 §8): the customer watched the
 * example start, watched it finish, pressed Play again, or tapped the hero
 * button to it. Same shape as /api/estimates/downloaded — the token is the
 * authorisation, only a SENT estimate records anything, an unknown token
 * answers like a known one, rate-limited per IP. Writes the estimate's own
 * event row (type `progress_preview_<event>`) and the one CRM event log.
 * Best-effort: a failure to record never reaches the customer.
 */
export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }
  const body = z.object({
    token: z.string().min(24).max(200),
    event: z.enum(PROGRESS_PREVIEW_EVENTS),
    set: z.enum(["residential", "commercial"]),
  }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });

  const { data, error } = await service.from("estimates").select("id, sent_at, account_id").eq("share_token", body.data.token).maybeSingle();
  if (error) {
    reportError(error, { where: "estimates.progressPreview.read", bestEffort: true });
    return NextResponse.json({ status: "ok" });
  }
  const est = data as { id: string; sent_at: string | null; account_id: string | null } | null;
  if (est?.sent_at) {
    const { event, set } = body.data;
    const { error: insertError } = await service.from("estimate_events").insert({
      estimate_id: est.id, type: `progress_preview_${event}`, payload: { set },
    });
    if (insertError) reportError(insertError, { where: "estimates.progressPreview.event", bestEffort: true });
    await logCrmEvent(service, {
      type: "estimate_progress_preview", estimateId: est.id, accountId: est.account_id, source: "customer", payload: { event, set },
    }).catch((e: unknown) => reportError(e, { where: "estimates.progressPreview.crm", bestEffort: true }));
  }
  return NextResponse.json({ status: "ok" });
}
