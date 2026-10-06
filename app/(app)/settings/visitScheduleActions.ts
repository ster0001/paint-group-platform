"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { BOOKING_RULES_KEY, STANDARD_WEEK, mergeBookingRules, overlaps, type BookingRules } from "@/lib/visits/schedule";
import { loadWeek } from "@/lib/visits/scheduleDb";
import { ZONE_KEYS } from "@/lib/visits/zones";

/**
 * Settings → Visit schedule and Booking rules (addendum A §6, S2). Staff
 * session under RLS, zod first. A slot that starts inside another slot's run
 * is refused here (section 8, test 18) and again by the database's exclusion
 * constraint.
 */

type Result = { ok: true; id?: string } | { ok: false; message: string };

async function staffClient() {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  return user ? { supabase, user } : null;
}

function done(id?: string): Result {
  revalidatePath("/settings");
  revalidatePath("/crm/diary");
  return id ? { ok: true, id } : { ok: true };
}

const zone = z.enum(ZONE_KEYS);
const slotSchema = z.object({
  id: z.string().uuid().optional(),
  estimatorId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  startMinutes: z.number().int().min(0).max(1439),
  zones: z.array(zone).max(5),
  cond: z.object({ zone, ifPrevZone: zone }).nullable(),
});

/** Create or update one slot. The run length comes from the rules, never the browser. */
export async function saveSlotAction(raw: unknown): Promise<Result> {
  const parsed = slotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the day, time and zones." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const s = parsed.data;
  const { data: rulesRow, error: rulesErr } = await c.supabase.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle();
  if (rulesErr) return { ok: false, message: rulesErr.message };
  const rules = mergeBookingRules(rulesRow?.value);
  const mine = { weekday: s.weekday, startMinutes: s.startMinutes, lengthMinutes: rules.slotMinutes };
  if (s.startMinutes + rules.slotMinutes > 24 * 60) return { ok: false, message: "That slot would run past midnight." };
  let week: Awaited<ReturnType<typeof loadWeek>>;
  try { week = await loadWeek(c.supabase, s.estimatorId); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Read failed." }; }
  const clash = week.find((w) => w.id !== s.id && overlaps(mine, w));
  if (clash) {
    const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { ok: false, message: `That starts inside the ${t(clash.startMinutes)} slot, which runs to ${t(clash.startMinutes + clash.lengthMinutes)}.` };
  }
  const zones = [...new Set(s.zones)].sort();
  const row = {
    estimator_id: s.estimatorId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: rules.slotMinutes,
    zones, cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null, updated_at: new Date().toISOString(),
  };
  if (s.id) {
    const { error } = await c.supabase.from("visit_slots").update(row).eq("id", s.id).eq("estimator_id", s.estimatorId);
    if (error) return { ok: false, message: friendly(error.message) };
    return done(s.id);
  }
  const { data, error } = await c.supabase.from("visit_slots").insert(row).select("id").single();
  if (error) return { ok: false, message: friendly(error.message) };
  return done(data.id as string);
}

function friendly(msg: string): string {
  if (/visit_slots_no_overlap/.test(msg)) return "That slot overlaps another slot on the same day.";
  if (/visit_slots_one_per_start/.test(msg)) return "There is already a slot at that time on that day.";
  return msg;
}

export async function removeSlotAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_slots").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  return done();
}

/** Section 5's week for an estimator who has none yet. Refuses to overwrite a week that exists. */
export async function loadStandardWeekAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ estimatorId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  let week: Awaited<ReturnType<typeof loadWeek>>;
  try { week = await loadWeek(c.supabase, parsed.data.estimatorId); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Read failed." }; }
  if (week.length) return { ok: false, message: "This estimator already has a week. Remove its slots first if you want to start again." };
  const { data: rulesRow, error: rulesErr } = await c.supabase.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle();
  if (rulesErr) return { ok: false, message: rulesErr.message };
  const rules = mergeBookingRules(rulesRow?.value);
  const rows = STANDARD_WEEK.map((s) => ({
    estimator_id: parsed.data.estimatorId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: rules.slotMinutes,
    zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null,
  }));
  const { error } = await c.supabase.from("visit_slots").insert(rows);
  if (error) return { ok: false, message: friendly(error.message) };
  return done();
}

const rulesSchema = z.object({
  sameDay: z.boolean(),
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60),
  windowDays: z.number().int().min(1).max(90),
  holdMinutes: z.number().int().min(2).max(60),
  slotMinutes: z.number().int().min(15).max(480),
  visitMinutes: z.number().int().min(15).max(480),
  speakInteriorCapCents: z.number().int().min(0).max(100_000_000),
  speakExteriorCapCents: z.number().int().min(0).max(100_000_000),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
  publicHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(200),
  farEdgePairs: z.array(z.tuple([zone, zone])).max(10),
  gateOrder: z.enum(["details_first", "range_first"]),
  calendarRequired: z.boolean().default(true),
});

export async function saveBookingRulesAction(raw: unknown): Promise<Result> {
  const parsed = rulesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the numbers." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const rules: BookingRules = mergeBookingRules(parsed.data);
  if (rules.visitMinutes > rules.slotMinutes) return { ok: false, message: "The visit the customer sees cannot be longer than the slot." };
  if (rules.farEdgePairs.some(([a, b]) => a === b)) return { ok: false, message: "A far-edge pair needs two different zones." };
  const { error } = await c.supabase.from("settings").upsert({ key: BOOKING_RULES_KEY, value: rules }, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  return done();
}
