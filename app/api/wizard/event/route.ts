import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { wizardEventBodySchema, type WizardEventBody } from "@/lib/wizard/wizardEvents";

/**
 * POST /api/wizard/event — wizard mobile v5, brief §8: the customer's
 * wizard events into the one log (`crm_events`).
 *
 * The browser sends a type and a payload and nothing else. The session is
 * the caller's open wizard draft (the anonymous or signed-in user's newest
 * row, the way /api/wizard/outcome finds it), and the draft's account and
 * estimate ride on the event so the timeline and the funnel can join it.
 * Every event is deduped per session — a step viewed twice is one view —
 * so the dashboard's rates count SESSIONS, never taps. Always 204: the
 * screen being measured is never broken by its measurement.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const done = () => new NextResponse(null, { status: 204 });

/** Per-session idempotency: the facts that make the event unique, never the clock (except the surface toggle, which is a stream). */
function keyFor(sessionId: string, e: WizardEventBody, nowIso: string): string {
  switch (e.type) {
    case "wizard_step_viewed": return `wiz-step:${sessionId}:${e.payload.step}`;
    case "surface_toggled": return `wiz-surface:${sessionId}:${e.payload.surface}:${e.payload.on ? "on" : "off"}:${nowIso.slice(0, 16)}`;
    case "gate_viewed": return `wiz-gate:${sessionId}`;
    case "gate_cta_clicked": return `wiz-cta:${sessionId}:${e.payload.cta}`;
    case "contact_opened": return `wiz-contact:${sessionId}:${e.payload.step}`;
    case "scope_viewed": return `wiz-scope:${sessionId}`;
  }
}

export async function POST(request: Request) {
  if (!allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return done();
  const parsed = wizardEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return done();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return done();
  const db = createServiceClient();
  if (!db) return done();

  try {
    const { data: draft, error } = await db.from("wizard_drafts")
      .select("id, account_id, estimate_id")
      .eq("user_id", user.id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    if (error) { reportError(error, { where: "wizard.event.draft", bestEffort: true }); return done(); }
    if (!draft) return done();
    const nowIso = new Date().toISOString();
    const e = parsed.data;
    await logCrmEvent(db, {
      type: e.type,
      source: "customer",
      accountId: (draft.account_id as string | null) ?? null,
      estimateId: (draft.estimate_id as string | null) ?? null,
      payload: { ...e.payload, sessionId: draft.id as string },
      dedupeKey: keyFor(draft.id as string, e, nowIso),
    });
  } catch (err) {
    reportError(err, { where: "wizard.event", bestEffort: true });
  }
  return done();
}
