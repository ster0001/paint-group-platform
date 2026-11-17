import { describe, expect, it } from "vitest";
import { brandWordingFrom, forBrand } from "./brandWording";
import { DEFAULT_MESSAGING } from "./config";

/** A‑B (17 Nov 2026): Paint Home's own wording laid over the Paint Group wording, one field at a time. */
describe("brand wording", () => {
  const wording = brandWordingFrom([
    { brand: "painthome", field: "leadRangeReminderSms", body: "PH: {{first_name}}, here's your range {{link}}" },
    { brand: "painthome", field: "leadRangeNudgeBody", body: "   " },
    { brand: "painthome", field: "quietHours", body: "nope" },
  ]);
  it("Paint Home reads its own text; Paint Group is untouched", () => {
    expect(forBrand(DEFAULT_MESSAGING, wording, "painthome").leadRangeReminderSms).toBe("PH: {{first_name}}, here's your range {{link}}");
    expect(forBrand(DEFAULT_MESSAGING, wording, "paintgroup")).toBe(DEFAULT_MESSAGING);
  });
  it("a blank row or a non-text field never overrides", () => {
    const ph = forBrand(DEFAULT_MESSAGING, wording, "painthome");
    expect(ph.leadRangeNudgeBody).toBe(DEFAULT_MESSAGING.leadRangeNudgeBody);
    expect(ph.quietHours).toEqual(DEFAULT_MESSAGING.quietHours);
  });
});
