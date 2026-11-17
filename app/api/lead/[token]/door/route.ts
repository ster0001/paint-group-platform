import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { maskMobile, normaliseMobile, otpIpHash, sendOtp, verifyOtp } from "@/lib/wizard/otp";
import { grantDraftDoor, leadByToken } from "@/lib/estimate/leadDoor";
import { doorNextPath } from "@/lib/estimate/leadDoorPath";
import { reportError } from "@/lib/monitoring/report";

/**
 * The lead page's door (Tom, 17 Nov 2026). `/e/[token]`'s Carry on and Book a
 * visit buttons POST here.
 *
 *   {action: "open"}   → 200 {status: "open", next} when this browser already
 *                        holds the draft, else {status: "code", masked}
 *   {action: "send"}   → texts a code to the mobile ON FILE → {status: "sent", masked}
 *                        (or "open" when this login already proved that mobile)
 *   {action: "verify", code} → the right code opens the draft → {status: "open", next}
 *
 * 404 unknown token (never 403) · 403 no session (the page signs in
 * anonymously first) · 409 no mobile on file · 429 limited. The code rules
 * are the gate's (lib/wizard/otp.ts, migration 20270308).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.string().min(24).max(128).regex(/^[A-Za-z0-9_-]+$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), to: z.enum(["quote", "visit"]) }),
  z.object({ action: z.literal("send"), to: z.enum(["quote", "visit"]) }),
  z.object({ action: z.literal("verify"), to: z.enum(["quote", "visit"]), code: z.string().regex(/^\d{6}$/, "The code is six digits.") }),
]);

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests.", code: "limited" }, { status: 429 });
  const tokenParse = tokenSchema.safeParse((await params).token);
  if (!tokenParse.success) return notFound();
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Enter the six-digit code.", code: "invalid" }, { status: 400 });
  const body = parsed.data;

  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "This isn't available just now — please call us." }, { status: 503 });
  const found = await leadByToken(svc, tokenParse.data);
  if (found.error) {
    reportError(new Error(found.error), { where: "lead.door.read" });
    return NextResponse.json({ error: "We couldn't open that just now — please try again shortly." }, { status: 500 });
  }
  const lead = found.lead;
  if (!lead) return notFound();
  const next = doorNextPath(lead.id, body.to, lead.snapshot.biggerJob);

  const actor = await getWizardActor(await createClient());
  if (actor.kind === "none") return NextResponse.json({ error: "Please reload the page.", code: "no_session" }, { status: 403 });
  if (actor.kind === "staff" || await customerOwnsDraft(svc, actor, lead)) return NextResponse.json({ status: "open", next });

  const mobile = lead.mobile ? normaliseMobile(lead.mobile) : null;
  if (!mobile) return NextResponse.json({ error: "We don't have a mobile for this one — please call us.", code: "no_mobile" }, { status: 409 });
  const opened = async () => {
    const err = await grantDraftDoor(svc, lead.id, actor.user.id);
    if (err) {
      reportError(new Error(err), { where: "lead.door.grant", extra: { estimateId: lead.id } });
      return NextResponse.json({ error: "We couldn't open that just now — please try again shortly." }, { status: 500 });
    }
    return NextResponse.json({ status: "open", next });
  };

  if (body.action === "open") return NextResponse.json({ status: "code", masked: maskMobile(mobile) });

  if (body.action === "send") {
    const brand = lead.brand === "painthome" ? "painthome" as const : null;
    const r = await sendOtp(svc, { userId: actor.user.id, mobile, ipHash: otpIpHash((n) => request.headers.get(n)), brand });
    switch (r.status) {
      case "verified": return opened();
      case "sent": return NextResponse.json({ status: "sent", masked: r.masked });
      case "too_soon": return NextResponse.json({ error: `We've just sent a code — it can be sent again in ${r.waitSeconds} seconds.`, code: "too_soon", waitSeconds: r.waitSeconds }, { status: 429 });
      case "limited": return NextResponse.json({ error: "Too many codes have been sent to that number just now. Please try again in an hour.", code: "limited", waitSeconds: r.waitSeconds }, { status: 429 });
      default:
        reportError(new Error(r.message), { where: "lead.door.send", extra: { estimateId: lead.id } });
        return NextResponse.json({ error: "We couldn't send the code just now — please call us.", code: "failed" }, { status: 500 });
    }
  }

  const r = await verifyOtp(svc, { userId: actor.user.id, mobile, code: body.code });
  switch (r.status) {
    case "ok": return opened();
    case "wrong": return NextResponse.json({ error: "That code didn't match — try again", code: "wrong", attemptsLeft: r.attemptsLeft }, { status: 400 });
    case "ended": return NextResponse.json({ error: "Too many tries — tap Send it again for a new code.", code: "ended" }, { status: 410 });
    case "expired": return NextResponse.json({ error: "That code has expired — tap Send it again for a new one.", code: "expired" }, { status: 410 });
    default:
      reportError(new Error(r.message), { where: "lead.door.verify", extra: { estimateId: lead.id } });
      return NextResponse.json({ error: "We couldn't check the code just now — please try again.", code: "failed" }, { status: 500 });
  }
}
