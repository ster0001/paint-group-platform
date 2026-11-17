import { describe, expect, it } from "vitest";
import { REQUEST_ALERT_TYPES, dueWords, requestAlertKey, requestAlertRoute } from "./requestAlertRules";
import { STAFF_EVENT_KEYS, byHoursEvent } from "./notifyEvents";
import { automationByKey } from "@/lib/automations/registry";

/**
 * Lead L9 / L10 / L13 (R4, 17 Nov 2026): which request is which alert, and the
 * office-hours switch — in hours by email (and the pop-up), out of hours the
 * text as well. The brief's golden cases: Tuesday 14:00 in, 21:00 out, and a
 * holiday out.
 */
describe("request alerts (L9 / L10 / L13)", () => {
  it("each request event is its alert", () => {
    expect(requestAlertKey("wizard_help_requested", {})).toBe("office_lead_help");
    expect(requestAlertKey("wizard_question_asked", {})).toBe("office_lead_help");
    expect(requestAlertKey("visit_request_made", { kind: "time" })).toBe("office_visit_request");
    expect(requestAlertKey("visit_request_made", { kind: "visit" })).toBe("office_visit_request");
    expect(requestAlertKey("visit_request_made", { kind: "call" })).toBe("office_call_request");
    expect(requestAlertKey("callback_requested", {})).toBe("office_call_request");
    expect(requestAlertKey("message_out", {})).toBeNull();
  });
  it("every request type is an alert, and nothing else is", () => {
    for (const t of REQUEST_ALERT_TYPES) expect(requestAlertKey(t, {})).not.toBeNull();
  });
  it("R4: Tuesday 14:00 in hours by email; 21:00, Sunday and a holiday out of hours by email and text", () => {
    const none = new Set<string>();
    // Tue 17 Nov 2026, Melbourne +11.
    expect(requestAlertRoute(new Date("2026-11-17T03:00:00Z"), none)).toEqual({ inHours: true, channels: ["email"] }); // 14:00
    expect(requestAlertRoute(new Date("2026-11-17T10:00:00Z"), none)).toEqual({ inHours: false, channels: ["email", "sms"] }); // 21:00
    expect(requestAlertRoute(new Date("2026-11-21T23:00:00Z"), none).inHours).toBe(false); // Sun 22 Nov 10:00
    expect(requestAlertRoute(new Date("2026-11-16T21:00:00Z"), none).inHours).toBe(true); // Tue 08:00, the first minute
    expect(requestAlertRoute(new Date("2026-11-17T06:00:00Z"), none).inHours).toBe(false); // Tue 17:00, closed
    expect(requestAlertRoute(new Date("2026-11-17T03:00:00Z"), new Set(["2026-11-17"])).inHours).toBe(false); // a holiday Tuesday
  });
  it("words a reply-by in Melbourne time", () => {
    expect(dueWords("2026-11-18T06:00:00Z")).toMatch(/Wed,? 18 Nov,? 5:00\s?pm/);
  });
  it("the three alerts are hours-routed staff events, shipped off, with the after-hours text", () => {
    for (const k of ["office_lead_help", "office_visit_request", "office_call_request"] as const) {
      expect(STAFF_EVENT_KEYS).toContain(k);
      expect(byHoursEvent(k)).toBe(true);
      expect(automationByKey(k)).toMatchObject({ audience: "office", defaultOff: true, quietExempt: true, channels: ["email", "sms"] });
    }
    expect(byHoursEvent("office_invoice_paid")).toBe(false);
  });
});
