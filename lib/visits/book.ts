/**
 * Booking, moving and closing visits (P6). SERVER ONLY.
 *
 * Every write goes through the three RPCs of migration 20270127 — the browser
 * never inserts into `visits` — and every write is followed by the two things
 * a booking owes the world: the customer's confirmation (lib/visits/notify.ts)
 * and the estimator's Google Calendar (lib/gcal/staff.ts). The CRM events
 * are the table's own triggers, so the lane and the timeline are never a
 * separate write that could be forgotten.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readGoogleBusyForStaff } from "@/lib/gcal/read";
import { DEFAULT_VISITS_SETTINGS, mergeVisitsSettings, type StaffAvailability, type VisitKind, type VisitRow, type VisitSource, type VisitsSettings } from "./types";
import { blockIsFree, offeredWindows, pickSlot, type Busy, type Window } from "./availability";
import { reconcileForVisit } from "@/lib/gcal/staff";
import { sendVisitConfirmation, sendVisitCancellation } from "./notify";
import { reportError } from "@/lib/monitoring/report";

export const VISITS_SETTINGS_KEY = "visits";
export const VISIT_COLUMNS = "id, account_id, property_id, estimate_id, staff_id, starts_at, ends_at, kind, status, source, address, suburb, customer_name, customer_phone, note, outcome_note, outcome_at, cancelled_at, cancel_reason, confirmation_sent_at, reminder_sent_at";

export async function loadVisitsSettings(db: SupabaseClient): Promise<VisitsSettings> {
  const { data } = await db.from("settings").select("value").eq("key", VISITS_SETTINGS_KEY).maybeSingle();
  return data ? mergeVisitsSettings(data.value) : DEFAULT_VISITS_SETTINGS;
}

/** Every staff member, with their availability row (defaults when none). */
export async function loadStaffAvailability(db: SupabaseClient): Promise<StaffAvailability[]> {
  const [{ data: staff }, { data: rows }] = await Promise.all([
    db.from("profiles").select("id, name").eq("role", "staff").order("name").limit(50),
    db.from("staff_availability").select("staff_id, takes_visits, days, day_start, day_end, visit_minutes, zone").limit(50),
  ]);
  const byId = new Map((rows ?? []).map((r) => [r.staff_id as string, r]));
  return (staff ?? []).map((p) => {
    const r = byId.get(p.id as string);
    return {
      staffId: p.id as string,
      name: (p.name as string) || "Unnamed",
      takesVisits: r?.takes_visits === true,
      days: (r?.days as number[] | undefined) ?? [1, 2, 3, 4, 5],
      dayStart: String(r?.day_start ?? "08:30").slice(0, 5),
      dayEnd: String(r?.day_end ?? "17:00").slice(0, 5),
      visitMinutes: (r?.visit_minutes as number | undefined) ?? 60,
      zone: (r?.zone as string | undefined) ?? "melbourne-metro",
    };
  });
}

/**
 * Booked visits between two instants — the busy list the availability engine
 * subtracts — plus, since 8 Sep, whatever a connected estimator has in their
 * own Google calendars (lib/gcal/read.ts), so the wizard never offers a
 * window that is really a dentist appointment. Google is best effort: no
 * connection, an old one, or Google down simply adds nothing.
 */
export async function loadBusy(db: SupabaseClient, from: Date, to: Date, opts: { google?: boolean } = {}): Promise<Array<Busy & { id: string }>> {
  const { data } = await db.from("visits").select("id, staff_id, starts_at, ends_at")
    .eq("status", "booked").gte("ends_at", from.toISOString()).lte("starts_at", to.toISOString()).limit(5000);
  const visits = (data ?? []).map((v) => ({ id: v.id as string, staffId: v.staff_id as string | null, startsAt: v.starts_at as string, endsAt: v.ends_at as string }));
  if (opts.google === false) return visits;
  const staffIds = (await loadStaffAvailability(db)).filter((s) => s.takesVisits).map((s) => s.staffId);
  const { busy } = await readGoogleBusyForStaff(staffIds, from, to).catch(() => ({ busy: [] }));
  return [...visits, ...busy.map((g) => ({ id: `google:${g.staffId}:${g.startsAt}`, staffId: g.staffId, startsAt: g.startsAt, endsAt: g.endsAt }))];
}

/** The windows the wizard offers right now. */
export async function offeredVisitWindows(db: SupabaseClient, now = new Date()): Promise<{ windows: Window[]; staff: StaffAvailability[]; busy: Busy[]; settings: VisitsSettings }> {
  const [settings, staff] = await Promise.all([loadVisitsSettings(db), loadStaffAvailability(db)]);
  const busy = await loadBusy(db, now, new Date(now.getTime() + (settings.horizonDays * 2 + 10) * 86_400_000));
  return { windows: offeredWindows(staff, busy, settings, now), staff, busy, settings };
}

