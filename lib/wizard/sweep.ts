import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketFor, IDLE_MINUTES, pageLabel, type WizardOutcome } from "./journey";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";
import { isTestEmail } from "@/lib/accounts/identity";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { sendMagicLink } from "@/lib/portal/auth";
import { pageLabel } from "./journey";

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
export type SweepResult = { checked: number; dropped: number; priced: number; emailed: number; idleMinutes: number };

export async function sweepWizardSessions(db: SupabaseClient, minutes: number = IDLE_MINUTES, now = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
  const { data: rows, error } = await db.from("wizard_drafts")
    .select("id, account_id, estimate_id, email, outcome, furthest_page, current_page, pages_total, job_type, address, suburb, active_seconds, converted_at, last_seen_at")
    .eq("bucket", "online_now").lte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);

  let dropped = 0, priced = 0, emailed = 0;
  // Settings → Automations, read once per pass and only if a drop-out needs it.
  let messaging: { messaging: MessagingSettings; company: { name?: string | null } } | null = null;
  for (const r of (rows ?? []) as Array<{ id: string; account_id: string | null; estimate_id: string | null; email: string | null; outcome: string; furthest_page: number; current_page: number | null; pages_total: number | null; job_type: string | null; address: string | null; suburb: string | null; active_seconds: number | null; converted_at: string | null; last_seen_at: string }>) {
    const bucket = bucketFor({ completed: r.converted_at != null, outcome: (r.outcome as WizardOutcome) ?? "none", lastActiveAt: r.last_seen_at, now, idleMinutes: minutes });
    if (bucket === "online_now") continue;
    const { error: e2 } = await db.from("wizard_drafts").update({ bucket, dropped_at: now.toISOString() }).eq("id", r.id).eq("bucket", "online_now");
    if (e2) { reportError(e2, { where: "wizard.sweep", bestEffort: true }); continue; }
    if (bucket === "dropped") {
      dropped += 1;
      const eventId = await logCrmEvent(db, {
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
      // Tom, 7 Sep (evening): the drop-out email — a sign-in link that lands
      // on the account page, where the unfinished estimate waits. Only the
      // FIRST drop of a session (the CRM event's dedupe key says so), only
      // with an email on the row, never to a test address, and only while
      // Settings → Automations has it on.
      const email = (r.email ?? "").trim().toLowerCase();
      if (eventId && email.includes("@") && !isTestEmail(email)) {
        try {
          messaging ??= await loadMessaging(db);
          if (automationOn(messaging.messaging, "wizard_abandoned")) {
            const vars = {
              company_name: messaging.company.name || "Paint Group",
              where: (r.address || r.suburb || "your property").trim(),
              page: pageLabel(r.job_type, Number(r.current_page) || r.furthest_page || 1),
            };
            const sent = await sendMagicLink({
              email, next: "/account",
              subject: renderTemplate(messaging.messaging.wizardResumeSubject, vars),
              intro: renderTemplate(messaging.messaging.wizardResumeBody, vars),
              buttonLabel: "Pick up where I left off",
            });
            if (sent.status === "sent") emailed += 1;
          }
        } catch (e) { reportError(e, { where: "wizard.sweep.resumeEmail", bestEffort: true }); }
      }
    } else priced += 1;
  }
  return { checked: rows?.length ?? 0, dropped, priced, emailed, idleMinutes: minutes };
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
