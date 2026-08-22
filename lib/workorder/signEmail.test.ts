import { describe, expect, it } from "vitest";
import { shouldSendSignEmail, signedReportEmail } from "./signEmail";

describe("⚑10 — when the signed report emails", () => {
  it("defaults ON when the setting is absent", () => {
    expect(shouldSendSignEmail(null, "on_device")).toBe(true);
    expect(shouldSendSignEmail({}, "remote")).toBe(true);
  });

  it("respects an explicit off", () => {
    expect(shouldSendSignEmail({ walkthrough: { signEmailImmediate: false } }, "on_device")).toBe(false);
  });

  it("never emails a deemed sign-off — that is the nudge ladder's lane", () => {
    expect(shouldSendSignEmail({ walkthrough: { signEmailImmediate: true } }, "deemed")).toBe(false);
  });
});

describe("the email itself", () => {
  const msg = signedReportEmail({
    firstName: "Priya", jobTitle: "14 Bellair St", signedName: "Priya Sharma",
    link: "https://example.com/s/abc", company: "Paint Group",
  });

  it("links to their own record rather than attaching a copy to drift", () => {
    expect(msg.html).toContain("https://example.com/s/abc");
    expect(msg.subject).toContain("14 Bellair St");
  });

  it("mentions the warranty in plain words", () => {
    expect(msg.html).toMatch(/two-year warranty/);
  });
});
