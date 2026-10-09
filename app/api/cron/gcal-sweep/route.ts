import { NextResponse } from "next/server";
import { sweepAllStaff } from "@/lib/gcal/inbound";
import { reportError } from "@/lib/monitoring/report";

/**
 * Every five minutes (vercel.json): the Google Calendar sweep for estimators
 * (visit booking addendum A §4.6, S5). For each connected estimator it reads
 * our visit events back (a decline or a deletion cancels the visit, a move
 * raises a card), keeps the push channel alive, and re-runs the write side so a
 * failed insert is retried. Same shared-secret rule as wo-sweep.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run() {
  try {
    const r = await sweepAllStaff();
    return NextResponse.json({ ok: true, ...r, at: new Date().toISOString() });
  } catch (e) {
    reportError(e, { where: "gcal-sweep" });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return run();
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return run();
}
