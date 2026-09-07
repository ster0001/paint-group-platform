"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { bookVisit, moveVisit, setVisitStatus, loadStaffAvailability, VISIT_COLUMNS, type BookResult } from "@/lib/visits/book";
import { freeStarts, at as melbourneAt } from "@/lib/visits/availability";
import { staffGcalStatus } from "@/lib/gcal/staff";
import { melbourneLocalParts } from "./time";
import type { VisitRow } from "@/lib/visits/types";

export type VisitActionResult = { ok: true; message: string; visitId?: string } | { ok: false; message: string };

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });

const after = (r: BookResult, okMessage: string): VisitActionResult => {
  revalidatePath("/crm/diary");
  revalidatePath("/crm/today");
  return r.ok ? { ok: true, message: okMessage, visitId: r.visitId } : { ok: false, message: r.message };
};

export async function bookVisitAction(input: {
  accountId?: string | null; propertyId?: string | null; estimateId?: string | null;
  staffId: string | null; startsAt: string; endsAt: string; kind?: string; note?: string | null; source?: "staff" | "phone";
}): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const parsed = z.object({
    accountId: uuid.nullable().optional(), propertyId: uuid.nullable().optional(), estimateId: uuid.nullable().optional(),
    staffId: uuid.nullable(), startsAt: iso, endsAt: iso,
    kind: z.enum(["quote", "remeasure", "colour_consult", "walkthrough"]).default("quote"),
    note: z.string().max(2000).nullable().optional(), source: z.enum(["staff", "phone"]).default("staff"),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pick an estimator, a date and a time." };
  const r = await bookVisit(supabase, parsed.data);
  if (r.ok && parsed.data.accountId) revalidatePath(`/crm/customers/${parsed.data.accountId}`);
  return after(r, "Booked. The customer gets the invite, and it's in the estimator's calendar.");
}

export async function visitOutcomeAction(visitId: string, status: "done" | "no_show" | "cancelled" | "rebook", note?: string): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  if (!uuid.safeParse(visitId).success) return { ok: false, message: "That isn't a visit." };
  const r = await setVisitStatus(supabase, visitId, status, note?.trim() || null);
  const { data: v } = await supabase.from("visits").select("account_id").eq("id", visitId).maybeSingle();
  if (v?.account_id) revalidatePath(`/crm/customers/${v.account_id}`);
  const said = { done: "Marked done — the record moves to “visit done”.", no_show: "No show recorded — it's on Today to rebook.",
    cancelled: "Cancelled. The calendar entry is pulled.", rebook: "Marked to rebook — it's on Today." }[status];
  return after(r, said);
}

export async function moveVisitAction(visitId: string, startsAt: string, endsAt: string, staffId: string | null): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const parsed = z.object({ visitId: uuid, startsAt: iso, endsAt: iso, staffId: uuid.nullable() }).safeParse({ visitId, startsAt, endsAt, staffId });
  if (!parsed.success) return { ok: false, message: "Pick a date and a time." };
  const r = await moveVisit(supabase, visitId, startsAt, endsAt, staffId);
  const { data: v } = await supabase.from("visits").select("account_id").eq("id", visitId).maybeSingle();
  if (v?.account_id) revalidatePath(`/crm/customers/${v.account_id}`);
  return after(r, "Moved. The customer gets the updated invite.");
}


// ---- the estimator's day (Tom, 7 Sep item 6) -------------------------------

export type DayPlan = {
  works: boolean;
  hours: [string, string];
  visitMinutes: number;
  /** What's already in the diary that day, in order. */
  busy: Array<{ from: string; to: string; label: string }>;
  /** Free blocks of at least one visit, as "HH:MM" starts you can tap. */
  free: Array<{ from: string; to: string }>;
  gcal: { connected: boolean; email: string | null; configured: boolean };
};

/**
 * Everything the diary knows about one estimator on one date, so a time can
 * be picked with the day in view instead of blind. Their Google Calendar
 * stays private by design (the app-created-calendar scope, see lib/gcal):
 * what they typed into Google directly is NOT here, and the panel says so.
 */
export async function dayPlanAction(staffId: string, date: string): Promise<DayPlan | { error: string }> {
  if (!uuid.safeParse(staffId).success) return { error: "That isn't an estimator." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "That isn't a date." };
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { error: "Staff only." };
  const staff = (await loadStaffAvailability(supabase)).find((s) => s.staffId === staffId);
  if (!staff) return { error: "No such estimator." };
  const dayStart = melbourneAt(date, staff.dayStart);
  const dayEnd = melbourneAt(date, staff.dayEnd);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const { data } = await supabase.from("visits").select(VISIT_COLUMNS)
    .eq("staff_id", staffId).eq("status", "booked")
    .gte("ends_at", melbourneAt(date, "00:00").toISOString()).lt("starts_at", melbourneAt(date, "23:59").toISOString())
    .order("starts_at", { ascending: true });
  const visits = (data ?? []) as VisitRow[];
  const busy = visits.map((v) => ({
    from: melbourneLocalParts(v.starts_at).time, to: melbourneLocalParts(v.ends_at).time,
    label: [v.customer_name || "Visit", v.suburb].filter(Boolean).join(" · "),
  }));
  // Free = every 15-minute start with room for a whole visit; merged into ranges.
  const starts = freeStarts(staffId, dayStart, dayEnd, staff.visitMinutes, visits.map((v) => ({ staffId, startsAt: v.starts_at, endsAt: v.ends_at })));
  const free: Array<{ from: string; to: string }> = [];
  for (const st of starts) {
    const end = new Date(st.getTime() + staff.visitMinutes * 60_000);
    const last = free[free.length - 1];
    const stLocal = melbourneLocalParts(st.toISOString()).time;
    const endLocal = melbourneLocalParts(end.toISOString()).time;
    if (last && last.to >= stLocal) last.to = endLocal; else free.push({ from: stLocal, to: endLocal });
  }
  const g = await staffGcalStatus(staffId).catch(() => ({ kind: "unconfigured" as const }));
  return {
    works: staff.days.includes(dow),
    hours: [staff.dayStart, staff.dayEnd],
    visitMinutes: staff.visitMinutes,
    busy, free,
    gcal: { connected: g.kind === "connected" || g.kind === "error", email: "email" in g ? g.email : null, configured: g.kind !== "unconfigured" },
  };
}
