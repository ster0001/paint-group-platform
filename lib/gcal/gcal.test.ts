import { describe, expect, it } from "vitest";
import { signState, verifyState } from "./oauth";
import { toEventBody } from "./client";
import { daySpan, buildEventInput, eventHash } from "./sync";
import type { Row } from "@/lib/contractor/jobs";

// Vitest runs under TZ=Australia/Melbourne (vitest.config) — deliberately east
// of Greenwich, so any local-time slip in the date arithmetic shifts a day and
// fails here. That is the calendar bug this project has already had once.

const snapshot = (over: Record<string, unknown> = {}) => ({
  version: 1,
  jobTitle: "12 Acacia St, Oakleigh South",
  jobAddress: "12 Acacia St, Oakleigh South VIC 3167",
  contactFirstName: "Priya",
  contactPhone: "0400 000 000",
  areas: [{ surfaces: [{ hours: 10 }, { hours: 10 }] }],
  ...over,
});

const row = (over: Partial<Row> = {}): Row => ({
  id: "wo-1",
  wo_ref: "WO-TEST1",
  status: "in_progress",
  start_date: "2026-09-07",
  end_date: "2026-09-21",
  issued_at: "2026-09-01T00:00:00Z",
  viewed_at: null,
  contractor_payment_cents: 123400,
  wo_snapshot: snapshot(),
  ...over,
});

describe("daySpan", () => {
  it("counts booked days inclusively: 7–21 Sep is 15 days", () => {
    const span = daySpan({ startDate: "2026-09-07", endDate: "2026-09-21", doc: null });
    expect(span).toEqual({ startDate: "2026-09-07", days: 15 });
  });

  it("a single-day booking spans exactly one day", () => {
    const span = daySpan({ startDate: "2026-09-07", endDate: "2026-09-07", doc: null });
    expect(span).toEqual({ startDate: "2026-09-07", days: 1 });
  });

  it("falls back to estimated hours when no end date is booked (20h → 3 days)", () => {
    const doc = snapshot() as never;
    const span = daySpan({ startDate: "2026-09-07", endDate: null, doc });
    expect(span).toEqual({ startDate: "2026-09-07", days: 3 });
  });

  it("returns null without a start date", () => {
    expect(daySpan({ startDate: null, endDate: null, doc: null })).toBeNull();
  });
});

describe("toEventBody — the 07:30–15:30 site-hours rule", () => {
  it("renders each booked day as a 07:30–15:30 Melbourne block, recurring daily", () => {
    const body = toEventBody({ summary: "Job", startDate: "2026-09-07", days: 15 });
    expect(body.start).toEqual({ dateTime: "2026-09-07T07:30:00", timeZone: "Australia/Melbourne" });
    expect(body.end).toEqual({ dateTime: "2026-09-07T15:30:00", timeZone: "Australia/Melbourne" });
    expect(body.recurrence).toEqual(["RRULE:FREQ=DAILY;COUNT=15"]);
  });

  it("a one-day job carries an EMPTY recurrence so a patch can clear an old rule", () => {
    const body = toEventBody({ summary: "Job", startDate: "2026-09-07", days: 1 });
    expect(body.recurrence).toEqual([]);
  });
});

describe("buildEventInput", () => {
  it("uses the snapshot title, address and contact, and links the portal job", () => {
    const e = buildEventInput(row(), "https://example.com");
    expect(e).not.toBeNull();
    expect(e!.summary).toBe("12 Acacia St, Oakleigh South");
    expect(e!.location).toBe("12 Acacia St, Oakleigh South VIC 3167");
    expect(e!.description).toContain("WO-TEST1");
    expect(e!.description).toContain("Priya");
    expect(e!.description).toContain("https://example.com/portal/jobs/wo-1");
  });

  it("falls back to the WO ref when the snapshot is missing or unversioned", () => {
    const e = buildEventInput(row({ wo_snapshot: { jobTitle: "x" } }), null);
    expect(e!.summary).toBe("WO-TEST1");
    expect(e!.location).toBeUndefined();
  });

  it("never carries the contractor's payment anywhere in the event", () => {
    const e = buildEventInput(row(), "https://example.com");
    expect(JSON.stringify(e)).not.toContain("1234");
  });

  it("returns null for an unbooked job", () => {
    expect(buildEventInput(row({ start_date: null }), null)).toBeNull();
  });
});

describe("eventHash", () => {
  it("is stable for identical events and changes when a date moves", () => {
    const a = buildEventInput(row(), "https://example.com")!;
    const b = buildEventInput(row(), "https://example.com")!;
    const moved = buildEventInput(row({ start_date: "2026-09-08" }), "https://example.com")!;
    expect(eventHash(a)).toBe(eventHash(b));
    expect(eventHash(a)).not.toBe(eventHash(moved));
  });
});

describe("oauth state", () => {
  it("round-trips and refuses tampering", () => {
    const state = signState("secret");
    expect(verifyState("secret", state)).toBe(true);
    expect(verifyState("secret", state.slice(0, -1) + "0")).toBe(false);
    expect(verifyState("other-secret", state)).toBe(false);
    expect(verifyState("secret", null)).toBe(false);
    expect(verifyState("secret", "no-dot")).toBe(false);
  });
});
