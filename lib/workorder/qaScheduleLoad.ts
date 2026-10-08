import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOKING_RULES_KEY } from "@/lib/visits/schedule";

/**
 * What the PC job page needs to show and schedule the quality checks (Tom,
 * 8 Oct 2026): each check's day and time, the booked final it must come
 * before, the public holidays the rule skips, and the last calendar-invite
 * outcome per check, with the names it went to. Staff session; every read is
 * checked — a failure is a line on the card, never an empty list.
 */
export type QaScheduleCheck = { id: string; kind: string; result: string | null; thinRecord: boolean; date: string | null; time: string | null };
export type QaInviteLine = { outcome: string; method: string; at: string; to: string[] };

export async function loadQaSchedule(supabase: SupabaseClient, workOrderId: string): Promise<{
  checks: QaScheduleCheck[];
  final: { date: string; time: string | null } | null;
  holidays: Set<string>;
  invites: Map<string, QaInviteLine>;
  failure: string | null;
}> {
  const [checksRes, finalRes, rulesRes, invitesRes] = await Promise.all([
    supabase.from("wo_qa_checks").select("id, kind, result, thin_record, scheduled_for, scheduled_time, created_at")
      .eq("work_order_id", workOrderId).order("created_at"),
    supabase.from("wo_walkthroughs").select("scheduled_date, scheduled_time")
      .eq("work_order_id", workOrderId).eq("kind", "final").eq("status", "booked")
      .order("created_at", { ascending: false }).limit(1),
    supabase.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle(),
    supabase.from("wo_events").select("meta, created_at")
      .eq("work_order_id", workOrderId).eq("type", "qa_check_invite").order("created_at", { ascending: false }).limit(200),
  ]);
  const failures = [
    checksRes.error && `the checks (${checksRes.error.message})`,
    finalRes.error && `the final walkthrough (${finalRes.error.message})`,
    rulesRes.error && `the public holidays (${rulesRes.error.message})`,
    invitesRes.error && `the calendar invites (${invitesRes.error.message})`,
  ].filter(Boolean);

  const checks = ((checksRes.data ?? []) as { id: string; kind: string; result: string | null; thin_record: boolean; scheduled_for: string | null; scheduled_time: string | null }[])
    .map((c) => ({ id: c.id, kind: c.kind, result: c.result, thinRecord: c.thin_record, date: c.scheduled_for, time: c.scheduled_time?.slice(0, 5) ?? null }));
  const f = ((finalRes.data ?? []) as { scheduled_date: string; scheduled_time: string | null }[])[0];
  const holidaysRaw = (rulesRes.data as { value?: { publicHolidays?: unknown } } | null)?.value?.publicHolidays;
  const holidays = new Set(Array.isArray(holidaysRaw) ? holidaysRaw.filter((d): d is string => typeof d === "string") : []);

  type Meta = { check_id?: string; outcome?: string; method?: string; to?: { profile_id: string; status: string }[] };
  const latest = new Map<string, { meta: Meta; at: string }>();
  for (const e of (invitesRes.data ?? []) as { meta: Meta | null; created_at: string }[]) {
    if (e.meta?.check_id && !latest.has(e.meta.check_id)) latest.set(e.meta.check_id, { meta: e.meta, at: e.created_at });
  }
  const profileIds = [...new Set([...latest.values()].flatMap((l) => (l.meta.to ?? []).map((t) => t.profile_id)))];
  const names = new Map<string, string>();
  if (profileIds.length) {
    const { data, error } = await supabase.from("profiles").select("id, name").in("id", profileIds);
    if (error) failures.push(`who the invites went to (${error.message})`);
    for (const p of (data ?? []) as { id: string; name: string | null }[]) names.set(p.id, p.name || "a staff login");
  }
  const invites = new Map<string, QaInviteLine>();
  for (const [checkId, l] of latest) {
    invites.set(checkId, {
      outcome: l.meta.outcome ?? "sent", method: l.meta.method ?? "REQUEST", at: l.at,
      to: (l.meta.to ?? []).map((t) => names.get(t.profile_id) ?? "a staff login"),
    });
  }

  return {
    checks,
    final: f ? { date: f.scheduled_date, time: f.scheduled_time?.slice(0, 5) ?? null } : null,
    holidays, invites,
    failure: failures.length ? `Couldn't read ${failures.join(", ")}.` : null,
  };
}

/** The invite line under a check, in the office's words. */
export function inviteLineText(l: QaInviteLine | undefined, at: (iso: string) => string): string | null {
  if (!l) return null;
  const who = l.to.length ? l.to.join(", ") : "nobody";
  if (l.outcome === "nobody") return "No calendar invite — nobody is ticked for \"QA invite\" in Settings → Staff alerts.";
  if (l.outcome === "not_configured") return "No calendar invite — email is not set up on this site.";
  if (l.outcome === "error") return `Calendar invite to ${who} FAILED (${at(l.at)}) — it is retried automatically.`;
  return l.method === "CANCEL" ? `Taken out of ${who}'s calendar ${at(l.at)}.` : `Calendar invite sent to ${who} ${at(l.at)}.`;
}
