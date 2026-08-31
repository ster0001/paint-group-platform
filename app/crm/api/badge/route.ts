import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkQueue } from "@/lib/crm/work-queue";

export const dynamic = "force-dynamic";

/**
 * The Today badge, refreshed on navigation. Same evaluator as the page — a
 * separate count implementation is exactly the single-source violation the
 * brief forbids. Staff only; anyone else gets a zero, not an error, because
 * the tab rail is not a place to leak whether a queue exists.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ count: 0 });

  const queue = await buildWorkQueue(supabase);
  return NextResponse.json({ count: queue.counts.byBucket.overdue + queue.counts.byBucket.today });
}
