import { describe, expect, it } from "vitest";
import { buildPrimaryVisitEvent, buildTravelEvent, classifyGoogleEvent, slotEndOf } from "./visitEvents";

const visit = {
  id: "11111111-1111-4111-8111-111111111111", starts_at: "2026-10-12T03:00:00.000Z", ends_at: "2026-10-12T04:00:00.000Z",
  address: "12 Sample St, Glen Waverley VIC 3150", suburb: "Glen Waverley", customer_name: "Alex Morgan", customer_phone: "+61412345678",
  note: null, estimate_id: "22222222-2222-4222-8222-222222222222", account_id: null,
};

describe("S5 — the visit in the main calendar (R21, R32)", () => {
  it("is one hour, at the property, with the customer as a guest and a popup for the estimator only", () => {
    const e = buildPrimaryVisitEvent(visit, { email: "alex@example.com", name: "Alex Morgan" }, "https://login.paintgroup.com.au");
    expect(e.summary).toBe("Paint Group site visit — 12 Sample St, Glen Waverley VIC 3150");
    expect(String(e.description)).toContain("Alex Morgan");
    expect(e.location).toBe(visit.address);
    expect(e.start).toEqual({ dateTime: visit.starts_at, timeZone: "Australia/Melbourne" });
    expect(e.end).toEqual({ dateTime: visit.ends_at, timeZone: "Australia/Melbourne" });
    expect(e.attendees).toEqual([{ email: "alex@example.com", displayName: "Alex Morgan" }]);
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 60 }] });
    expect(e.extendedProperties).toEqual({ private: { pgKind: "visit", pgVisitId: visit.id } });
    expect(String(e.description)).toContain("/quote?id=22222222-2222-4222-8222-222222222222");
    expect(e.guestsCanSeeOtherGuests).toBe(false);
  });
  it("the travel block follows the visit for the rest of the 90 minutes, with no guests", () => {
    const end = slotEndOf(visit.starts_at, 90);
    expect(end).toBe("2026-10-12T04:30:00.000Z");
    const t = buildTravelEvent(visit, end);
    expect(t.summary).toBe("Travel from Glen Waverley");
    expect(t.start).toEqual({ dateTime: visit.ends_at, timeZone: "Australia/Melbourne" });
    expect(t.end).toEqual({ dateTime: end, timeZone: "Australia/Melbourne" });
    expect(t.attendees).toEqual([]);
    expect(t.extendedProperties).toEqual({ private: { pgKind: "travel", pgVisitId: visit.id } });
  });
});

describe("S5 — what Google says about our event (R22, R27)", () => {
  const start = visit.starts_at;
  it("gone when deleted or cancelled", () => {
    expect(classifyGoogleEvent(null, start, "alex@example.com")).toEqual({ kind: "gone" });
    expect(classifyGoogleEvent({ status: "cancelled" }, start, "alex@example.com")).toEqual({ kind: "gone" });
  });
  it("declined only when the customer's own reply is declined", () => {
    const ev = { status: "confirmed", start: { dateTime: "2026-10-12T14:00:00+11:00" }, attendees: [{ self: true, responseStatus: "accepted" }, { email: "Alex@example.com", responseStatus: "declined" }] };
    expect(classifyGoogleEvent(ev, start, "alex@example.com")).toEqual({ kind: "declined" });
    const other = { ...ev, attendees: [{ email: "someone@example.com", responseStatus: "declined" }, { email: "alex@example.com", responseStatus: "needsAction" }] };
    expect(classifyGoogleEvent(other, start, "alex@example.com").kind).toBe("same");
  });
  it("moved when the start differs by a minute or more; same otherwise", () => {
    expect(classifyGoogleEvent({ status: "confirmed", start: { dateTime: "2026-10-12T15:00:00+11:00" } }, start, null)).toEqual({ kind: "moved", googleStart: "2026-10-12T04:00:00.000Z" });
    expect(classifyGoogleEvent({ status: "confirmed", start: { dateTime: "2026-10-12T14:00:30+11:00" } }, start, null).kind).toBe("same");
  });
});
