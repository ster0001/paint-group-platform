import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * A "use server" module may export async functions and nothing else.
 *
 * On 21 Oct 2026 `app/pc/movements/actions.ts` gained
 * `export const RUN_PURPOSES = [...]`. Dev, typecheck and lint were all happy;
 * the PRODUCTION build threw `A "use server" file can only export async
 * functions, found object` at module evaluation, and every server action in
 * the same server chunk died with it — the crew link, the revision draft,
 * anything a painter or estimator pressed. The C1 e2e caught it as two
 * unrelated-looking timeouts. This test fails the unit run instead.
 *
 * `export type` is fine (erased). A constant lives in `lib/` and is imported.
 */
const files = execSync("git ls-files app lib", { encoding: "utf8" }).split("\n").filter((f) => /\.tsx?$/.test(f));
const bad = /^export\s+(const|let|var|class|default|\{|function(?!\s*\*)(?=\s+[^a]))/m;

describe('"use server" modules export only async functions', () => {
  const serverFiles = files.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
  it("finds the server-action modules", () => {
    expect(serverFiles.length).toBeGreaterThan(10);
  });
  it.each(serverFiles)("%s", (f) => {
    const src = readFileSync(f, "utf8");
    const offenders = src.split("\n").filter((line) => bad.test(line) && !/^export\s+async\s+function/.test(line));
    expect(offenders, `${f} exports a non-function from a "use server" module — move it to lib/ and import it`).toEqual([]);
  });
});
