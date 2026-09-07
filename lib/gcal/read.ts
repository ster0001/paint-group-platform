// SERVER ONLY — reading a STAFF member's own Google calendars (8 Sep 2026).
//
// Tom: "The calendar says the info@paintgroup.com.au calendar is free when
// it's not — is there not a way to sync the calendar so we can see what
// appointments are in there?" Until now the app only ever wrote to the
// calendar it created (scope calendar.app.created) and could not see a
// dentist appointment typed straight into Google. Staff connections made
// from today also carry calendar.readonly; this module turns what Google
// holds into the same `Busy` shape the availability engine subtracts, so:
//   · the day plan on a record lists the Google entries as busy,
//   · the Diary shows them in the estimator's lane,
//   · the wizard never offers a window that is really taken.
//
// Best effort throughout: Google down, a revoked token, a pre-8 Sep
// connection — the read says so and the app carries on with the visits it
// knows. Contractor calendars are NOT read; that promise stands (lib/gcal/sync.ts).

import { createServiceClient } from "@/lib/supabase/service";
import { melbourneInstant } from "@/lib/time/businessHours";
import { reportError } from "@/lib/monitoring/report";
import { GcalAuthRevoked, gcalEnv, refreshAccessToken, scopesCanRead } from "./oauth";
import { GcalApiError, listCalendars, listEvents, type RawCalendar, type RawEvent } from "./client";
import { loadStaffConnection } from "./staff";

export type GoogleBusy = {
  staffId: string;
  startsAt: string;
  endsAt: string;
  /** The event's title (or "Busy" for a private one). */
  label: string;
  /** Which of their calendars it came from. */
  calendar: string;
  allDay: boolean;
};

export type GoogleReadKind = "ok" | "not_connected" | "unconfigured" | "needs_reconnect" | "error";
export type GoogleRead =
  | { kind: "ok"; busy: GoogleBusy[]; calendars: string[] }
  | { kind: "not_connected" }
  | { kind: "unconfigured" }
  /** Connected before 8 Sep (write-only scope), or Google refused the read. */
  | { kind: "needs_reconnect" }
  | { kind: "error"; message: string };

// ---- pure: which calendars, which events count as busy — unit-tested --------

/**
 * The calendars worth reading: the ones the person has ticked in Google
 * (`selected`), minus the app's own "Paint Group …" calendars — those hold
 * the visits and jobs the app already knows, and counting them twice would
 * make every booked visit look like a clash with itself.
 */
export function calendarsToRead(list: RawCalendar[], appCalendarId: string | null): RawCalendar[] {
  return list.filter((c) => {
    if (!c.id || c.hidden) return false;
    if (c.selected === false) return false;
    if (appCalendarId && c.id === appCalendarId) return false;
    if ((c.summary ?? "").startsWith("Paint Group ")) return false;
    return true;
  });
}

/** Google's own free/busy rule, in our shape: skip cancelled, "free" (transparent), declined, and place markers. */
export function busyFromEvents(staffId: string, calendar: string, events: RawEvent[]): GoogleBusy[] {
  const out: GoogleBusy[] = [];
  for (const e of events) {
    if (e.status === "cancelled") continue;
    if (e.transparency === "transparent") continue;
    if (e.eventType === "workingLocation" || e.eventType === "birthday") continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    const label = (e.summary ?? "").trim() || "Busy";
    if (e.start?.dateTime && e.end?.dateTime) {
      const s = new Date(e.start.dateTime), en = new Date(e.end.dateTime);
      if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime()) || en <= s) continue;
      out.push({ staffId, startsAt: s.toISOString(), endsAt: en.toISOString(), label, calendar, allDay: false });
    } else if (e.start?.date && e.end?.date) {
      // All-day: Melbourne midnight to midnight; Google's end date is exclusive.
      const s = dayStart(e.start.date), en = dayStart(e.end.date);
      if (!s || !en || en <= s) continue;
      out.push({ staffId, startsAt: s.toISOString(), endsAt: en.toISOString(), label, calendar, allDay: true });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function dayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? melbourneInstant(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0) : null;
}

// ---- the read, cached briefly per estimator + window ------------------------

const TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; value: GoogleRead }>();
const HOUR = 3_600_000;
const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
const ceilHour = (d: Date) => new Date(Math.ceil(d.getTime() / HOUR) * HOUR);

/** After a reconnect (new scopes) the next read must go to Google. */
export function forgetGoogleReads(staffId?: string): void {
  if (!staffId) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(`${staffId}|`)) cache.delete(k);
}

/**
 * One estimator's Google busy time between two instants. The window is
 * widened to whole hours so the wizard's every-request calls share a cache
 * entry for two minutes; callers only ever test overlap, so a superset is
 * harmless.
 */
export async function readStaffGoogleBusy(staffId: string, from: Date, to: Date): Promise<GoogleRead> {
  const lo = floorHour(from), hi = ceilHour(to);
  const key = `${staffId}|${lo.toISOString()}|${hi.toISOString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await readUncached(staffId, lo, hi);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
  return value;
}

async function readUncached(staffId: string, from: Date, to: Date): Promise<GoogleRead> {
  const admin = createServiceClient();
  if (!admin || !gcalEnv()) return { kind: "unconfigured" };
  const conn = await loadStaffConnection(admin, staffId).catch(() => null);
  if (!conn) return { kind: "not_connected" };
  if (!scopesCanRead(conn.scopes)) return { kind: "needs_reconnect" };
  try {
    const { accessToken } = await refreshAccessToken(conn.refresh_token);
    const cals = calendarsToRead(await listCalendars(accessToken), conn.calendar_id);
    const busy: GoogleBusy[] = [];
    for (const c of cals) {
      const name = c.summary || (c.primary ? conn.google_email ?? "Google" : c.id);
      busy.push(...busyFromEvents(staffId, name, await listEvents(accessToken, c.id, from, to)));
    }
    busy.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { kind: "ok", busy, calendars: cals.map((c) => c.summary || (c.primary ? conn.google_email ?? "Google" : c.id)) };
  } catch (e) {
    if (e instanceof GcalAuthRevoked) return { kind: "needs_reconnect" };
    // 403 = the token predates the wider scope or the person unticked it.
    if (e instanceof GcalApiError && e.status === 403) return { kind: "needs_reconnect" };
    reportError(e, { where: "gcal.read", bestEffort: true });
    return { kind: "error", message: e instanceof Error ? e.message : "Google Calendar read failed" };
  }
}

/**
 * Every connected estimator's Google busy time — what the availability
 * engine adds to the booked visits. Estimators without a connection (or
 * with a pre-8 Sep one) simply contribute nothing; `reads` says which.
 */
export async function readGoogleBusyForStaff(staffIds: string[], from: Date, to: Date): Promise<{ busy: GoogleBusy[]; reads: Record<string, GoogleRead> }> {
  const admin = createServiceClient();
  const reads: Record<string, GoogleRead> = {};
  if (!admin || !gcalEnv() || staffIds.length === 0) return { busy: [], reads };
  const { data } = await admin.from("staff_gcal_connections").select("staff_id").in("staff_id", staffIds);
  const connected = new Set(((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id));
  const busy: GoogleBusy[] = [];
  await Promise.all(staffIds.map(async (id) => {
    if (!connected.has(id)) { reads[id] = { kind: "not_connected" }; return; }
    const r = await readStaffGoogleBusy(id, from, to);
    reads[id] = r;
    if (r.kind === "ok") busy.push(...r.busy);
  }));
  return { busy, reads };
}
