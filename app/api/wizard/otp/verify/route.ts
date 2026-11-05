import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { normaliseMobile, verifyOtp } from "@/lib/wizard/otp";

/**
 * The gate's code — VERIFY (Tom, 5 Nov 2026). Six digits against the latest
 * live code for this user and mobile; five wrong tries end the code.
 *
 *   200 {status: "ok"} · 400 wrong (attemptsLeft) · 410 expired | ended
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ mobile: z.string().min(8).max(32), code: z.string().regex(/^\d{6}$/, "The code is six digits.") });

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests.", code: "limited" }, { status: 429 });
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Please start your estimate again." }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Enter the six-digit code.", code: "invalid" }, { status: 400 });
  const mobile = normaliseMobile(parsed.data.mobile);
  if (!mobile) return NextResponse.json({ error: "Enter an Australian mobile number (04…).", code: "invalid" }, { status: 400 });
  if (actor.kind === "staff" || actor.verifiedEmail) return NextResponse.json({ status: "ok" });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
  const r = await verifyOtp(svc, { userId: actor.user.id, mobile, code: parsed.data.code });
  switch (r.status) {
    case "ok": return NextResponse.json({ status: "ok" });
    case "wrong": return NextResponse.json({ error: "That code didn't match — try again", code: "wrong", attemptsLeft: r.attemptsLeft }, { status: 400 });
    case "ended": return NextResponse.json({ error: "Too many tries — tap Send it again for a new code.", code: "ended" }, { status: 410 });
    case "expired": return NextResponse.json({ error: "That code has expired — tap Send it again for a new one.", code: "expired" }, { status: 410 });
    default: return NextResponse.json({ error: `We couldn't check the code: ${r.message}`, code: "failed" }, { status: 500 });
  }
}
