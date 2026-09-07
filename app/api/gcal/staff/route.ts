import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteStaffConnection, reconcileStaffCalendar } from "@/lib/gcal/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P6 — the staff calendar's three verbs, for the signed-in staff member only:
 *   POST {}                  → sync now
 *   POST { pushJobs: bool }  → also push booked jobs, then sync
 *   DELETE                   → disconnect
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  if (!user) return NextResponse.json({ error: "staff only" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { pushJobs?: boolean };
  if (typeof body.pushJobs === "boolean") {
    const admin = createServiceClient();
    if (!admin) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    await admin.from("staff_gcal_connections").update({ push_jobs: body.pushJobs }).eq("staff_id", user.id);
  }
  return NextResponse.json(await reconcileStaffCalendar(user.id));
}

export async function DELETE() {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  if (!user) return NextResponse.json({ error: "staff only" }, { status: 403 });
  const admin = createServiceClient();
  if (!admin) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  await deleteStaffConnection(admin, user.id);
  return NextResponse.json({ status: "disconnected" });
}
