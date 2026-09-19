import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { addDays, melbourneDay, runMetric, type MetricResult } from "@/lib/reporting/core";
import { loadMetricInput } from "@/lib/reporting/load";
import { METRICS } from "@/lib/reporting/registry";
import { DASHBOARD_ROLES } from "@/lib/reporting/roles";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Session 1 — the nightly rollup. Runs from Vercel Cron after the wo-sweep
 * (`Authorization: Bearer $CRON_SECRET`; without the secret it refuses).
 * Computes every PERIOD metric for the Melbourne day just ended — or the
 * `?day=yyyy-mm-dd` asked for, back to `?days=N` of them — with the same
 * functions the page runs live, and upserts one row per (day, metric).
 * Now metrics are state, not history, and are never rolled up.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: "service unavailable" }, { status: 503 });

  const url = new URL(request.url);
  const now = new Date();
  const last = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") ?? "") ? url.searchParams.get("day")! : addDays(melbourneDay(now), -1);
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days") ?? 1) || 1));

  const written: { day: string; metrics: number }[] = [];
  const failures: { day: string; message: string }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(last, -i);
    const range = { from: day, to: day };
    try {
      const { input, failures: loadFailures } = await loadMetricInput(service, range, now);
      if (loadFailures.length) { failures.push({ day, message: loadFailures.map((f) => f.where).join(", ") }); continue; }
      const rows = METRICS.filter((m) => m.kind === "period").map((m) => {
        const r: MetricResult = runMetric(m, input, range, DASHBOARD_ROLES);   // the cron holds every role: it is the owner's cache
        return { day, metric_key: m.key, value: r.value, rows: r.rows.length, unit: m.unit, computed_at: now.toISOString() };
      });
      const { error } = await service.from("metrics_daily").upsert(rows, { onConflict: "day,metric_key" });
      if (error) throw new Error(error.message);
      written.push({ day, metrics: rows.length });
    } catch (e) {
      reportError(e, { where: "cron.metricsDaily", extra: { day } });
      failures.push({ day, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: failures.length === 0, written, failures });
}
