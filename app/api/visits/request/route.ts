import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { findOpenDraft } from "@/lib/wizard/draftOwner";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { createVisitRequest } from "@/lib/visits/requests";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/**
 * S4 — a request rather than a booking (§4.4): a time (pre-arranged, none
 * suit, nothing free, unmapped), a visit asked for before the range (R3, R4:
 * full name, address, email, mobile), or a call from Speak with us (R25 —
 * refused outside the phone range, section 8 test 16). With an estimate id
 * the estimate must be this customer's; without one the customer's own open
 * wizard draft is the subject.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  estimateId: z.string().uuid().optional(),
  kind: z.enum(["time", "visit", "call"]),
  name: z.string().trim().min(2, "Please give us your full name.").max(120),
  email: z.string().trim().email("That email doesn't look right.").max(200),
  mobile: z.string().trim().min(8, "Please give us your mobile number.").max(30),
  street: z.string().trim().max(200).optional(),
  suburb: z.string().trim().max(80).optional(),
  postcode: z.string().trim().max(12).optional(),
  note: z.string().trim().max(2000).optional(),
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timeOfDay: z.enum(["morning", "afternoon", "either"]).optional(),
});

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details.", code: "invalid" }, { status: 400 });
  const b = parsed.data;

  if (b.estimateId) {
    const owned = await loadOwnedEstimate(b.estimateId);
    if (isResponse(owned)) return owned;
    const r = await createVisitRequest(owned.svc, { ...b, est: owned.est, draftId: null, actorUserId: owned.actor.user.id });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json({ ok: true, requestId: r.requestId, dueAt: r.dueAt });
  }

  // Before the range: the customer's own draft. A call request needs a range (R25).
  if (b.kind === "call") return NextResponse.json({ error: "Speak with us is offered once you have seen your guide price.", code: "no_range" }, { status: 409 });
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Open your estimate from the link we sent you.", code: "signed_out" }, { status: 403 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "Requests aren't available just now.", code: "unavailable" }, { status: 503 });
  const draft = await findOpenDraft(svc, { userId: actor.user.id, verifiedEmail: actor.kind === "customer" ? actor.verifiedEmail : null });
  const draftRow = draft?.own ? draft.row : null;
  // The draft's typed suburb and postcode stand in when the form gave none.
  const r = await createVisitRequest(svc, {
    ...b, est: null, draftId: draftRow?.id ?? null, actorUserId: actor.user.id,
    suburb: b.suburb ?? draftRow?.suburb ?? undefined,
    postcode: b.postcode ?? ((draftRow?.state as { customer?: { postcode?: string } } | null)?.customer?.postcode ?? undefined),
    street: b.street ?? draftRow?.address ?? undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true, requestId: r.requestId, dueAt: r.dueAt });
}
