import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { resendCode } from "@/lib/visits/holds";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/** S3 — "Send a new code": three per hold, within the per-mobile and per-IP limits. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ estimateId: z.string().uuid(), holdId: z.string().uuid() });

export async function POST(request: Request) {
  const ip = clientIpFromHeaders((n) => request.headers.get(n));
  if (!allowTokenRoute(ip)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Bad request.", code: "invalid" }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data.estimateId);
  if (isResponse(owned)) return owned;
  const r = await resendCode(owned.svc, owned.est, { holdId: parsed.data.holdId, ip });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true });
}
