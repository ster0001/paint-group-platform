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

/**
 * An all-day event block. Google's all-day `end.date` is EXCLUSIVE — a job
 * running 7–21 Sep is sent with end 22 Sep. lib/gcal/sync.ts owns that rule
 * (and its test); this layer sends exactly what it's given.
 */
export type GcalEventInput = {
  summary: string;
  location?: string;
  description?: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDateExclusive: string; // YYYY-MM-DD exclusive
};

function toEventBody(e: GcalEventInput) {
  return {
    summary: e.summary,
    location: e.location,
    description: e.description,
    start: { date: e.startDate },
    end: { date: e.endDateExclusive },
    // Reminders would fire at midnight for all-day events — off by default;
    // the painter can set their own on the calendar.
    reminders: { useDefault: false },
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
  await call(
    accessToken,
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    toEventBody(event),
  );
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
