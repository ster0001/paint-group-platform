import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendAppointmentConfirmation } from "@/lib/workorder/appointmentEmail";
import { sendWalkthroughInvites } from "@/lib/workorder/walkthroughInvite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The appointment-confirmation ping (Tom, 1 Sep) — the gcal-sync pattern.
 *
 * A contractor accepting an offer is a browser → Postgres RPC call with no
 * server seam, so after a successful accept the portal fires this and the
 * server sends the customer their confirmation email (editable template in
 * Settings → Messaging) plus the final-walkthrough calendar invites. Safe to
 * call at any time: both sends are idempotent off wo_events, so a re-ping is
 * a no-op and a missed ping is healed by the nightly sweep backstop.
 *
 * A contractor may only confirm a job that is THEIRS; staff may name any job.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const body = z.object({ workOrderId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const workOrderId = body.data.workOrderId;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "contractor") {
    // Ownership through the caller's own RLS read — a contractor who isn't on
    // the job sees no row and confirms nothing.
    const { data: wo } = await supabase.from("work_orders").select("id").eq("id", workOrderId).maybeSingle();
    if (!wo) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else if (profile?.role !== "staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });

  await sendAppointmentConfirmation(service, workOrderId);
  await sendWalkthroughInvites(service, workOrderId);
  return NextResponse.json({ status: "ok" });
}
