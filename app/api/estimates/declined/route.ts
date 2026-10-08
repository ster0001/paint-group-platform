import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyOfficeOfDeclineByToken } from "@/lib/estimate/lifecycleNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The decline ping (Tom, 1 Oct 2026) — the acceptance-ping pattern. The
 * customer's decline is a browser → Postgres RPC with no server seam, so /e
 * fires this afterwards and the server tells the staff who asked. Token = the
 * authorisation: it only ever acts on an estimate that IS declined, sends
 * once (staff_notifications claim), and answers the same way for an unknown
 * token as for a done one — nothing to enumerate.
 */
export async function POST(request: Request) {
  const body = z.object({ token: z.string().min(24).max(200) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  await notifyOfficeOfDeclineByToken(service, body.data.token);
  return NextResponse.json({ status: "ok" });
}
