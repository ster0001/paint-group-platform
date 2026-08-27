import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reconcileContractorCalendar, reconcileForOffer } from "@/lib/gcal/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sync ping. Accept/cancel/reschedule all happen as browser → Postgres
 * RPC calls with no server seam, so after a successful RPC the client fires
 * this (fire-and-forget) and the reconciler diffs the contractor's accepted
 * bookings against Google. Safe to call at any time; a missed ping is healed
 * by the next one or by the nightly cron.
 *
 * A contractor may only sync themselves (the body is ignored); staff name
 * either the contractor or the booking offer they just changed — an offer
 * resolves to every contractor it touches (reassignments involve two).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  let contractorId: string | null = null;
  if (profile?.role === "contractor") {
    const { data } = await supabase.from("contractors").select("id").eq("profile_id", user.id).maybeSingle();
    contractorId = (data as { id: string } | null)?.id ?? null;
  } else if (profile?.role === "staff") {
    const body = (await request.json().catch(() => ({}))) as { contractorId?: string; offerId?: string };
    if (typeof body.offerId === "string") {
      await reconcileForOffer(body.offerId);
      return NextResponse.json({ status: "synced_offer" });
    }
    contractorId = typeof body.contractorId === "string" ? body.contractorId : null;
  } else {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!contractorId) return NextResponse.json({ error: "no contractor" }, { status: 400 });

  const result = await reconcileContractorCalendar(contractorId);
  return NextResponse.json(result);
}
