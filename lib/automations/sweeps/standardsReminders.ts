/**
 * Finish standards reminders (brief Step 2, ⚑17 / ⚑18). SERVER ONLY, service
 * client, off the half-hour campaign sweep.
 *
 * Every painter the office has invited (or who joined) and who has not yet
 * confirmed the six sections is texted on days 2, 4 and 6 after the invite at
 * 9 am Melbourne (settings.standards_rules). The ladder is `runLadder`'s: one
 * claim per (painter, rung) so two sweeps never double-text, missed rungs are
 * claimed quietly rather than sent late, and "still needed?" is asked at send
 * time — a painter who confirmed between sweeps gets nothing more. The claim
 * entity carries the invite instant, so a RE-invite (a new version, or the
 * office inviting again) starts a fresh ladder rather than finding old claims.
 *
 * The same sweep sends message 4 once to every painter a material new version
 * re-invited (`standards_new_version` events), claimed per (painter, version).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { claimRung, runLadder } from "../reminders";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn } from "@/lib/messaging/config";
import { reportError } from "@/lib/monitoring/report";
import { needsSignoff, standardsReminderLadder } from "@/lib/standards/acks";
import { loadStandardsRules, loadStandardsStatuses } from "@/lib/standards/status";
import { sendStandardsNewVersion, sendStandardsReminder } from "@/lib/standards/notify";

export const STANDARDS_REMINDER_KEY = "contractor_standards_reminder";
export const STANDARDS_NEW_VERSION_KEY = "contractor_standards_new_version";

export type StandardsReminderResult = { reminded: number; stopped: number; newVersion: number };

export async function runStandardsReminderSweep(db: SupabaseClient, now = new Date()): Promise<StandardsReminderResult> {
  const out: StandardsReminderResult = { reminded: 0, stopped: 0, newVersion: 0 };
  try {
    const { messaging } = await loadMessaging(db);
    const { rows, error } = await loadStandardsStatuses(db);
    if (error) throw new Error(error);
    const rules = await loadStandardsRules(db);
    const unsigned = rows.filter((r) => needsSignoff(r.status) && r.invitedAt);
    if (unsigned.length === 0) return out;

    // Message 2 — the ladder.
    const reminder = automationByKey(STANDARDS_REMINDER_KEY);
    if (reminder && automationOn(messaging, reminder.key)) {
      for (const r of unsigned) {
        const invitedAt = new Date(r.invitedAt as string);
        const ladder = standardsReminderLadder(invitedAt, rules);
        const res = await runLadder(db, {
          key: reminder.key,
          entityId: `${r.contractorId}@${invitedAt.toISOString()}`,
          anchor: ladder.anchor, rungs: ladder.rungs, now,
          stillNeeded: async () => {
            const { rows: again, error: e2 } = await loadStandardsStatuses(db);
            if (e2) throw new Error(e2);
            const me = again.find((x) => x.contractorId === r.contractorId);
            return me && needsSignoff(me.status) ? { ok: true } : { ok: false, reason: "The painter has confirmed the standards." };
          },
          send: async (rung) => { await sendStandardsReminder(db, r.contractorId, rung.id); },
        });
        if (res.fired) out.reminded += 1;
        if (res.stopped) out.stopped += 1;
      }
    }

    // Message 4 — once per (painter, version) a material version re-invited.
    const newVersion = automationByKey(STANDARDS_NEW_VERSION_KEY);
    if (newVersion && automationOn(messaging, newVersion.key)) {
      const { data: events, error: evErr } = await db.from("contractor_events")
        .select("contractor_id, detail").eq("type", "standards_new_version")
        .in("contractor_id", unsigned.map((r) => r.contractorId)).limit(500);
      if (evErr) throw evErr;
      for (const e of (events ?? []) as { contractor_id: string; detail: { version_no?: number } | null }[]) {
        const version = e.detail?.version_no;
        if (!version) continue;
        if (!(await claimRung(db, newVersion.key, e.contractor_id, `v${version}`))) continue;
        await sendStandardsNewVersion(db, e.contractor_id);
        out.newVersion += 1;
      }
    }
  } catch (e) {
    reportError(e, { where: "automations.standardsReminders" });
  }
  return out;
}
