/**
 * C15 (A4) — the tenant link: the message says who, why and "not your bond"
 * and stays inside two SMS segments; the token is long and URL-safe; expiry.
 */
import { describe, expect, it } from "vitest";
import { newTenantToken, tenantLinkExpired, tenantMessage, tenantPageIntro } from "./tenant-link";

describe("tenant link", () => {
  it("copy:new — the message names us, the agent, the address, the bond and the link", () => {
    const m = tenantMessage({ companyName: "Paint Group", agencyName: "Northcote Property Co", address: "4/22 Elm Grove, Thornbury", url: "https://x.test/photos/abc" });
    expect(m).toContain("Paint Group");
    expect(m).toContain("Northcote Property Co has asked us");
    expect(m).toContain("4/22 Elm Grove, Thornbury");
    expect(m).toMatch(/nothing to do with your bond/);
    expect(m).toContain("https://x.test/photos/abc");
    expect(m.length).toBeLessThanOrEqual(320);
  });
  it("without an agency name it still says who asked", () => {
    expect(tenantMessage({ companyName: "Paint Group", agencyName: null, address: "1 A St", url: "u" })).toContain("your property manager has asked us");
    expect(tenantPageIntro("Paint Group")).toMatch(/nothing to do with your bond/);
  });
  it("tokens are long, URL-safe and distinct", () => {
    const a = newTenantToken(); const b = newTenantToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a).not.toBe(b);
  });
  it("expiry", () => {
    const now = new Date("2026-09-13T00:00:00Z");
    expect(tenantLinkExpired("2026-09-20T00:00:00Z", now)).toBe(false);
    expect(tenantLinkExpired("2026-09-01T00:00:00Z", now)).toBe(true);
    expect(tenantLinkExpired(null, now)).toBe(true);
  });
});
