import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkQueue } from "@/lib/crm/work-queue";
import { cachedBadge, rememberBadge } from "@/lib/crm/badgeCache";

export const dynamic = "force-dynamic";

/**
 * The Today badge, refreshed on navigation. Same evaluator as the page — a
 * separate count implementation is exactly the single-source violation the
 * brief forbids. Staff only; anyone else gets a zero, not an error, because
 * the tab rail is not a place to leak whether a queue exists.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 });

  // P7 fast path: the layout or the Today page parked the number moments ago.
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const hit = fresh ? null : cachedBadge(user.id);
  if (hit != null) return NextResponse.json({ count: hit, cached: true });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ count: 0 });

  const queue = await buildWorkQueue(supabase);
  const count = queue.counts.byBucket.overdue + queue.counts.byBucket.today;
  rememberBadge(user.id, count);
  return NextResponse.json({ count, cached: false });
}
