import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * C3 accept criterion: "no path updates wizard_drafts without a version
 * predicate."
 *
 * Read literally that would forbid the lifecycle writes too — converting a
 * draft, stamping an email on it, filing an outcome, the nightly sweep. Those
 * do not race the customer's answers and a predicate there would only produce
 * spurious failures.
 *
 * What actually matters is narrower and stronger: **only one path may write the
 * `state` column, and it must carry the predicate.** A second writer of `state`
 * is the bug this chunk exists to stop, and it would not announce itself — the
 * route is best-effort and answers 200 either way.
 *
 * So this test reads the source. It is unusual, and deliberate: the invariant is
 * about which files exist, not about what one function returns.
 */

const ROOT = join(__dirname, "..", "..");
const ALLOWED_STATE_WRITER = "app/api/wizard/draft/route.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = [join(ROOT, "app"), join(ROOT, "lib")].flatMap((d) => walk(d));

describe("wizard_drafts has one writer of state", () => {
  test("no file but the draft route writes the state column", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const rel = file.slice(ROOT.length + 1);
      if (rel === ALLOWED_STATE_WRITER) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes('from("wizard_drafts")')) continue;
      // An update or upsert on wizard_drafts that mentions `state` in the same
      // statement. Deliberately crude: a false positive is a prompt to read the
      // file, which is exactly what should happen before a second writer lands.
      const stmts = src.split('from("wizard_drafts")').slice(1);
      for (const stmt of stmts) {
        const head = stmt.slice(0, 400);
        if (/\.(update|upsert)\(/.test(head) && /\bstate\b\s*:/.test(head)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the draft route's state write carries a version predicate", () => {
    const src = readFileSync(join(ROOT, ALLOWED_STATE_WRITER), "utf8");
    const update = src.slice(src.indexOf('.update({'), src.indexOf('return NextResponse.json({ saved: true, id: existing.id'));
    expect(update).toContain('.eq("version", expected)');
    expect(update).toContain("version: serverVersion + 1");
  });

  test("and it answers 409 with the server's copy rather than winning silently", () => {
    const src = readFileSync(join(ROOT, ALLOWED_STATE_WRITER), "utf8");
    expect(src).toContain("conflict: true");
    expect(src).toContain("{ status: 409 }");
  });
});
