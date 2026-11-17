import { describe, expect, it } from "vitest";
import { automationByKey } from "@/lib/automations/registry";
import { DEFAULT_MESSAGING, renderTemplate } from "@/lib/messaging/config";

/** Lead L12 (17 Nov 2026): the no-show text — Appendix A's line, shipped off, a service message (quiet hours hold it). */
describe("L12 — we missed each other", () => {
  it("ships off, a text, not marketing, held by quiet hours", () => {
    const a = automationByKey("visit_no_show")!;
    expect(a).toMatchObject({ defaultOff: true, channels: ["sms"], audience: "customer" });
    expect(a.consent).toBeUndefined();
    expect(a.quietExempt).toBeFalsy();
  });
  it("words it as Appendix A does", () => {
    expect(renderTemplate(DEFAULT_MESSAGING.visitNoShowSms, { first_name: "Sarah", address: "12 Elm Grove", link: "https://x/e/t", estimator_name: "Tom", company_name: "Paint Group" }))
      .toBe("Hi Sarah, we missed each other at 12 Elm Grove today. Rebook here: https://x/e/t — Tom, Paint Group");
  });
});
