import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { bucketFor, IDLE_MINUTES, type WizardOutcome } from "@/lib/wizard/journey";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * Brief §4.3 — every 30 minutes (vercel.json): sessions still marked
 * "online now" whose last attention is older than 45 minutes become
 * Dropped (no price yet) or Priced, no request (converted, nothing asked).
 * Idempotent: the bucket changes, so a row is never picked twice. ≤ 500
 * rows a run. `?minutes=` overrides the idle window (the e2e passes 0).
 * A dropped session logs wizard_abandoned on the account timeline once.
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
  const now = new Date();
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();

  const { data: rows, error } = await db.from("wizard_drafts")
    .select("id, account_id, estimate_id, email, outcome, furthest_page, converted_at, last_seen_at")
    .eq("bucket", "online_now").lte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: true }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let dropped = 0, priced = 0;
  for (const r of (rows ?? []) as Array<{ id: string; account_id: string | null; estimate_id: string | null; email: string | null; outcome: string; furthest_page: number; converted_at: string | null; last_seen_at: string }>) {
    const bucket = bucketFor({ completed: r.converted_at != null, outcome: (r.outcome as WizardOutcome) ?? "none", lastActiveAt: r.last_seen_at, now, idleMinutes: minutes });
    if (bucket === "online_now") continue;
    const { error: e2 } = await db.from("wizard_drafts").update({ bucket, dropped_at: now.toISOString() }).eq("id", r.id).eq("bucket", "online_now");
    if (e2) { reportError(e2, { where: "cron.wizardSweep", bestEffort: true }); continue; }
    if (bucket === "dropped") {
      dropped += 1;
      await logCrmEvent(db, {
        type: "wizard_abandoned", source: "system",
        accountId: r.account_id, estimateId: r.estimate_id,
        payload: { lastStep: Math.min(12, Math.max(1, r.furthest_page ?? 1)), emailCaptured: Boolean(r.email) },
        dedupeKey: `wizard-abandoned:${r.id}`,
      });
    } else priced += 1;
  }
  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, dropped, priced, idleMinutes: minutes });
}
