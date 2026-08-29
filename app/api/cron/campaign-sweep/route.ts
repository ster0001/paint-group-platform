import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSweep } from "@/lib/campaigns/runSweep";
import { reportError } from "@/lib/monitoring/report";

/**
 * The campaign sweep, on a schedule.
 *
 * Enrols people and QUEUES messages. It sends nothing — every message it
 * writes sits in `queued` until a person approves it on the queue screen. That
 * is the same rule the wo-sweep follows: a cron may draft, only a human may
 * send.
 *
 * Refuses everything without CRON_SECRET rather than falling back to running
 * unauthenticated, because it writes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no" }, { status: 401 });
  }

  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "no service client" }, { status: 503 });

  try {
    const outcomes = await runSweep(db, new Date());
    return NextResponse.json({
      ok: true,
      swept: outcomes.length,
      outcomes,
      note: "Queued only. Nothing is sent by this route.",
    });
  } catch (e) {
    reportError(e, { where: "cron.campaignSweep" });
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}
