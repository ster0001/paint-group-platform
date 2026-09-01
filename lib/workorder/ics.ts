/**
 * Minimal iCalendar builder for the final-walkthrough invites (Tom, 1 Sep).
 *
 * Pure — no clock, no DB. One VEVENT per file, METHOD REQUEST to book/move,
 * METHOD CANCEL to pull it. The UID is stable per (job, kind) and SEQUENCE
 * climbs on every send, which is what lets Google/Outlook treat a resend as
 * an EDIT of the existing calendar entry rather than a new one.
 *
 * Times are Melbourne wall-clock via TZID (the big clients resolve Olson ids
 * without a VTIMEZONE block); a walkthrough with no agreed time goes out as
 * an all-day entry rather than inventing one.
 */

export type IcsEvent = {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  summary: string;
  description?: string;
  location?: string;
  /** Plain calendar date, YYYY-MM-DD. */
  date: string;
  /** HH:MM Melbourne wall time, or null for an all-day entry. */
  time: string | null;
  durationMinutes?: number;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
  /** Composition instant, passed in so this stays pure. */
  now: Date;
};

const TZID = "Australia/Melbourne";

/** RFC 5545 text escaping: backslash, semicolon, comma, newline. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");

// Not the banned UTC-bucketing idiom: these dates are Z-ANCHORED wall-clock
// values we constructed ourselves, so UTC parts read back exactly what went in.
const two = (n: number) => String(n).padStart(2, "0");
const utcDateStr = (d: Date) => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  // Pure wall-clock arithmetic — DST never shifts a wall time plus an hour
  // inside the same afternoon. Parse as UTC so the host TZ can't leak in.
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return {
    date: utcDateStr(d),
    time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`,
  };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcDateStr(d);
}

export function buildIcs(e: IcsEvent): string {
  const stamp = e.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Paint Group//Platform//EN",
    "VERSION:2.0",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${icsEscape(e.uid)}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${icsEscape(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.time) {
    const end = addMinutes(e.date, e.time, e.durationMinutes ?? 60);
    lines.push(
      `DTSTART;TZID=${TZID}:${compactDate(e.date)}T${e.time.replace(":", "")}00`,
      `DTEND;TZID=${TZID}:${compactDate(end.date)}T${end.time.replace(":", "")}00`,
    );
  } else {
    // All-day: DTEND is EXCLUSIVE (the gcal sync learned this the hard way).
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`,
    );
  }
  lines.push(
    `ORGANIZER;CN=${icsEscape(e.organizerName)}:mailto:${e.organizerEmail}`,
    `ATTENDEE;CN=${icsEscape(e.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${e.attendeeEmail}`,
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.join("\r\n") + "\r\n";
}
