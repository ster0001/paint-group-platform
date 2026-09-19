import { describe, expect, it } from "vitest";
import { LOCK_NAME_PREFIX, describeLockHolder, lockHolderName, sessionPooledUrl } from "./session-pooled-url";
// The plain-JS twin the SWEEP uses: `node scripts/c1/hygiene.mjs` cannot import
// a .ts module, and both must contend on the same connection or the lock
// excludes nobody. Pinned equal below.
import {
  E2E_RUN_LOCK_KEY as MJS_KEY,
  LOCK_HOLDER_QUERY as MJS_HOLDER_QUERY,
  describeLockHolder as mjsDescribeLockHolder,
  lockHolderName as mjsLockHolderName,
  sessionPooledUrl as mjsSessionPooledUrl,
} from "../../scripts/c1/session-url.mjs";
import { E2E_RUN_LOCK_KEY } from "../../e2e/run-lock";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_HOLDER_QUERY } from "./session-pooled-url";

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

/**
 * Three things can hold this lock — a local e2e run, a CI e2e run, and the
 * hygiene sweep — and on 19 Sep 2026 a refusal insisted it was an e2e run
 * while the sweep held it for 26 minutes clearing a backlog. Several minutes
 * went into hunting a run that did not exist. So the holder names itself, and
 * these are the shapes that message is built from.
 */
describe("who holds the e2e run lock", () => {
  const AT = new Date("2026-09-19T21:14:35.000Z");

  it("names itself in a form Postgres will not truncate", () => {
    const name = lockHolderName("sweep", { ci: true, now: AT });
    expect(name).toBe(`${LOCK_NAME_PREFIX}:sweep:ci:2026-09-19T21:14Z`);
    // application_name is NAMEDATALEN-1 = 63 bytes; over that, silently cut.
    expect(Buffer.byteLength(name, "utf8")).toBeLessThan(63);
    expect(lockHolderName("e2e", { now: AT })).toBe(`${LOCK_NAME_PREFIX}:e2e:local:2026-09-19T21:14Z`);
  });

  it("reads a name back as the sentence the refusal prints", () => {
    const NOW = new Date("2026-09-19T21:40:00.000Z");
    expect(describeLockHolder(`${LOCK_NAME_PREFIX}:sweep:ci:2026-09-19T21:14Z`, "00:26:03", NOW))
      .toBe("the hygiene sweep (scripts/c1/hygiene.mjs), started in CI at 2026-09-19T21:14Z, 26 min ago");
    expect(describeLockHolder(`${LOCK_NAME_PREFIX}:e2e:local:2026-09-19T21:39Z`, "00:01:12", NOW))
      .toBe("an e2e run, started locally at 2026-09-19T21:39Z, 1 min ago");
  });

  /**
   * `pg_stat_activity.backend_start` is the POOLED BACKEND's age, not the
   * holder's. Measured: a rehearsal that had held the lock for one second
   * reported 00:44:27, because the session pooler handed it a backend that had
   * been open three quarters of an hour. So the age in the message comes from
   * the timestamp the holder wrote into its own name, and the connection age is
   * only ever reported as a connection age.
   */
  it("never passes the pooled backend's age off as how long the lock has been held", () => {
    const NOW = new Date("2026-09-19T21:40:00.000Z");
    const named = describeLockHolder(`${LOCK_NAME_PREFIX}:e2e:ci:2026-09-19T21:39Z`, "00:44:27", NOW);
    expect(named).toContain("1 min ago");
    expect(named).not.toContain("00:44:27");

    const unnamed = describeLockHolder("Supavisor", "00:44:27", NOW);
    expect(unnamed).toContain("pooled connection has been open 00:44:27");
    expect(unnamed).toContain("NOT how long it has held the lock");
  });

  /** The normal case until every checkout has this change — it must read as
   *  "we cannot tell", never as a confident wrong answer. */
  it("admits it cannot tell, rather than guessing", () => {
    for (const unknown of ["Supavisor", "", null, undefined, "psql", "pg-e2e-lock:sweep"]) {
      const line = describeLockHolder(unknown, "00:05:00", new Date("2026-09-19T21:40:00.000Z"));
      expect(line, String(unknown)).toMatch(/did not record what it is/);
      expect(line, String(unknown)).not.toMatch(/e2e run|hygiene sweep/);
    }
  });

  it("agrees with the plain-JS twin the sweep uses", () => {
    expect(mjsLockHolderName("sweep", { ci: true, now: AT })).toBe(lockHolderName("sweep", { ci: true, now: AT }));
    expect(mjsLockHolderName("e2e", { now: AT })).toBe(lockHolderName("e2e", { now: AT }));
    const NOW = new Date("2026-09-19T21:40:00.000Z");
    for (const n of [`${LOCK_NAME_PREFIX}:sweep:ci:2026-09-19T21:14Z`, "Supavisor", null]) {
      expect(mjsDescribeLockHolder(n, "00:01:00", NOW)).toBe(describeLockHolder(n, "00:01:00", NOW));
    }
    expect(MJS_HOLDER_QUERY).toBe(LOCK_HOLDER_QUERY);
  });

  /**
   * The bug itself: `new pg.Client({ application_name })` puts the name in the
   * startup packet, and Supabase's pooler replaces it — every holder read back
   * as "Supavisor", which is why nothing could say who held the project.
   * Measured on the test project; pinned by reading the source, because the
   * failure is invisible until someone is waiting on a lock and cannot say why.
   */
  it("sets application_name with set_config, never in the client options", () => {
    const root = join(__dirname, "..", "..");
    for (const f of ["e2e/run-lock.ts", "scripts/c1/hygiene.mjs"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, `${f} must name its lock connection`).toMatch(/set_config\('application_name'/);
      expect(src, `${f} passes application_name in the startup packet, which the pooler eats`)
        .not.toMatch(/application_name:\s*["'`]/);
    }
  });
});
