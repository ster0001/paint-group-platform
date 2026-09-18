import { beforeEach, describe, expect, it } from "vitest";
import { _resetTokenRouteLimit, allowTokenRoute, clientIpFromHeaders, isTokenRoutePath, TOKEN_ROUTE_LIMIT } from "./tokenRouteLimit";

describe("isTokenRoutePath", () => {
  it("matches every public token door", () => {
    for (const p of ["/e/abc", "/w/abc", "/crew/abc", "/s/abc", "/v/abc", "/a/abc", "/i/abc/checkout", "/u/abc", "/join/abc", "/photos/abc", "/api/tenant/abc"]) {
      expect(isTokenRoutePath(p), p).toBe(true);
    }
  });
  it("leaves everything else alone", () => {
    for (const p of ["/", "/login", "/e", "/estimates/123", "/api/tenant", "/api/wizard/submit", "/account/properties/x", "/crm/today", "/settings"]) {
      expect(isTokenRoutePath(p), p).toBe(false);
    }
  });
});

describe("allowTokenRoute", () => {
  beforeEach(() => _resetTokenRouteLimit());

  it("lets a visitor through up to the limit, then answers no until the window turns", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < TOKEN_ROUTE_LIMIT; i++) expect(allowTokenRoute("1.2.3.4", t0)).toBe(true);
    expect(allowTokenRoute("1.2.3.4", t0)).toBe(false);
    expect(allowTokenRoute("1.2.3.4", t0 + 59_000)).toBe(false);
    expect(allowTokenRoute("1.2.3.4", t0 + 60_000)).toBe(true);
  });

  it("budgets per address — one scanner does not lock out the next customer", () => {
    const t0 = 1_000_000;
    for (let i = 0; i <= TOKEN_ROUTE_LIMIT; i++) allowTokenRoute("9.9.9.9", t0);
    expect(allowTokenRoute("9.9.9.9", t0)).toBe(false);
    expect(allowTokenRoute("1.2.3.4", t0)).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the first forwarded hop, then x-real-ip, then unknown", () => {
    expect(clientIpFromHeaders((n) => (n === "x-forwarded-for" ? "5.5.5.5, 10.0.0.1" : null))).toBe("5.5.5.5");
    expect(clientIpFromHeaders((n) => (n === "x-real-ip" ? "6.6.6.6" : null))).toBe("6.6.6.6");
    expect(clientIpFromHeaders(() => null)).toBe("unknown");
  });
});
