/**
 * Visit schedule — the database half (S2). Reads the week, the rules and the
 * Settings screen's data; every read checks its error. The pure rules live in
 * `./schedule.ts`; nothing here decides availability.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOKING_RULES_KEY, mergeBookingRules, type BookingRules, type SlotCond, type WeekSlot } from "./schedule";
import { isZoneKey, type ZoneKey } from "./zones";

export type SlotRow = {
  id: string;
  estimator_id: string;
  weekday: number;
  start_minutes: number;
  length_minutes: number;
  zones: string[];
  cond_zone: string | null;
  cond_if_prev_zone: string | null;
};

export const SLOT_SELECT = "id, estimator_id, weekday, start_minutes, length_minutes, zones, cond_zone, cond_if_prev_zone";

export function slotFromRow(r: SlotRow): WeekSlot & { id: string; estimatorId: string } {
  const cond: SlotCond | null = isZoneKey(r.cond_zone) && isZoneKey(r.cond_if_prev_zone) ? { zone: r.cond_zone, ifPrevZone: r.cond_if_prev_zone } : null;
  return {
    id: r.id, estimatorId: r.estimator_id, weekday: r.weekday, startMinutes: r.start_minutes, lengthMinutes: r.length_minutes,
    zones: r.zones.filter(isZoneKey) as ZoneKey[], cond,
  };
}

export async function loadBookingRules(db: SupabaseClient): Promise<BookingRules> {
  const { data, error } = await db.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle();
  if (error) throw new Error(`booking rules read failed: ${error.message}`);
  return mergeBookingRules(data?.value);
}

/** One estimator's week, ordered. */
export async function loadWeek(db: SupabaseClient, estimatorId: string): Promise<Array<WeekSlot & { id: string }>> {
  const { data, error } = await db.from("visit_slots").select(SLOT_SELECT).eq("estimator_id", estimatorId).order("weekday").order("start_minutes").limit(200);
  if (error) throw new Error(`visit_slots read failed: ${error.message}`);
  return ((data ?? []) as SlotRow[]).map(slotFromRow);
}

export type ScheduleEstimator = {
  id: string;
  name: string;
  /** The zones this estimator covers (visit_zones.estimator_id). */
  zones: ZoneKey[];
  slots: Array<WeekSlot & { id: string }>;
};

export type VisitScheduleData = {
  estimators: ScheduleEstimator[];
  rules: BookingRules;
  loadError: string | null;
};

/** Settings → Visit schedule: every staff login, the zones they cover, their week. */
export async function loadVisitScheduleData(db: SupabaseClient): Promise<VisitScheduleData> {
  const [staff, zones, slots, rules] = await Promise.all([
    db.from("profiles").select("id, name").eq("role", "staff").order("name").limit(50),
    db.from("visit_zones").select("key, estimator_id").order("key"),
    db.from("visit_slots").select(SLOT_SELECT).order("weekday").order("start_minutes").limit(2000),
    db.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle(),
  ]);
  const failed = [staff, zones, slots, rules].find((r) => r.error)?.error ?? null;
  const loadError = failed
    ? (failed.code === "42P01" || /does not exist/i.test(failed.message)
      ? "The visit schedule tables are not on this database yet — run migration 20270213000000_visit_slots_and_booking_rules.sql, then reload."
      : `The schedule could not be loaded: ${failed.message}`)
    : null;
  const byEst = new Map<string, Array<WeekSlot & { id: string }>>();
  for (const r of (slots.data ?? []) as SlotRow[]) {
    const list = byEst.get(r.estimator_id) ?? [];
    list.push(slotFromRow(r));
    byEst.set(r.estimator_id, list);
  }
  const zonesOf = new Map<string, ZoneKey[]>();
  for (const z of (zones.data ?? []) as Array<{ key: string; estimator_id: string | null }>) {
    if (!z.estimator_id || !isZoneKey(z.key)) continue;
    zonesOf.set(z.estimator_id, [...(zonesOf.get(z.estimator_id) ?? []), z.key]);
  }
  return {
    estimators: ((staff.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => ({
      id: p.id, name: p.name || "Unnamed", zones: zonesOf.get(p.id) ?? [], slots: byEst.get(p.id) ?? [],
    })),
    rules: mergeBookingRules(rules.data?.value),
    loadError,
  };
}
