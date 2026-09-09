import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { sendMagicLink } from "@/lib/portal/auth";
import { reportError } from "@/lib/monitoring/report";

/**
 * "Keep this estimate" — the third door on the guide range.
 *
 * This is where ⚑1's email gate went. It used to stand in front of the price,
 * on the last page of the questions, and §2.6 called it "reasonable for
 * retargeting; costly for conversion". It now stands in front of KEEPING the
 * price instead, which is the one place a customer actually wants to give an
 * address: they have seen a number, and they want it back later.
 *
 * Three things happen, in this order, because each is worth having on its own:
 *   1. the estimate joins an account, so it survives the anonymous session
 *   2. the email lands on the wizard draft, so the funnel can reach a person
 *      who never comes back
 *   3. a sign-in link is emailed, so they can open it on any device
 *
 * The send is BEST EFFORT and last. An email outage must not cost somebody
 * the estimate they asked us to keep — the account link is the durable part,
 * and the response says honestly which of the two happened.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  estimateId: z.string().uuid(),
  email: z.string().trim().email("That email doesn't look right.").max(200),
  name: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Not signed in." }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { estimateId, name } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "We can't save that just now." }, { status: 503 });
  const db = actor.kind === "customer" ? svc : supabase;

  // Ownership: an anonymous visitor may only keep the estimate their own
  // session created. Without this, the id in the body is a way to attach any
  // stranger's estimate to an address you control.
  const { data: est } = await db.from("estimates")
    .select("id, created_by, builder_state").eq("id", estimateId).maybeSingle();
  if (!est) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
  if (actor.kind === "customer" && est.created_by !== actor.user.id) {
    return NextResponse.json({ error: "That isn't your estimate." }, { status: 403 });
  }

  // 1. The durable half — the account, the property, and the link between them.
  let accountId: string | null = null;
  try {
    const state = (est.builder_state ?? {}) as Record<string, unknown>;
    const addr = state.jobAddress as { address?: string; city?: string; state?: string; postal?: string } | undefined;
    const linked = await ensureAccountAndProperty(db, {
      email,
      name: name?.trim() || null,
      phone: null,
      address: addr?.address
        ? { street: addr.address, suburb: addr.city ?? "", state: addr.state ?? "", postcode: addr.postal ?? "" }
        : undefined,
    });
    accountId = linked.accountId;
    if (accountId) {
      await db.from("estimates")
        .update({ account_id: accountId, property_id: linked.propertyId })
        .eq("id", estimateId);
    }
  } catch (e) {
    // Never fatal: the customer asked us to keep their estimate, and the
    // estimate already exists. Report and carry on to the email.
    reportError(e, { where: "wizard.keep.link", bestEffort: true });
  }

  // 2. The funnel's handle. Until now an anonymous quick look left a draft
  //    with no way to reach the person; this is the moment that changes.
  try {
    await db.from("wizard_drafts")
      .update({ email, ...(name?.trim() ? { name: name.trim() } : {}) })
      .eq("estimate_id", estimateId);
  } catch (e) {
    reportError(e, { where: "wizard.keep.draft", bestEffort: true });
  }

  // 3. The link itself. `sendMagicLink` mints OUR /account/auth URL and
  //    creates the auth user on first use — the anonymous wizard session
  //    carries no email of its own, so this is always a first sign-in.
  const sent = await sendMagicLink({
    email,
    next: `/estimate/scope?id=${estimateId}`,
    subject: "Your painting estimate",
    intro:
      "Here's the link back to your estimate. It opens straight to your price — no password needed.\n\n" +
      "Nothing is booked and nothing is owed; the estimate is yours to pick up whenever you like.",
    buttonLabel: "Open my estimate",
  });

  return NextResponse.json({
    ok: true,
    saved: accountId != null,
    // Said plainly rather than claimed: "sent" only when it really went.
    emailed: sent.status === "sent",
    why: sent.status === "sent" ? null : sent.status,
  });
}
