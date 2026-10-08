import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { saveVisitDetails } from "@/lib/visits/holds";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/** S3 — "A few details first": name, email, mobile (and the address when we have none). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  estimateId: z.string().uuid(),
  name: z.string().trim().min(2, "Please give us your full name.").max(120),
  email: z.string().trim().email("That email doesn't look right.").max(200),
  mobile: z.string().trim().min(8, "Please give us your mobile number.").max(30),
  street: z.string().trim().max(200).optional(),
  suburb: z.string().trim().max(80).optional(),
  postcode: z.string().trim().max(12).optional(),
});

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details.", code: "invalid" }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data.estimateId);
  if (isResponse(owned)) return owned;
  const r = await saveVisitDetails(owned.svc, owned.est, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.message, code: "failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
