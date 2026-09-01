import { describe, it, expect } from "vitest";
import { buildIcs, icsEscape } from "./ics";

const base = {
  uid: "walkthrough-final-abc@paintgroup",
  sequence: 2,
  method: "REQUEST" as const,
  summary: "Final walk through — (Margaret Attwood x Josef)",
  location: "12 Beech Rise, Ormond",
  date: "2026-09-12",
  time: "15:30" as string | null,
  organizerEmail: "email@paintgroup.com.au",
  organizerName: "Paint Group",
  attendeeEmail: "customer@example.com",
  attendeeName: "Margaret Attwood",
  now: new Date("2026-09-01T04:00:00Z"),
};

describe("buildIcs", () => {
  it("renders a timed Melbourne event with a stable UID and climbing sequence", () => {
    const ics = buildIcs(base);
    expect(ics).toContain("UID:walkthrough-final-abc@paintgroup");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART;TZID=Australia/Melbourne:20260912T153000");
    expect(ics).toContain("DTEND;TZID=Australia/Melbourne:20260912T163000");
    expect(ics).toContain("STATUS:CONFIRMED");
    // RFC 5545 wants CRLF line endings.
    expect(ics).toContain("\r\n");
  });

  it("renders all-day with an EXCLUSIVE end when no time was agreed", () => {
    const ics = buildIcs({ ...base, time: null });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260912");
    expect(ics).toContain("DTEND;VALUE=DATE:20260913");
  });

  it("a timed event crossing midnight lands on the next date", () => {
    const ics = buildIcs({ ...base, time: "23:45" });
    expect(ics).toContain("DTSTART;TZID=Australia/Melbourne:20260912T234500");
    expect(ics).toContain("DTEND;TZID=Australia/Melbourne:20260913T004500");
  });

  it("CANCEL carries the cancelled status", () => {
    const ics = buildIcs({ ...base, method: "CANCEL" });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("escapes calendar-special text", () => {
    expect(icsEscape("a,b;c\nd")).toBe("a\\,b\\;c\\nd");
    const ics = buildIcs({ ...base, summary: "Walk, sign; done" });
    expect(ics).toContain("SUMMARY:Walk\\, sign\\; done");
  });
});
