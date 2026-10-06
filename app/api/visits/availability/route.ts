import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { loadVisitContext } from "@/lib/visits/holds";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/**
 * S3 — the slots this customer may book right now, as the page shows them.
 * Used by the page to refresh after a hold ends, and by the section-8 API
 * tests. Never records an unmapped suburb (the page load already has).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const id = new URL(request.url).searchParams.get("estimateId");
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "Bad request.", code: "invalid" }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data);
  if (isResponse(owned)) return owned;
  const ctx = await loadVisitContext(owned.svc, owned.est, { record: false });
  return NextResponse.json({
    estimateId: ctx.estimateId, zone: ctx.zone.outcome, farEdge: ctx.zone.farEdge, suburb: ctx.address?.suburb ?? null,
    hasContact: !!ctx.contact, estimatorName: ctx.estimatorName, days: ctx.days, hold: ctx.hold, rules: ctx.rules,
  });
}
