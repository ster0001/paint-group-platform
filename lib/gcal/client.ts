// SERVER ONLY — thin REST wrapper over the Google Calendar v3 API.
// No SDK, same convention as the Twilio/Resend integrations: plain fetch,
// plain errors. Every call takes a fresh access token minted by the caller.

const API = "https://www.googleapis.com/calendar/v3";

export class GcalApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GcalApiError";
  }
}

async function call<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new GcalApiError(res.status, `gcal api ${method} ${path}: ${res.status} ${json.error?.message ?? ""}`.trim());
  }
  return json;
}

// Site hours (Tom, 27 Aug): every booked day is one 07:30–15:30 block, in
// Melbourne time so daylight saving never shifts a start.
export const GCAL_TIMEZONE = "Australia/Melbourne";
export const GCAL_DAY_START = "07:30:00";
export const GCAL_DAY_END = "15:30:00";

/**
 * A booking: `days` consecutive 07:30–15:30 blocks starting on `startDate`.
 * Multi-day jobs ride one recurring event (RRULE COUNT=days) rather than a
 * single banner spanning nights.
 */
export type GcalEventInput = {
  summary: string;
  location?: string;
  description?: string;
  startDate: string; // YYYY-MM-DD, first booked day
  days: number; // >= 1
};

/** Exported for gcal.test.ts — the recurrence rule is worth pinning. */
export function toEventBody(e: GcalEventInput) {
  return {
    summary: e.summary,
    location: e.location,
    description: e.description,
    start: { dateTime: `${e.startDate}T${GCAL_DAY_START}`, timeZone: GCAL_TIMEZONE },
    end: { dateTime: `${e.startDate}T${GCAL_DAY_END}`, timeZone: GCAL_TIMEZONE },
    // Always present so a PATCH can shrink a multi-day booking back to one day.
    recurrence: e.days > 1 ? [`RRULE:FREQ=DAILY;COUNT=${e.days}`] : [],
    // Reminders deliberately not set: the painter's own calendar defaults apply.
  };
}

export async function createCalendar(accessToken: string, summary: string): Promise<string> {
  const res = await call<{ id: string }>(accessToken, "POST", "/calendars", { summary });
  return res.id;
}

/** Does the calendar still exist? (The contractor may have deleted it by hand.) */
export async function calendarExists(accessToken: string, calendarId: string): Promise<boolean> {
  try {
    await call(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
    return true;
  } catch (e) {
    if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) return false;
    throw e;
  }
}

export async function insertEvent(accessToken: string, calendarId: string, event: GcalEventInput): Promise<string> {
  const res = await call<{ id: string }>(
    accessToken,
    "POST",
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    toEventBody(event),
  );
  return res.id;
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GcalEventInput,
): Promise<void> {
  const body = toEventBody(event);
  await call(accessToken, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    ...body,
    // PATCH merges: an event that was all-day keeps its `date` unless it is
    // explicitly nulled, and date + dateTime together is "Invalid start time".
    start: { ...body.start, date: null },
    end: { ...body.end, date: null },
  });
}

/** Tolerates already-gone events — deleting twice is success, not failure. */
export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await call(accessToken, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  } catch (e) {
    if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// P6 — timed events (estimator visits). A visit is a real start and end, not
// a day block; same calendar, same client, its own body shape.
// ---------------------------------------------------------------------------

export type GcalTimedEventInput = {
  summary: string;
  location?: string;
  description?: string;
  /** Instants (ISO). Google shows them in the calendar's own zone. */
  startsAt: string;
  endsAt: string;
};

export function toTimedEventBody(e: GcalTimedEventInput) {
  return {
    summary: e.summary,
    location: e.location,
    description: e.description,
    start: { dateTime: e.startsAt, timeZone: GCAL_TIMEZONE },
    end: { dateTime: e.endsAt, timeZone: GCAL_TIMEZONE },
    recurrence: [],
  };
}

export async function insertTimedEvent(accessToken: string, calendarId: string, event: GcalTimedEventInput): Promise<string> {
  const res = await call<{ id: string }>(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, toTimedEventBody(event));
  return res.id;
}

export async function patchTimedEvent(accessToken: string, calendarId: string, eventId: string, event: GcalTimedEventInput): Promise<void> {
  const body = toTimedEventBody(event);
  await call(accessToken, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    ...body,
    start: { ...body.start, date: null },
    end: { ...body.end, date: null },
  });
}

