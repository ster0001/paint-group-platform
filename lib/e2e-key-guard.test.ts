import { describe, expect, test } from "vitest";
import { assertKeysMatchTarget, keyClaims, urlProjectRef } from "../e2e/global-setup";

/**
 * THE KEY MUST BELONG TO THE PROJECT THE URL NAMES.
 *
 * CI run #371 (11 Sep 2026): nine secrets present, the URL secret naming the
 * test project, and the service-role secret pasted from somewhere else. Every
 * service call answered `Invalid API key`; `/estimate` reads `wizard_public`
 * through the service client, so it served the holding page; 83 specs failed
 * at a uniform 20 s and the whole thing read as a feature flag. A presence
 * check cannot see this. A claims check can, in one second, by name.
 */
const jwt = (claims: Record<string, unknown>) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`;
};
const REF_A = "abcdefghijklmnopqrst";
const REF_B = "tsrqponmlkjihgfedcba";

describe("keyClaims", () => {
  test("reads ref and role from a legacy key", () => {
    expect(keyClaims(jwt({ ref: REF_A, role: "anon" }))).toEqual({ ref: REF_A, role: "anon" });
  });
  test("a non-JWT key (sb_secret_…) yields null — nothing to prove, nothing refused", () => {
    expect(keyClaims("sb_secret_abc123")).toBeNull();
    expect(keyClaims("")).toBeNull();
    expect(keyClaims("a.b.c")).toBeNull();
  });
});

describe("urlProjectRef", () => {
  test("parses the ref out of a Supabase URL", () => {
    expect(urlProjectRef(`https://${REF_A}.supabase.co`)).toBe(REF_A);
    expect(urlProjectRef(`https://${REF_A}.supabase.co/rest/v1`)).toBe(REF_A);
  });
  test("a custom domain hides it", () => {
    expect(urlProjectRef("https://db.paintgroup.com.au")).toBeNull();
    expect(urlProjectRef("")).toBeNull();
  });
});

describe("assertKeysMatchTarget", () => {
  const url = `https://${REF_A}.supabase.co`;
  test("matching keys pass", () => {
    expect(() => assertKeysMatchTarget({
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF_A, role: "anon" }),
      SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF_A, role: "service_role" }),
    })).not.toThrow();
  });
  test("the #371 shape: URL and anon key name one project, the service key another — refused BY NAME", () => {
    expect(() => assertKeysMatchTarget({
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF_A, role: "anon" }),
      SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF_B, role: "service_role" }),
    })).toThrow(new RegExp(`REFUSED: SUPABASE_SERVICE_ROLE_KEY belongs to project ${REF_B}[\\s\\S]*names ${REF_A}`));
  });
  test("swapped keys are refused", () => {
    expect(() => assertKeysMatchTarget({
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF_A, role: "service_role" }),
    })).toThrow(/REFUSED: NEXT_PUBLIC_SUPABASE_ANON_KEY carries role "service_role"/);
  });
  test("an unset key is not this check's business", () => {
    expect(() => assertKeysMatchTarget({ NEXT_PUBLIC_SUPABASE_URL: url })).not.toThrow();
  });
  test("a URL with no readable ref is refused — the guard never guesses", () => {
    expect(() => assertKeysMatchTarget({ NEXT_PUBLIC_SUPABASE_URL: "https://db.example.com" })).toThrow(/REFUSED: cannot read a project ref/);
  });
});
