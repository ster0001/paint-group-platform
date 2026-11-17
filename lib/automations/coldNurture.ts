import { melbourneParts } from "@/lib/time/businessHours";
import type { MessagingSettings } from "@/lib/messaging/config";

/**
 * R5 cold nurture (automations brief §4.5, master plan E4; 17 Nov 2026). PURE.
 *
 * Cold = declined, expired, or a wizard lead that went nowhere, 90 days on —
 * and never anything since: an accepted estimate, or anything newer for the
 * same customer, takes them off the list. At most one message a quarter per
 * customer, sent on a weekday between 10 am and 3 pm Melbourne so the first
 * sweep of a quarter does not message everyone at midnight.
 */
export const COLD_AFTER_DAYS = 90;
export const COLD_UNTIL_DAYS = 730;

export type ColdCandidate = {
  id: string; status: string; account_id: string | null; created_at: string; sent_at: string | null;
  declined_at: string | null; valid_until: string | null; accepted_at: string | null; lead: boolean;
};

const DAY = 86_400_000;
/** When this estimate went cold, or null when it has not (or is too old to message). */
export function coldSince(e: ColdCandidate, now: Date): string | null {
  const at = e.status === "declined" ? e.declined_at
    : e.status === "expired" || (e.status === "sent" && e.valid_until && e.valid_until < now.toISOString().slice(0, 10)) ? (e.valid_until ? `${e.valid_until}T00:00:00Z` : e.sent_at)
    : e.status === "draft" && e.lead ? e.created_at
    : null;
  if (!at) return null;
  const age = now.getTime() - Date.parse(at);
  return age >= COLD_AFTER_DAYS * DAY && age <= COLD_UNTIL_DAYS * DAY ? at : null;
}

/** "2026-Q4" — the claim's rung, so one message a quarter. */
export function quarterKey(now: Date): string {
  const p = melbourneParts(now);
  return `${p.y}-Q${Math.floor((p.m - 1) / 3) + 1}`;
}

/** Weekdays 10:00–15:00 Melbourne. */
export function nurtureHour(now: Date): boolean {
  const p = melbourneParts(now);
  return p.weekday >= 1 && p.weekday <= 5 && p.h >= 10 && p.h < 15;
}

/** The season's line (southern hemisphere: Sep–Nov spring … Jun–Aug winter). */
export function seasonalLine(now: Date, m: Pick<MessagingSettings, "seasonalLineSpring" | "seasonalLineSummer" | "seasonalLineAutumn" | "seasonalLineWinter">): string {
  const month = melbourneParts(now).m;
  return month >= 9 && month <= 11 ? m.seasonalLineSpring : month === 12 || month <= 2 ? m.seasonalLineSummer : month <= 5 ? m.seasonalLineAutumn : m.seasonalLineWinter;
}

/**
 * One estimate per customer: the newest cold one, and none for a customer
 * who has accepted anything or has anything newer than 90 days.
 */
export function coldPerCustomer<E extends ColdCandidate>(all: readonly E[], now: Date): Array<{ estimate: E; customer: string; since: string }> {
  const byCustomer = new Map<string, E[]>();
  for (const e of all) {
    const key = e.account_id ?? `estimate:${e.id}`;
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), e]);
  }
  const out: Array<{ estimate: E; customer: string; since: string }> = [];
  for (const [customer, list] of byCustomer) {
    if (list.some((e) => e.accepted_at || e.status === "accepted")) continue;
    const recent = list.some((e) => now.getTime() - Date.parse(e.sent_at ?? e.created_at) < COLD_AFTER_DAYS * DAY);
    if (recent) continue;
    const cold = list.map((e) => ({ e, since: coldSince(e, now) })).filter((x): x is { e: E; since: string } => x.since != null)
      .sort((a, b) => Date.parse(b.e.created_at) - Date.parse(a.e.created_at))[0];
    if (cold) out.push({ estimate: cold.e, customer, since: cold.since });
  }
  return out;
}
