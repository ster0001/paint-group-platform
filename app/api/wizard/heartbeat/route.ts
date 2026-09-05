import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { bucketFor, type WizardOutcome } from "@/lib/wizard/journey";
import { reportError } from "@/lib/monitoring/report";

/**
 * Brief §2.3 — attention, not wall-clock. The wizard posts this every 15 s
 * ONLY while the tab is visible and the person has typed or scrolled in the
 * last minute. Each beat adds 15 s to active_seconds and to
 * step_times[page]. A beat inside 12 s of the last one is ignored (the
 * per-session rate limit), so a runaway client cannot inflate the numbers.
 * Best-effort like the autosave: every failure is a 200 with ok:false.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const HEARTBEAT_SECONDS = 15;
const MIN_GAP_MS = 12_000;

const bodySchema = z.object({ page: z.number().int().min(1).max(12) });

export async function POST(req: Request) {
  const quietly = (why: string) => NextResponse.json({ ok: false, why });
  let raw: unknown;
  try { raw = await req.json(); } catch { return quietly("unreadable"); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return quietly("shape");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return quietly("no session");
  const db = createServiceClient();
  if (!db) return quietly("no service client");

  try {
    const { data: d } = await db.from("wizard_drafts")
      .select("id, active_seconds, step_times, furthest_page, outcome, converted_at, last_heartbeat_at")
      .eq("user_id", user.id).is("converted_at", null).maybeSingle();
    if (!d) return quietly("no draft");
    const now = new Date();
    if (d.last_heartbeat_at && now.getTime() - new Date(d.last_heartbeat_at as string).getTime() < MIN_GAP_MS) {
      return NextResponse.json({ ok: false, why: "too soon" });
    }
    const page = String(parsed.data.page);
    const times = (d.step_times && typeof d.step_times === "object" && !Array.isArray(d.step_times) ? d.step_times : {}) as Record<string, number>;
    const stepTimes = { ...times, [page]: (Number(times[page]) || 0) + HEARTBEAT_SECONDS };
    const nowIso = now.toISOString();
    const { error } = await db.from("wizard_drafts").update({
      active_seconds: ((d.active_seconds as number) ?? 0) + HEARTBEAT_SECONDS,
      step_times: stepTimes,
      last_heartbeat_at: nowIso,
      last_seen_at: nowIso,
      current_page: parsed.data.page,
      furthest_page: Math.max((d.furthest_page as number) ?? 1, parsed.data.page),
      // Attention now = online now, unless a customer action already filed it.
      bucket: bucketFor({ completed: false, outcome: (d.outcome as WizardOutcome) ?? "none", lastActiveAt: nowIso, now }),
    }).eq("id", d.id);
    if (error) { reportError(error, { where: "wizard.heartbeat", bestEffort: true }); return quietly("update"); }
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, { where: "wizard.heartbeat", bestEffort: true });
    return quietly("threw");
  }
}
