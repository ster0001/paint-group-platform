/**
 * The reminder helper (Session 1) — the one way a ladder of reminders is
 * run. Sessions 3–7 (invoice, deposit, sign-off, variation, offer, job pack)
 * all use it, so the rules live once:
 *
 *   • rungs are hours after an anchor (+24h, +96h, …), each with an id;
 *   • a rung is CLAIMED before anything is sent — `automation_claims` has a
 *     primary key on (automation, entity, rung), so a sweep that runs twice,
 *     or two sweeps at once, fire it once;
 *   • only the LATEST due rung fires. Earlier rungs that were missed (the
 *     sweep was down for a week) are claimed silently, never sent late in a
 *     burst — the wo-sweep's "never back-date" rule;
 *   • `stillNeeded` is asked at send time, and a "no" claims the rung with
 *     the reason so the ladder stops.
 *
 * `dueRungs` is pure and tested; `runLadder` does the I/O.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

export type Rung = { id: string; afterHours: number };

/** Rungs whose moment has passed, in order. */
export function dueRungs(anchor: Date, rungs: Rung[], now: Date): Rung[] {
  return [...rungs].sort((a, b) => a.afterHours - b.afterHours)
    .filter((r) => anchor.getTime() + r.afterHours * 3_600_000 <= now.getTime());
}

/** Insert the claim; false when it already existed. */
export async function claimRung(db: SupabaseClient, key: string, entityId: string, rung: string): Promise<boolean> {
  const { data, error } = await db.from("automation_claims")
    .upsert({ automation_key: key, entity_id: entityId, rung }, { onConflict: "automation_key,entity_id,rung", ignoreDuplicates: true })
    .select("rung");
  if (error) throw error;
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/** Has this (automation, entity, rung) fired? */
export async function isClaimed(db: SupabaseClient, key: string, entityId: string, rung = ""): Promise<boolean> {
  const { data } = await db.from("automation_claims").select("rung").eq("automation_key", key).eq("entity_id", entityId).eq("rung", rung).maybeSingle();
  return Boolean(data);
}

export type LadderInput = {
  key: string;
  entityId: string;
  anchor: Date;
  rungs: Rung[];
  now?: Date;
  /** "Is it still needed?" — asked once, before the rung is claimed. */
  stillNeeded: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Sends the rung; runs only after the claim succeeded. */
  send: (rung: Rung) => Promise<unknown>;
};

export type LadderOutcome = { fired: string | null; skippedLate: string[]; stopped: string | null };

export async function runLadder(db: SupabaseClient, input: LadderInput): Promise<LadderOutcome> {
  const now = input.now ?? new Date();
  const due = dueRungs(input.anchor, input.rungs, now);
  const out: LadderOutcome = { fired: null, skippedLate: [], stopped: null };
  if (due.length === 0) return out;
  const latest = due[due.length - 1];
  try {
    // Missed rungs are claimed quietly so they never fire late.
    for (const r of due.slice(0, -1)) {
      if (await claimRung(db, input.key, input.entityId, r.id)) out.skippedLate.push(r.id);
    }
    if (await isClaimed(db, input.key, input.entityId, latest.id)) return out;
    const need = await input.stillNeeded();
    if (!need.ok) {
      // Claim it with the reason so the next sweep does not ask again.
      await claimRung(db, input.key, input.entityId, latest.id);
      out.stopped = need.reason;
      return out;
    }
    if (!(await claimRung(db, input.key, input.entityId, latest.id))) return out;
    await input.send(latest);
    out.fired = latest.id;
  } catch (e) {
    reportError(e, { where: "automations.runLadder", extra: { key: input.key, entityId: input.entityId } });
  }
  return out;
}
