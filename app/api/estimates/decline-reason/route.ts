import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { DECLINE_REASON_CODES, DECLINE_REASON_KEYS, declineReasonMissing } from "@/lib/estimate/declineReason";
import { reportError } from "@/lib/monitoring/report";

/**
 * E11 (17 Nov 2026): a customer who declined without a reason taps one of the
 * chips on their chat → /e/[token]/reason → confirms here. The reason is
 * stored once, in the decline panel's own words, and only when the estimate
 * is declined and has none — a later tap never overwrites a reason. The token
 * is the authority; 404 for an unknown or undeclined one, never 403.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(24).max(200).regex(/^[A-Za-z0-9_-]+$/),
  code: z.enum(DECLINE_REASON_KEYS as [string, ...string[]]),
});

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "This isn't available just now." }, { status: 503 });
  const { data, error } = await svc.from("estimates").select("id, status, declined_reason").eq("share_token", parsed.data.token).maybeSingle();
  if (error) { reportError(error, { where: "estimates.declineReason.read" }); return NextResponse.json({ error: "Please try again shortly." }, { status: 500 }); }
  const est = data as { id: string; status: string; declined_reason: string | null } | null;
  if (!est || est.status !== "declined") return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!declineReasonMissing(est.declined_reason)) return NextResponse.json({ ok: true, already: true });
  const stored = DECLINE_REASON_CODES[parsed.data.code as keyof typeof DECLINE_REASON_CODES].stored;
  const up = await svc.from("estimates").update({ declined_reason: stored }).eq("id", est.id).eq("status", "declined");
  if (up.error) { reportError(up.error, { where: "estimates.declineReason.write" }); return NextResponse.json({ error: "Please try again shortly." }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
