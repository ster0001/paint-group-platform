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
