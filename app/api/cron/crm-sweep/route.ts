import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runCrmSweep } from "@/lib/crm/sweep";
import { rebuildAllFacts } from "@/lib/crm/facts";

/**
 * CRM v2 P1 — the scheduled CRM sweep: lapse estimates past their valid_until,
 * then refresh stale crm_account_facts rows within a time budget. `?rebuild=1`
 * recomputes EVERY row (the "derived and rebuildable" guarantee; ops use, or
 * after a rules change in lib/crm/stage.ts). Bearer CRON_SECRET, like the
 * other sweeps.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "no" }, { status: 401 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "no service client" }, { status: 503 });
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("rebuild") === "1") {
      const rows = await rebuildAllFacts(db);
      return NextResponse.json({ ok: true, rebuilt: rows });
    }
    const budget = Number(url.searchParams.get("budget") ?? 45_000);
    const result = await runCrmSweep(db, { budgetMs: Number.isFinite(budget) ? budget : 45_000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}
