import type { SupabaseClient } from "@supabase/supabase-js";
import { melbourneDate, melbourneDayStartUtc } from "@/lib/workorder/console";
import { staffCustomerUpdateDue } from "@/lib/staff/notify";
import { reportError } from "@/lib/monitoring/report";

/**
 * Tom, 7 Oct 2026: "send a text message and email to Felipe when the client is
 * due an update on the job, with a reminder to do the update."
 *
 * The same rule as the PC console's "Customer update due" card
 * (lib/workorder/console.ts, 5d): a job at In progress / finishing up whose
 * customer has had no approved or sent update for `updateEveryDays` (loop
 * setting, default 3) counted from the last one or the start date, and nothing
 * drafted waiting. One alert per job per Melbourne day while that holds — the
 * guard row in staff_notifications is the "once".
 */
export type UpdateDueJob = { workOrderId: string; quietDays: number };

export function jobsDueAnUpdate(input: {
  workOrders: { id: string; stage: string; startDate: string | null }[];
  draftedWorkOrderIds: Iterable<string>;
  lastUpdateAt: Record<string, string>;
  everyDays: number;
  now: Date;
}): UpdateDueJob[] {
  const drafted = new Set(input.draftedWorkOrderIds);
  const out: UpdateDueJob[] = [];
  for (const w of input.workOrders) {
    if (w.stage !== "in_progress" && w.stage !== "completion_prep") continue;
    if (drafted.has(w.id)) continue;
    const since = input.lastUpdateAt[w.id] ?? w.startDate;
    if (!since) continue;
    const sinceMs = since.length === 10
      ? Date.parse(melbourneDayStartUtc(new Date(`${since}T12:00:00Z`))) + 8 * 3_600_000
      : Date.parse(since);
    const hours = (input.now.getTime() - sinceMs) / 3_600_000;
    if (hours < input.everyDays * 24) continue;
    out.push({ workOrderId: w.id, quietDays: Math.floor(hours / 24) });
  }
  return out;
}

export async function sendCustomerUpdateDueAlerts(db: SupabaseClient, now: Date): Promise<{ due: number; sent: number }> {
  const [jobs, drafted, updates, loop] = await Promise.all([
    db.from("work_orders").select("id, stage, start_date").in("stage", ["in_progress", "completion_prep"]).limit(500),
    db.from("wo_updates").select("work_order_id").eq("status", "drafted").limit(1000),
    db.from("wo_updates").select("work_order_id, approved_at, sent_at, created_at").in("status", ["approved", "sent"])
      .gte("created_at", new Date(now.getTime() - 60 * 86_400_000).toISOString()).limit(5000),
    db.from("settings").select("value").eq("key", "wo_loop").maybeSingle(),
  ]);
  for (const [label, r] of [["jobs", jobs], ["drafted", drafted], ["updates", updates], ["loop", loop]] as const) {
    if (r.error) { reportError(r.error, { where: `updateDue.${label}` }); return { due: 0, sent: 0 }; }
  }
  const lastUpdateAt: Record<string, string> = {};
  for (const u of (updates.data ?? []) as { work_order_id: string; approved_at: string | null; sent_at: string | null; created_at: string }[]) {
    const at = u.sent_at ?? u.approved_at ?? u.created_at;
    if (!lastUpdateAt[u.work_order_id] || lastUpdateAt[u.work_order_id] < at) lastUpdateAt[u.work_order_id] = at;
  }
  const everyDays = Number(((loop.data as { value?: { updateEveryDays?: unknown } } | null)?.value?.updateEveryDays) ?? 3) || 3;
  const due = jobsDueAnUpdate({
    workOrders: ((jobs.data ?? []) as { id: string; stage: string; start_date: string | null }[]).map((w) => ({ id: w.id, stage: w.stage, startDate: w.start_date })),
    draftedWorkOrderIds: ((drafted.data ?? []) as { work_order_id: string }[]).map((d) => d.work_order_id),
    lastUpdateAt, everyDays, now,
  });
  const day = melbourneDate(now);
  let sent = 0;
  for (const j of due) {
    if ((await staffCustomerUpdateDue(db, j.workOrderId, day, j.quietDays)) === "sent") sent += 1;
  }
  return { due: due.length, sent };
}
