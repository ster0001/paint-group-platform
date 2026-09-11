import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two guards, one answer to "what is production".
 *
 * `e2e/global-setup.ts` refuses to point the browser or the fixtures at the
 * production project; `scripts/seed-target.mjs` refuses to let a seed script
 * write to it. Both need the project ref, and both used to work it out
 * separately — global-setup from `.env.local`, which a git WORKTREE does not
 * have, so it returned null and the guard was inert exactly where the work
 * happens.
 *
 * They are constants now. This fails if they drift, because two guards
 * disagreeing about what production is would be worse than one guard.
 */
const ROOT = join(__dirname, "..");   // lib/ -> repo root
const refIn = (file: string) =>
  readFileSync(join(ROOT, file), "utf8").match(/PRODUCTION_REF\s*=\s*"([a-z0-9]+)"/)?.[1] ?? null;

describe("the production project ref", () => {
  test("e2e/global-setup.ts and scripts/seed-target.mjs agree", () => {
    const setup = refIn("e2e/global-setup.ts");
    const seed = refIn("scripts/seed-target.mjs");
    expect(setup).toBeTruthy();
    expect(seed).toBeTruthy();
    expect(setup).toBe(seed);
  });

  test("and it is a real-looking Supabase ref, not a placeholder", () => {
    expect(refIn("e2e/global-setup.ts")).toMatch(/^[a-z0-9]{20}$/);
  });
});
