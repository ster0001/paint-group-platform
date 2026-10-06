import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { confirmHold } from "@/lib/visits/holds";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/** S3 — the code. Re-runs availability, then the one-transaction RPC. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ estimateId: z.string().uuid(), holdId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, "The code is six digits.") });

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter the six-digit code.", code: "invalid" }, { status: 400 });
  const owned = await loadOwnedEstimate(parsed.data.estimateId);
  if (isResponse(owned)) return owned;
  const r = await confirmHold(owned.svc, owned.est, { holdId: parsed.data.holdId, code: parsed.data.code });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code, attemptsLeft: r.attemptsLeft ?? null }, { status: r.status });
  return NextResponse.json(r);
}