export type BookInput = {
  accountId?: string | null;
  propertyId?: string | null;
  estimateId?: string | null;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  kind?: VisitKind;
  source?: VisitSource;
  note?: string | null;
};
export type BookResult = { ok: true; visitId: string } | { ok: false; message: string; code?: "double_booked" };

const friendly = (message: string): BookResult => {
  if (/double_booked|already taken|exclusion/i.test(message)) return { ok: false, message: "That time is already taken for this estimator — pick another.", code: "double_booked" };
  if (/end after it starts/.test(message)) return { ok: false, message: "The visit has to end after it starts." };
  return { ok: false, message: message.replace(/^.*visits: /, "") };
};

/** Book an exact block (staff), then confirm and sync. */
export async function bookVisit(db: SupabaseClient, input: BookInput): Promise<BookResult> {
  const { data, error } = await db.rpc("visit_book", {
    p_starts: input.startsAt, p_ends: input.endsAt,
    p_account: input.accountId ?? null, p_property: input.propertyId ?? null, p_estimate: input.estimateId ?? null,
    p_staff: input.staffId, p_kind: input.kind ?? "quote", p_source: input.source ?? "staff", p_note: input.note ?? null,
  });
  if (error) return friendly(error.message);
  const visitId = data as string;
  await afterWrite(db, visitId, [input.staffId]);
  return { ok: true, visitId };
}

/** Book a WINDOW the customer chose (the wizard): the engine picks the estimator and the block. */
export async function bookWindow(db: SupabaseClient, windowKey: string, input: Omit<BookInput, "staffId" | "startsAt" | "endsAt">, now = new Date()): Promise<BookResult> {
  const { staff, busy, settings } = await offeredVisitWindows(db, now);
  const slot = pickSlot(windowKey, staff, busy, settings, now);
  if (!slot) return { ok: false, message: "That time has just been taken — pick another.", code: "double_booked" };
  return bookVisit(db, { ...input, staffId: slot.staffId, startsAt: slot.startsAt, endsAt: slot.endsAt, source: input.source ?? "wizard" });
}

export async function moveVisit(db: SupabaseClient, visitId: string, startsAt: string, endsAt: string, staffId: string | null): Promise<BookResult> {
  const { data: before } = await db.from("visits").select("staff_id").eq("id", visitId).maybeSingle();
  if (staffId) {
    const busy = await loadBusy(db, new Date(startsAt), new Date(endsAt), { google: false });
    if (!blockIsFree(staffId, startsAt, endsAt, busy, visitId)) return { ok: false, message: "That time is already taken for this estimator — pick another.", code: "double_booked" };
  }
  const { error } = await db.rpc("visit_move", { p_id: visitId, p_starts: startsAt, p_ends: endsAt, p_staff: staffId });
  if (error) return friendly(error.message);
  await afterWrite(db, visitId, [before?.staff_id as string | null, staffId]);
  return { ok: true, visitId };
}

export async function setVisitStatus(db: SupabaseClient, visitId: string, status: "done" | "no_show" | "cancelled" | "rebook", note?: string | null): Promise<BookResult> {
  const { data: before } = await db.from("visits").select("staff_id").eq("id", visitId).maybeSingle();
  const { error } = await db.rpc("visit_set_status", { p_id: visitId, p_status: status, p_note: note ?? null });
  if (error) return friendly(error.message);
  if (status === "cancelled" || status === "rebook") {
    try { await sendVisitCancellation(db, visitId); } catch (e) { reportError(e, { where: "visits.cancelNotify", bestEffort: true }); }
  }
  try { await reconcileForVisit([before?.staff_id as string | null]); } catch (e) { reportError(e, { where: "visits.gcal", bestEffort: true }); }
  return { ok: true, visitId };
}

async function afterWrite(db: SupabaseClient, visitId: string, staffIds: Array<string | null | undefined>): Promise<void> {
  try { await sendVisitConfirmation(db, visitId); } catch (e) { reportError(e, { where: "visits.confirm", bestEffort: true }); }
  try { await reconcileForVisit(staffIds); } catch (e) { reportError(e, { where: "visits.gcal", bestEffort: true }); }
}

export async function loadVisit(db: SupabaseClient, visitId: string): Promise<VisitRow | null> {
  const { data } = await db.from("visits").select(VISIT_COLUMNS).eq("id", visitId).maybeSingle();
  return (data as VisitRow | null) ?? null;
}
