import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketFor, IDLE_MINUTES, pageLabel, type WizardOutcome } from "./journey";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

// SERVER ONLY.
/**
 * Buckets brief §4.3 — sessions still "online now" whose last attention is
 * older than the idle window become Dropped (no price yet) or Priced, no
 * request (converted, nothing asked). Idempotent (the bucket changes, so a
 * row is never picked twice), ≤ 500 rows a pass, one wizard_abandoned event
 * per dropped session.
 *
 * Who runs it: the Vercel cron (daily on the Hobby plan — 6 Sep: Vercel
 * refused every deploy while vercel.json asked for every 30 minutes; the
 * Pro plan lifts that) AND, opportunistically, the staff screens that show
 * the buckets (CRM Today, Estimates → Wizard) through maybeSweep(), so the
 * lists are current whenever someone is looking, plan or no plan.
 */
export type SweepResult = { checked: number; dropped: number; priced: number; idleMinutes: number };

export async function sweepWizardSessions(db: SupabaseClient, minutes: number = IDLE_MINUTES, now = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
  const { data: rows, error } = await db.from("wizard_drafts")
    .select("id, account_id, estimate_id, email, outcome, furthest_page, pages_total, job_type, active_seconds, converted_at, last_seen_at")
    .eq("bucket", "online_now").lte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);

  let dropped = 0, priced = 0;
  for (const r of (rows ?? []) as Array<{ id: string; account_id: string | null; estimate_id: string | null; email: string | null; outcome: string; furthest_page: number; pages_total: number | null; job_type: string | null; active_seconds: number | null; converted_at: string | null; last_seen_at: string }>) {
    const bucket = bucketFor({ completed: r.converted_at != null, outcome: (r.outcome as WizardOutcome) ?? "none", lastActiveAt: r.last_seen_at, now, idleMinutes: minutes });
    if (bucket === "online_now") continue;
    const { error: e2 } = await db.from("wizard_drafts").update({ bucket, dropped_at: now.toISOString() }).eq("id", r.id).eq("bucket", "online_now");
    if (e2) { reportError(e2, { where: "wizard.sweep", bestEffort: true }); continue; }
    if (bucket === "dropped") {
      dropped += 1;
      await logCrmEvent(db, {
        type: "wizard_abandoned", source: "system",
        accountId: r.account_id, estimateId: r.estimate_id,
        // The moment they dropped out is their LAST ACTIVITY (last_seen_at);
        // dropped_at on the row is only when this sweep noticed. The event
        // carries the real one so the record reads "last active 8:42 pm".
        payload: {
          lastStep: Math.min(12, Math.max(1, r.furthest_page ?? 1)), emailCaptured: Boolean(r.email),
          page: pageLabel(r.job_type, r.furthest_page ?? 1), pagesTotal: Math.min(12, Math.max(1, r.pages_total ?? 6)),
          lastActiveAt: r.last_seen_at, activeSeconds: Math.max(0, Math.round(r.active_seconds ?? 0)),
        },
        dedupeKey: `wizard-abandoned:${r.id}`,
      });
    } else priced += 1;
  }
  return { checked: rows?.length ?? 0, dropped, priced, idleMinutes: minutes };
}

/** At most one pass per server instance every few minutes; never throws, never blocks a page for long. */
const MAYBE_EVERY_MS = 5 * 60_000;
let lastRun = 0;
export async function maybeSweep(db: SupabaseClient | null): Promise<void> {
  if (!db) return;
  const now = Date.now();
  if (now - lastRun < MAYBE_EVERY_MS) return;
  lastRun = now;
  try { await sweepWizardSessions(db); } catch (e) { reportError(e, { where: "wizard.maybeSweep", bestEffort: true }); }
}
