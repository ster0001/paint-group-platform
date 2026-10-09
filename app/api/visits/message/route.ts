import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { findOpenDraft } from "@/lib/wizard/draftOwner";
import { isResponse, loadOwnedEstimate } from "@/lib/visits/ownedEstimate";
import { postCustomerMessage } from "@/lib/visits/requests";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";

/**
 * S4 — "Send us a message" (R26, §4.5): into the customer's EXISTING chat
 * (the estimate chat after the range, the website chat before it) and
 * emailed to the office with a copy to the customer (R35). `clientId` makes a
 * retry harmless (section 8, test 17).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  estimateId: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  body: z.string().trim().min(1, "Please write your message first.").max(4000),
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    mobile: z.string().trim().min(8).max(30),
    street: z.string().trim().max(200).optional(),
    suburb: z.string().trim().max(80).optional(),
    postcode: z.string().trim().max(12).optional(),
  }).nullable().optional(),
});

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the message.", code: "invalid" }, { status: 400 });
  const b = parsed.data;

  if (b.estimateId) {
    const owned = await loadOwnedEstimate(b.estimateId);
    if (isResponse(owned)) return owned;
    const r = await postCustomerMessage(owned.svc, { clientId: b.clientId, est: owned.est, draftId: null, actorUserId: owned.actor.user.id, body: b.body, contact: b.contact ?? null });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json(r);
  }
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Open your estimate from the link we sent you.", code: "signed_out" }, { status: 403 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "Messages aren't available just now.", code: "unavailable" }, { status: 503 });
  const draft = await findOpenDraft(svc, { userId: actor.user.id, verifiedEmail: actor.kind === "customer" ? actor.verifiedEmail : null });
  const draftRow = draft?.own ? draft.row : null;
  const contact = b.contact ? { ...b.contact, suburb: b.contact.suburb ?? draftRow?.suburb ?? undefined } : null;
  const r = await postCustomerMessage(svc, { clientId: b.clientId, est: null, draftId: draftRow?.id ?? null, actorUserId: actor.user.id, body: b.body, contact });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json(r);
}
