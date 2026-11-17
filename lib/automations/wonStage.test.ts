import { describe, expect, it } from "vitest";
import { morningBeforeDue } from "./dateOffset";
import { startDateWords } from "./sweeps/startReminders";
import { automationByKey } from "./registry";
import { DEFAULT_MESSAGING, renderTemplate } from "@/lib/messaging/config";

/** Won stage W2–W4 (17 Nov 2026): the start-date offsets, the wording, the switches. */
describe("W2–W4", () => {
  it("from 9 am Melbourne N days before the start, for a day", () => {
    // start Tue 24 Nov 2026 → W2 (3 days) Sat 21 Nov 09:00 (+11) = 20 Nov 22:00Z
    expect(morningBeforeDue("2026-11-24", 3, new Date("2026-11-20T21:59:00Z"))).toBe(false);
    expect(morningBeforeDue("2026-11-24", 3, new Date("2026-11-20T22:00:00Z"))).toBe(true);
    expect(morningBeforeDue("2026-11-24", 3, new Date("2026-11-21T21:59:00Z"))).toBe(true);
    expect(morningBeforeDue("2026-11-24", 3, new Date("2026-11-21T22:00:00Z"))).toBe(false);
    expect(morningBeforeDue(null, 3, new Date())).toBe(false);
  });
  it("words the start and W4's line as Appendix A does", () => {
    expect(startDateWords("2026-11-24")).toBe("Tuesday 24 November");
    const vars = { first_name: "Sarah", painter: "Marco", address: "12 Elm Grove", date: "Tuesday 24 November", brand: "Paint Group" };
    expect(renderTemplate(DEFAULT_MESSAGING.startReminderSms, vars))
      .toBe("Hi Sarah, Marco will arrive at 12 Elm Grove on Tuesday 24 November between 7:30 and 8:30 am. Updates will appear on your Paint Group page each day.");
  });
  it("all three ship off and are transactional (no marketing flag)", () => {
    for (const k of ["deposit_due", "colours_tbc", "start_reminder"]) {
      const a = automationByKey(k)!;
      expect(a).toMatchObject({ defaultOff: true, audience: "customer" });
      expect(a.consent).toBeUndefined();
      expect(a.quietExempt).toBeFalsy();
    }
  });
});
