import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyOfficeOfAcceptanceByToken } from "@/lib/estimate/acceptedNotify";
import { recordConsent } from "@/lib/accounts/consent";

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
  // Tom, 7 Sep (item 5): the accept small print says we may send marketing,
  // every message with an opt-out. Record the agreement on the account —
  // only for an estimate that IS accepted, and never over an earlier "no".
  const { data } = await service.from("estimates").select("id, account_id, status").eq("share_token", body.data.token).maybeSingle();
  const est = data as { id: string; account_id: string | null; status: string } | null;
  if (est?.status === "accepted" && est.account_id) await recordConsent(service, est.account_id, "marketing", "estimate_accepted", { estimateId: est.id });
  return NextResponse.json({ status: "ok" });
}
