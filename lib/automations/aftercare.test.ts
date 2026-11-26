import { describe, expect, it } from "vitest";
import { monthsAfter, reviewLinkFor } from "./sweeps/aftercare";
import { morningBeforeDue } from "./dateOffset";
import { automationByKey } from "./registry";
import { DEFAULT_MESSAGING } from "@/lib/messaging/config";

/** After the job R1, R3, R4 (17 Nov 2026). */
describe("R1 / R3 / R4", () => {
  it("R1 is due from 9 am the day after sign-off, for a day", () => {
    // signed off Mon 16 Nov → Tue 17 Nov 09:00 (+11) = 16 Nov 22:00Z
    expect(morningBeforeDue("2026-11-16", -1, new Date("2026-11-16T21:59:00Z"))).toBe(false);
    expect(morningBeforeDue("2026-11-16", -1, new Date("2026-11-16T22:00:00Z"))).toBe(true);
    expect(morningBeforeDue("2026-11-16", -1, new Date("2026-11-17T22:00:00Z"))).toBe(false);
  });
  it("the anniversaries land on the same day of the month, clamped", () => {
    expect(monthsAfter("2025-11-17", 12)).toBe("2026-11-17");
    expect(monthsAfter("2024-02-29", 12)).toBe("2025-02-28");
    expect(monthsAfter("2026-11-17", -24)).toBe("2024-11-17");
    expect(monthsAfter("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("R1 needs the brand's review link — none set, nothing sends", () => {
    expect(reviewLinkFor(DEFAULT_MESSAGING, "paintgroup")).toBeNull();
    expect(reviewLinkFor({ ...DEFAULT_MESSAGING, googleReviewLink: "https://g.page/r/abc" }, "paintgroup")).toBe("https://g.page/r/abc");
    expect(reviewLinkFor({ ...DEFAULT_MESSAGING, googleReviewLink: "https://g.page/r/abc" }, "painthome")).toBeNull();
    expect(reviewLinkFor({ ...DEFAULT_MESSAGING, googleReviewLink: "g.page/r/abc" }, "paintgroup")).toBeNull();
  });
  it("R1 is a real text, off by default; R1, R3 and R4 are marketing (R1 since 26 Nov 2026: a review ask is commercial)", () => {
    expect(automationByKey("review_request")).toMatchObject({ kind: "automatic", channels: ["sms"], defaultOff: true, consent: "marketing" });
    for (const k of ["anniversary_12", "anniversary_24"]) expect(automationByKey(k)).toMatchObject({ defaultOff: true, consent: "marketing" });
  });
});
