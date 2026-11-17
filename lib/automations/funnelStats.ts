import type { SupabaseClient } from "@supabase/supabase-js";
import { FUNNEL_KEYS, type FunnelStats } from "./funnel";
import { realOnly } from "@/lib/demo/scope";

/**
 * Sends per funnel message, last 30 days (A‑B: stats read from
 * messages.meta.automation; staff alerts from staff_notifications). Two reads
 * for the whole screen, counted here. A refused read is returned as the
 * error — the screen says so rather than showing zeros.
 */
export async function loadFunnelStats(db: SupabaseClient, now = new Date()): Promise<{ stats: FunnelStats; error: string | null }> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const keys = [...FUNNEL_KEYS];
  const [msgs, alerts] = await Promise.all([
    realOnly(db.from("messages").select("automation:meta->>automation, occurred_at")).eq("direction", "out").in("meta->>automation", keys)
      .not("status", "in", "(failed,suppressed)").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(5000),
    db.from("staff_notifications").select("event_key, created_at").in("event_key", keys).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
  ]);
  const error = msgs.error?.message ?? alerts.error?.message ?? null;
  const stats: FunnelStats = {};
  const add = (key: string | null, at: string) => {
    if (!key) return;
    const s = (stats[key] ??= { sent: 0, last: null });
    s.sent += 1;
    if (!s.last || at > s.last) s.last = at;
  };
  for (const m of (msgs.data ?? []) as { automation: string | null; occurred_at: string }[]) add(m.automation, m.occurred_at);
  for (const a of (alerts.data ?? []) as { event_key: string; created_at: string }[]) add(a.event_key, a.created_at);
  return { stats, error };
}
