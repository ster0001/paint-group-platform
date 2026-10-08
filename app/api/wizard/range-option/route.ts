import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/**
 * S6 (§4.7): which option the customer chose on the range screen — tighten,
 * speak, visit or message — recorded on the wizard session so the two gate
 * versions can be compared. The first choice is the one that counts; a
 * second tap is not a second session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ estimateId: z.string().uuid(), option: z.enum(["tighten", "speak", "visit", "message"]) });

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data.estimateId);
  if (isResponse(owned)) return owned;
  const { error } = await owned.svc.from("wizard_drafts")
    .update({ range_option: parsed.data.option, range_option_at: new Date().toISOString() })
    .eq("estimate_id", owned.est.id).is("range_option", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
