import { describe, expect, it } from "vitest";
import { sessionPooledUrl } from "./session-pooled-url";
// The plain-JS twin the SWEEP uses: `node scripts/c1/hygiene.mjs` cannot import
// a .ts module, and both must contend on the same connection or the lock
// excludes nobody. Pinned equal below.
import { E2E_RUN_LOCK_KEY as MJS_KEY, sessionPooledUrl as mjsSessionPooledUrl } from "../../scripts/c1/session-url.mjs";
import { E2E_RUN_LOCK_KEY } from "../../e2e/run-lock";

describe("the connection the e2e run lock takes its lock on", () => {
  it("moves the transaction pooler (:6543) to the session pooler (:5432)", () => {
    expect(sessionPooledUrl("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"))
      .toBe("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres");
  });
  it("leaves a session-pooled or direct connection alone", () => {
    for (const url of [
      "postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
      "postgresql://u:p@db.example.supabase.co:5432/postgres",
    ]) expect(sessionPooledUrl(url)).toBe(url);
  });
  it("hands anything it cannot parse straight to pg rather than mangling it", () => {
    expect(sessionPooledUrl("not a url")).toBe("not a url");
  });

  /**
   * Two implementations exist only because one caller is TypeScript
   * (e2e/run-lock.ts) and the other is a plain .mjs script (the sweep). If they
   * ever disagree the sweep would lock a different connection — or a different
   * key — from the run it is meant to stand aside for, and the lock would
   * quietly stop excluding anyone. That failure is invisible until two runs
   * delete each other's rows, so it is pinned here instead.
   */
  it("agrees with the plain-JS twin the sweep uses, on every case", () => {
    for (const url of [
      "postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
      "postgresql://u:p@db.example.supabase.co:5432/postgres",
      "postgres://user:pass@host:6543/db?sslmode=require",
      "not a url",
      "",
    ]) expect(mjsSessionPooledUrl(url), url).toBe(sessionPooledUrl(url));
  });

  it("contends on the same lock key as the sweep", () => {
    expect(MJS_KEY).toBe(E2E_RUN_LOCK_KEY);
  });
});
