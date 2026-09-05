import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { IDLE_MINUTES } from "@/lib/wizard/journey";
import { sweepWizardSessions } from "@/lib/wizard/sweep";

/**
 * Buckets brief §4.3 — the scheduled sweep (vercel.json; daily on the Hobby
 * plan, every 30 minutes once on Pro). `?minutes=` overrides the idle window
 * (the e2e passes 0). The same pass also runs from the staff screens
 * (lib/wizard/sweep.ts maybeSweep).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "no" }, { status: 401 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "no service client" }, { status: 503 });
  const param = new URL(request.url).searchParams.get("minutes");
  const minutes = param == null ? IDLE_MINUTES : Math.max(0, Number(param) || 0);
  try {
    const result = await sweepWizardSessions(db, minutes);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}
