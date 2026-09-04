import { test, expect } from "vitest";
import { CONSENT_MAX_AGE_S, consentCookie, newVisitorId, parseConsent, readCookie, VISITOR_ID_RE } from "./consent";

test("the choice round-trips through a first-party cookie for 12 months", () => {
  const c = consentCookie("essential");
  expect(c).toContain("pg_consent=essential");
  expect(c).toContain(`Max-Age=${CONSENT_MAX_AGE_S}`);
  expect(CONSENT_MAX_AGE_S).toBe(31_536_000);
  expect(c).toContain("SameSite=Lax");
  expect(c).toContain("Secure");
  expect(parseConsent("a=1; pg_consent=analytics; b=2")).toBe("analytics");
  expect(parseConsent("pg_consent=essential")).toBe("essential");
});

test("anything else means no choice yet", () => {
  expect(parseConsent(null)).toBeNull();
  expect(parseConsent("")).toBeNull();
  expect(parseConsent("pg_consent=yes")).toBeNull();
  expect(readCookie("x=1; y=2", "z")).toBeNull();
});

test("visitor ids are random, url-safe and bounded", () => {
  const id = newVisitorId(() => "8b6b0b0e-0d5e-4c4a-9c3e-4a9f2e3b1c11");
  expect(id).toBe("8b6b0b0e0d5e4c4a9c3e4a9f2e3b1c11");
  expect(VISITOR_ID_RE.test(id)).toBe(true);
  expect(VISITOR_ID_RE.test("no spaces here")).toBe(false);
});
