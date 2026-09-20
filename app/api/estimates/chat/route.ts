import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { reportError } from "@/lib/monitoring/report";
import { postCustomerChatMessage } from "@/lib/estimates/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/estimates/chat — a customer's message from the estimate chat
 * (Tom, 20 Sep). The page used to call the RPC straight from the browser;
 * it comes through here now so the office can be told (email + text) in
 * the same breath. Token-authorised, rate-limited per IP, 404 on an
 * unknown token. Answers whether the office is open, so the page can show
 * the after-hours note.
 */
export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }
  const body = z.object({ token: z.string().min(24).max(200), body: z.string().trim().min(1).max(4000) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  try {
    const r = await postCustomerChatMessage(service, body.data);
    if (r.status === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (r.status === "empty") return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json({ ok: true, afterHours: r.afterHours });
  } catch (e) {
    reportError(e, { where: "estimates.chat.post" });
    return NextResponse.json({ error: "That didn't go through — please try again." }, { status: 500 });
  }
}