// ---- reading (staff only, scope calendar.readonly — 8 Sep) ------------------

export type RawCalendar = { id: string; summary?: string; primary?: boolean; selected?: boolean; hidden?: boolean; accessRole?: string };
export type RawEvent = {
  id?: string; status?: string; summary?: string; transparency?: string; eventType?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; email?: string; responseStatus?: string }>;
  /** S5: our own events carry pgKind (visit | travel) and pgVisitId, so a read never counts them as busy. */
  extendedProperties?: { private?: Record<string, string> };
};

export const PG_EVENT_KIND = "pgKind";
export const PG_VISIT_ID = "pgVisitId";

/** Every calendar the account can see (their own, and ones shared with them). */
export async function listCalendars(accessToken: string): Promise<RawCalendar[]> {
  const q = new URLSearchParams({ minAccessRole: "reader", showHidden: "false", maxResults: "100",
    fields: "items(id,summary,primary,selected,hidden,accessRole)" });
  const r = await call<{ items?: RawCalendar[] }>(accessToken, "GET", `/users/me/calendarList?${q}`);
  return r.items ?? [];
}

/** The events in one calendar between two instants, recurrences expanded. */
export async function listEvents(accessToken: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<RawEvent[]> {
  const q = new URLSearchParams({
    singleEvents: "true", orderBy: "startTime", maxResults: "250",
    timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
    fields: "items(id,status,summary,transparency,eventType,start,end,attendees(self,email,responseStatus),extendedProperties)",
  });
  const r = await call<{ items?: RawEvent[] }>(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return r.items ?? [];
}

// ---- S5: events in the estimator's own calendar, with guests ---------------------

export type SendUpdates = "all" | "externalOnly" | "none";

/** Any Google event body — the S5 builders (lib/gcal/visitEvents.ts) shape it; this just sends it. */
export async function insertEventBody(accessToken: string, calendarId: string, body: Record<string, unknown>, sendUpdates: SendUpdates): Promise<{ id: string }> {
  return call<{ id: string }>(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`, body);
}

export async function patchEventBody(accessToken: string, calendarId: string, eventId: string, body: Record<string, unknown>, sendUpdates: SendUpdates): Promise<void> {
  await call(accessToken, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`, body);
}

/** Delete, telling the guests when asked; already-gone is success. */
export async function deleteEventNotify(accessToken: string, calendarId: string, eventId: string, sendUpdates: SendUpdates): Promise<void> {
  try {
    await call(accessToken, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`);
  } catch (e) {
    if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

/** One event as Google holds it now — null when it is gone. Status "cancelled" means deleted by the owner. */
export async function getEvent(accessToken: string, calendarId: string, eventId: string): Promise<RawEvent | null> {
  try {
    return await call<RawEvent>(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=id,status,summary,start,end,attendees(self,email,responseStatus),extendedProperties`);
  } catch (e) {
    if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

export type WatchChannel = { id: string; resourceId: string; expiration: number };

/** Push notifications for a calendar's events (4.6). `address` must be HTTPS with a valid certificate. */
export async function watchEvents(accessToken: string, calendarId: string, input: { id: string; address: string; token: string; expirationMs: number }): Promise<WatchChannel> {
  const r = await call<{ id: string; resourceId: string; expiration?: string }>(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
    id: input.id, type: "web_hook", address: input.address, token: input.token, expiration: String(input.expirationMs),
  });
  return { id: r.id, resourceId: r.resourceId, expiration: Number(r.expiration ?? input.expirationMs) };
}

/** Stop a channel; a channel already gone is fine. */
export async function stopChannel(accessToken: string, id: string, resourceId: string): Promise<void> {
  try {
    await call(accessToken, "POST", "/channels/stop", { id, resourceId });
  } catch (e) {
    if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}
