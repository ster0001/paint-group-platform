import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THREE GUARDS, ONE ANSWER TO "WHAT IS PRODUCTION" — AND NOBODY GUESSES IT.
 *
 * `e2e/global-setup.ts` refuses to point the browser or the fixtures at the
 * production project; `scripts/seed-target.mjs` refuses to let a seed script
 * write to it; `scripts/c1/env.mjs` refuses to let the C1 tooling touch it.
 *
 * This file used to assert that two PINNED CONSTANTS agreed. They did, and it
 * was still wrong twice:
 *
 *   · reading `.env.local` first meant a worktree (no such file) got null and
 *     the guard passed everything through;
 *   · then a worktree whose `.env.local` held the TEST project was told its own
 *     test stack was production, and refused every run.
 *
 * A guard whose answer depends on which of several sources happens to win is
 * not one guard. So the ref is now named by ONE environment variable with no
 * fallback, and these tests enforce the part a reviewer cannot see at a glance:
 * that nobody has quietly re-added a constant "just in case", and that an
 * unset value stops the run rather than starting it.
 */
const ROOT = join(__dirname, "..");
const GUARDS = [
  "e2e/global-setup.ts",
  "scripts/seed-target.mjs",
  "scripts/c1/env.mjs",
] as const;
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("what is production", () => {
  test("no guard hardcodes a project ref — the environment names it", () => {
    for (const f of GUARDS) {
      // A bare 20-character lowercase alphanumeric string in quotes is what a
      // Supabase project ref looks like. Prose and comments are stripped first
      // so the cautionary tale above doesn't trip its own test.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
      expect({ file: f, hardcoded: code.match(/["'][a-z0-9]{20}["']/g) ?? [] })
        .toEqual({ file: f, hardcoded: [] });
    }
  });

  test("all three read the SAME variable", () => {
    for (const f of GUARDS) expect(read(f)).toContain("PRODUCTION_SUPABASE_REF");
  });

  test("each one refuses when it is unset — fails closed, never open", () => {
    for (const f of GUARDS) {
      const code = read(f);
      // The shape check is the refusal: anything that is not a project ref —
      // unset, blank, a placeholder — falls through to the error path.
      expect(code).toMatch(/\^\[a-z0-9\]\{20\}\$/);
      expect(code).toMatch(/REFUSED/);
    }
  });

  /**
   * The ref comes from the PROCESS ENVIRONMENT in every guard.
   *
   * Note what this deliberately does NOT forbid: `scripts/seed-target.mjs`
   * still reads `.env.local` — to resolve the TARGET, i.e. which project the
   * script is about to write to. That is its whole job and it is correct.
   * What went wrong before was using that same file to decide what production
   * IS. The two questions are different and only one of them may be inferred.
   */
  test("each one resolves the ref from process.env, not from a file", () => {
    for (const f of GUARDS) {
      expect({ file: f, fromEnv: /process\.env(\[PRODUCTION_REF_VAR\]|\.PRODUCTION_SUPABASE_REF)/.test(read(f)) })
        .toEqual({ file: f, fromEnv: true });
    }
  });

  test("the old pinned constant is gone by name", () => {
    for (const f of GUARDS) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
      expect({ file: f, assignsAConstant: /PRODUCTION_REF\s*=\s*["']/.test(code) })
        .toEqual({ file: f, assignsAConstant: false });
    }
  });
});

/**
 * AND IT ACTUALLY REFUSES — the behaviour, not just the source.
 *
 * The tests above read the files; these run the guard. Both matter: a reviewer
 * can see a `REFUSED` string and still ship a guard that never reaches it.
 * `globalSetup` calls `productionRef()` on its first line, before it looks at
 * the target, the base URL or anything else, so an unset variable stops the
 * run at the earliest possible point rather than part-way through setup.
 */
describe("the e2e tripwire, run", () => {
  const KEY = "PRODUCTION_SUPABASE_REF";
  const saved = process.env[KEY];
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
  });

  test("unset stops the run, and says which variable", async () => {
    const { default: globalSetup } = await import("../e2e/global-setup");
    delete process.env[KEY];
    await expect(globalSetup()).rejects.toThrow(/REFUSED[\s\S]*PRODUCTION_SUPABASE_REF[\s\S]*not set/);
  });

  test("a placeholder is not a project ref either", async () => {
    const { default: globalSetup } = await import("../e2e/global-setup");
    for (const bad of ["", "   ", "your-project-ref", "llmrvgde", "LLMRVGDEQUPMZZUAXDHQ"]) {
      process.env[KEY] = bad;
      await expect(globalSetup()).rejects.toThrow(/REFUSED[\s\S]*PRODUCTION_SUPABASE_REF/);
    }
  });

  test("the refusal tells a fresh worktree what to do about it", async () => {
    const { default: globalSetup } = await import("../e2e/global-setup");
    delete process.env[KEY];
    const err = await globalSetup().catch((e: Error) => e.message);
    // The three things somebody stuck at 11pm needs: the variable, where the
    // value lives, and why their brand-new worktree hasn't got it.
    expect(err).toContain("PRODUCTION_SUPABASE_REF");
    expect(err).toContain(".env.test.local");
    expect(err).toMatch(/worktree/i);
    expect(err).toMatch(/gitignored/i);
  });

  test("a valid ref gets PAST this guard — it is not refusing everything", async () => {
    const { default: globalSetup } = await import("../e2e/global-setup");
    process.env[KEY] = "llmrvgdequpmzzuaxdhq";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Now it fails on the NEXT check instead, which is the proof it moved on.
    await expect(globalSetup()).rejects.toThrow(/No NEXT_PUBLIC_SUPABASE_URL/);
  });
});
