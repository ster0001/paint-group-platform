import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { normaliseMobile, otpIpHash, sendOtp } from "@/lib/wizard/otp";
import { WIZARD_BRANDS } from "@/lib/wizard/brand";

/**
 * The gate's code — SEND (Tom, 5 Nov 2026). The anonymous customer on the
 * details screen taps Continue; this texts a six-digit code to the mobile
 * they typed, or says the mobile is already verified for this draft (a reload
 * does not re-ask). Staff and signed-in portal customers never meet the gate.
 *
 *   200 {status: "sent", masked, expiresAt} | {status: "verified"}
 *   400 not an Australian mobile · 403 no session · 429 too_soon | limited (waitSeconds)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mobile: z.string().min(8).max(32),
  brand: z.enum(WIZARD_BRANDS).nullable().optional(),
});

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests.", code: "limited" }, { status: 429 });
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Please start your estimate again." }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Enter an Australian mobile number.", code: "invalid" }, { status: 400 });
  const mobile = normaliseMobile(parsed.data.mobile);
  if (!mobile) return NextResponse.json({ error: "Enter an Australian mobile number (04…).", code: "invalid" }, { status: 400 });
  // Staff preview a customer-mode wizard without a text; a portal customer's session email is their identity (3a-6).
  if (actor.kind === "staff" || actor.verifiedEmail) return NextResponse.json({ status: "verified" });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
  const r = await sendOtp(svc, { userId: actor.user.id, mobile, ipHash: otpIpHash((n) => request.headers.get(n)), brand: parsed.data.brand ?? null });
  switch (r.status) {
    case "verified": return NextResponse.json({ status: "verified" });
    case "sent": return NextResponse.json({ status: "sent", masked: r.masked, expiresAt: r.expiresAt });
    case "too_soon": return NextResponse.json({ error: `We've just sent a code — it can be sent again in ${r.waitSeconds} seconds.`, code: "too_soon", waitSeconds: r.waitSeconds }, { status: 429 });
    case "limited": return NextResponse.json({ error: "Too many codes have been sent to that number just now. Please try again in an hour.", code: "limited", waitSeconds: r.waitSeconds }, { status: 429 });
    default: return NextResponse.json({ error: `We couldn't send the code: ${r.message}`, code: "failed" }, { status: 500 });
  }
}
