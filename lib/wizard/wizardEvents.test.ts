import { describe, expect, it } from "vitest";
import { buildEvent, CRM_EVENT_SCHEMAS } from "@/lib/crm/events";
import { breakpointNow, MOBILE_MAX_WIDTH, WIZARD_EVENT_SCHEMAS, WIZARD_EVENT_TYPES, wizardEventBodySchema, type WizardEventType } from "./wizardEvents";

/** Wizard mobile v5, brief §8 — the events, their shapes, and the one breakpoint rule. */
describe("the wizard's events (mobile v5 §8)", () => {
  it("every browser-written type is in the one catalogue, and the catalogue accepts the route's shape (payload + the pinned session)", () => {
    for (const t of WIZARD_EVENT_TYPES) expect(t in CRM_EVENT_SCHEMAS, t).toBe(true);
    const session = "11111111-1111-4111-8111-111111111111";
    const samples: Record<WizardEventType, Record<string, unknown>> = {
      wizard_step_viewed: { step: "rooms", breakpoint: "mobile" },
      surface_toggled: { surface: "walls", on: true },
      gate_viewed: { range_low: 704_000, range_high: 986_000, bigger_job: false, breakpoint: "mobile" },
      gate_cta_clicked: { cta: "exact", breakpoint: "desktop" },
      contact_opened: { step: "beds" },
      scope_viewed: { from: "gate" },
    };
    for (const t of WIZARD_EVENT_TYPES) {
      const body = wizardEventBodySchema.safeParse({ type: t, payload: samples[t] });
      expect(body.success, t).toBe(true);
      const built = buildEvent({ type: t, source: "customer", payload: { ...samples[t], sessionId: session } });
      expect(built.p_payload.sessionId).toBe(session);
    }
  });

  it("refuses what the brief does not name: an unknown type, a stray cta, a breakpoint that is not mobile or desktop, a scope arrival that is not from the gate", () => {
    expect(wizardEventBodySchema.safeParse({ type: "wizard_abandoned", payload: {} }).success).toBe(false);
    expect(WIZARD_EVENT_SCHEMAS.gate_cta_clicked.safeParse({ cta: "tighten", breakpoint: "mobile" }).success).toBe(false);
    expect(WIZARD_EVENT_SCHEMAS.wizard_step_viewed.safeParse({ step: "rooms", breakpoint: "tablet" }).success).toBe(false);
    expect(WIZARD_EVENT_SCHEMAS.scope_viewed.safeParse({ from: "email" }).success).toBe(false);
    // the session is the server's to pin — a browser cannot name one
    expect(WIZARD_EVENT_SCHEMAS.contact_opened.safeParse({ step: "beds", sessionId: "x" }).success).toBe(true);
    expect(Object.keys(WIZARD_EVENT_SCHEMAS.contact_opened.parse({ step: "beds", sessionId: "x" }))).toEqual(["step"]);
  });

  it("visit_booked carries where it came from, so contact → booked can be rated", () => {
    const built = buildEvent({ type: "visit_booked", payload: { when: "Thu 30 Oct, 9:00 am", step: "beds", from: "contact" } });
    expect(built.p_payload).toMatchObject({ step: "beds", from: "contact" });
    expect(() => buildEvent({ type: "visit_booked", payload: { when: "x", from: "email" } })).toThrow(/visit_booked/);
  });

  it("the breakpoint is the brief's: mobile under 768px, desktop from it; a server render is desktop", () => {
    expect(MOBILE_MAX_WIDTH).toBe(767);
    expect(breakpointNow(390)).toBe("mobile");
    expect(breakpointNow(767)).toBe("mobile");
    expect(breakpointNow(768)).toBe("desktop");
    expect(breakpointNow(1470)).toBe("desktop");
    expect(breakpointNow(null)).toBe("desktop");
  });
});
