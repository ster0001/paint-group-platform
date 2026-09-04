import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyOfficeOfAcceptanceByToken } from "@/lib/estimate/acceptedNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The acceptance ping (Tom, 4 Sep) — the appointment-confirm pattern. The
 * customer's accept is a browser → Postgres RPC with no server seam, so /e
 * fires this afterwards and the server emails the office. Token = the
 * authorisation (the /s rule): it only ever acts on an estimate that IS
 * accepted, sends once (estimate_events guard), and answers the same way
 * for an unknown token as for a done one — nothing to enumerate.
 */
export async function POST(request: Request) {
  const body = z.object({ token: z.string().min(24).max(200) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  await notifyOfficeOfAcceptanceByToken(service, body.data.token);
  return NextResponse.json({ status: "ok" });
}
