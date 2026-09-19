import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, RANGE_PRESETS, resolveRange, runMetric } from "@/lib/reporting/core";
import { csvFilename, csvStream } from "@/lib/reporting/csv";
import { loadMetricInput, loadRoles } from "@/lib/reporting/load";
import { metricByKey } from "@/lib/reporting/registry";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Session 1 — THE export route (acceptance 5). Every list on the dashboard
 * exports through here: the metric's own rows, the metric's own columns,
 * streamed as CSV. The role check is the metric's (`runMetric`): a login
 * whose roles do not cover the metric gets 403 whatever screen sent them,
 * and a key that is not in the registry is 404, never a guess.
 */
const query = z.object({
  metric: z.string().min(3).max(80),
  preset: z.enum(RANGE_PRESETS).default("this_month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const def = metricByKey(parsed.data.metric);
  if (!def) return NextResponse.json({ error: "no such metric" }, { status: 404 });

  const roles = await loadRoles(supabase);
  const now = new Date();
  const range = resolveRange(parsed.data.preset, now, { from: parsed.data.from, to: parsed.data.to });

  try {
    const { input, failures } = await loadMetricInput(supabase, range, now);
    if (failures.length) return NextResponse.json({ error: "a read failed", failures }, { status: 503 });
    const result = runMetric(def, input, range, roles);
    return new Response(csvStream(def, result.rows as Record<string, unknown>[]), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(def, result.range)}"`,
        "Cache-Control": "no-store",
        "X-Metric-Value": String(result.value),
        "X-Metric-Rows": String(result.rows.length),
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "not available to this login" }, { status: 403 });
    reportError(e, { where: "reporting.export", extra: { metric: def.key } });
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}
