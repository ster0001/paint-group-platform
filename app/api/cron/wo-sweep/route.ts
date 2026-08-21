import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { composeUpdate, type TickEvent } from "@/lib/workorder/updates";
import { melbourneDate, melbourneDayStartUtc } from "@/lib/workorder/console";
import { reportError } from "@/lib/monitoring/report";

/**
 * The daily sweep: draft today's customer updates, and flag the silent sites.
 *
 * Runs from Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`.
 * Without CRON_SECRET set the route refuses everything — it does not fall back
 * to running unauthenticated, because it writes.
 *
 * Two things it deliberately does NOT do:
 *   - it never sends anything to a customer. It writes drafts; a person
 *     approves them.
 *   - it never back-dates. Drafts are written for the date being swept and
 *     flagged once per day, so a sweep that runs late produces one late result
 *     rather than a week of them at once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TickRow = {
  id: string;
  work_order_id: string;
  meta: { heading?: string; label?: string; from?: string; to?: string };
};

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function sweep() {
  const db = createServiceClient();
  if (!db) return { ok: false as const, error: "no service client" };

  // Melbourne, always — and the day's start is derived from the zone rather
  // than a hardcoded +10:00, which would be an hour out from October to April.
  const now = new Date();
  const today = melbourneDate(now);
  const since = melbourneDayStartUtc(now);

  // Every tick logged today, across every job.
  const { data: ticks, error: tickError } = await db
    .from("wo_events")
    .select("id, work_order_id, meta")
    .eq("type", "surface_tick")
    .gte("created_at", since);
  if (tickError) return { ok: false as const, error: tickError.message };

  const byJob = new Map<string, TickRow[]>();
  for (const row of (ticks ?? []) as TickRow[]) {
    byJob.set(row.work_order_id, [...(byJob.get(row.work_order_id) ?? []), row]);
  }

  let drafted = 0;
  for (const [workOrderId, rows] of byJob) {
    // Who the update is addressed to. First name only — the same rule the
    // contractor surfaces follow.
    const { data: wo } = await db
      .from("work_orders").select("estimate_id").eq("id", workOrderId).maybeSingle();
    const { data: estimate } = wo?.estimate_id
      ? await db.from("estimates").select("accepted_name, builder_state")
          .eq("id", wo.estimate_id).maybeSingle()
      : { data: null };

    const contact = (estimate?.builder_state as { contact?: { name?: string } } | null)?.contact?.name
      ?? (estimate?.accepted_name as string | null)
      ?? "";
    const firstName = contact.trim().split(/\s+/)[0] ?? "";

    const { count: photoCount } = await db
      .from("wo_photos")
      .select("id", { count: "exact", head: true })
      .eq("work_order_id", workOrderId)
      .gte("created_at", since);

    const composed = composeUpdate({
      customerFirstName: firstName,
      ticks: rows.map((r): TickEvent => ({
        heading: r.meta?.heading ?? "",
        label: r.meta?.label ?? "",
        from: r.meta?.from ?? "todo",
        to: r.meta?.to ?? "todo",
      })),
      photoCount: photoCount ?? 0,
      now: new Date(),
    });
    if (!composed) continue;   // nothing worth saying; no draft, no filler

    const { error } = await db.rpc("wo_draft_update", {
      p_work_order_id: workOrderId,
      p_for_date: today,
      p_text: composed,
      p_tick_ids: rows.map((r) => r.id),
      p_photo_count: photoCount ?? 0,
    });
    if (error) reportError(error, { where: "cron.woSweep.draft", extra: { workOrderId } });
    else drafted += 1;
  }

  const { data: flagged, error: sweepError } = await db.rpc("wo_zero_tick_sweep");
  if (sweepError) reportError(sweepError, { where: "cron.woSweep.zeroTick" });

  return { ok: true as const, date: today, drafted, flagged: flagged ?? 0 };
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const result = await sweep();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron issues GET; POST is here so the sweep can be triggered by hand
// from the console later without a second implementation.
export const POST = GET;
