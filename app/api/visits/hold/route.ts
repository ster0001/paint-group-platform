import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { placeHold } from "@/lib/visits/holds";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/**
 * S3 — hold a slot for ten minutes and text the code. The browser sends the
 * start instant it was shown; the server re-derives the zone from the stored
 * address and re-runs availability, so a slot the zone list does not allow is
 * refused however it was asked for (section 8, test 1).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ estimateId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }) });

export async function POST(request: Request) {
  const ip = clientIpFromHeaders((n) => request.headers.get(n));
  if (!allowTokenRoute(ip)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Pick a time first.", code: "invalid" }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data.estimateId);
  if (isResponse(owned)) return owned;
  const r = await placeHold(owned.svc, owned.est, { startsAt: parsed.data.startsAt, userId: owned.actor.user.id, ip });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json(r);
}
