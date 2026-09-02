import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseScopeStore } from "@/lib/agent/scope-store-supabase";
import { docFacts, graphInput } from "@/lib/agent/scope-doc";
import { nextGap } from "@/lib/agent/question-graph";
import { logCrmEvent } from "@/lib/crm/events";

/**
 * GET /api/cron/agent-sweep — drop-outs are leads (assistant brief §3.1).
 *
 * A guided conversation that captured an email (account linked) but has
 * gone quiet without an acceptance emits ONE `wizard_abandoned` event with
 * the stage it reached. Idempotent: the estimate remembers it was logged.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; `?minutes=` sets
 * the quiet window (default 30; the e2e passes 0).
 */

export const runtime = "nodejs";

/** Which of the §4 stages the next question sits in. */
function stageOf(key: string | null): number {
  if (!key) return 12;
  if (key.startsWith("q.")) return 1;
  if (key === "rooms" || key === "job.surfaces" || key === "ext.photos") return 2;
  if (key.startsWith("room.")) return 3;
  if (key.startsWith("condition.") || key === "occupied" || key.startsWith("paint.") || ["door_style", "window_style", "ceiling_height"].includes(key)) return 4;
  if (key.startsWith("ext.")) return 5;
  if (key.startsWith("side.")) return 6;
  if (key.startsWith("sweep.")) return 7;
  return 8;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "No service client." }, { status: 503 });
  const minutes = Math.max(0, Number(new URL(request.url).searchParams.get("minutes") ?? 30) || 0);
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

  const { data: convs, error } = await db.from("agent_conversations")
    .select("id, account_id, estimate_id, updated_at")
    .eq("status", "open").eq("mode", "guided").not("account_id", "is", null).not("estimate_id", "is", null)
    .lte("updated_at", cutoff).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const scope = new SupabaseScopeStore(db);
  const deps = { refs: await scope.refs(), ctx: await scope.ctx(), actor: "customer" as const };
  let logged = 0;
  for (const c of (convs ?? []) as Array<{ id: string; account_id: string; estimate_id: string }>) {
    const doc = await scope.load(c.estimate_id);
    if (!doc) continue;
    const agent = (doc.builderState.agent ?? {}) as { answers?: unknown; facts?: Record<string, unknown> };
    if (agent.facts?.abandonLoggedAt) continue;
    if ((doc.builderState as { prepPack?: unknown }).prepPack) continue; // accepted or booked
    const gap = nextGap(graphInput(doc, deps));
    const ok = await logCrmEvent(db, {
      type: "wizard_abandoned", accountId: c.account_id, estimateId: c.estimate_id, source: "customer",
      payload: { lastStep: stageOf(gap?.key ?? null), emailCaptured: Boolean(docFacts(doc).email) },
      dedupeKey: `agent_abandoned:${c.id}`,
    });
    if (ok) {
      logged++;
      await scope.save({ ...doc, builderState: { ...doc.builderState, agent: { answers: agent.answers ?? {}, facts: { ...(agent.facts ?? {}), abandonLoggedAt: new Date().toISOString() } } } });
    }
  }
  return NextResponse.json({ checked: (convs ?? []).length, logged });
}
