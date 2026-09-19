import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Home dashboard v2 · 0a (B1): the customer tapped "Download estimate (PDF)".
 *
 * Same shape as /api/estimates/accepted — the token is the authorisation, it
 * only ever acts on an estimate that has been SENT (a draft's token is a 404
 * everywhere else and stays silent here), and it answers identically for an
 * unknown token and a done one, so there is nothing to enumerate. Rate-limited
 * per IP like every token route. Best-effort: a failure to record the event
 * never reaches the customer.
 */
export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }
  const body = z.object({ token: z.string().min(24).max(200) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });

  const { data, error } = await service.from("estimates").select("id, sent_at").eq("share_token", body.data.token).maybeSingle();
  if (error) {
    reportError(error, { where: "estimates.downloaded.read", bestEffort: true });
    return NextResponse.json({ status: "ok" });
  }
  const est = data as { id: string; sent_at: string | null } | null;
  if (est?.sent_at) {
    const ua = request.headers.get("user-agent") ?? "";
    const { error: insertError } = await service.from("estimate_events").insert({
      estimate_id: est.id, type: "downloaded", payload: { user_agent: ua.slice(0, 200) },
    });
    if (insertError) reportError(insertError, { where: "estimates.downloaded.event", bestEffort: true });
  }
  return NextResponse.json({ status: "ok" });
}
