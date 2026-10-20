import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CLAUDE.md → Architecture boundaries, "one board engine" (Movements Session 2,
 * Oct 2026): a lanes × days drag surface is app/components/board and nothing
 * else. Building a second 2,000-line board — or a second hit-test, ghost or
 * marquee — is the thing this test exists to catch. It greps app/ and lib/
 * for the engine's own fingerprints outside the engine's directory.
 */
const ROOT = join(__dirname, "..", "..", "..");
const ENGINE = "app/components/board";

function walk(p: string, out: string[] = []): string[] {
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) {
    if (/\/(node_modules|\.next)$/.test(p)) return out;
    for (const name of readdirSync(p)) walk(join(p, name), out);
  } else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * What only the engine may do. Deliberately the board's OWN fingerprints —
 * `.lane` is a class other screens use for a plain column (CRM customers,
 * the flow page), and `setPointerCapture` is a signature pad's too; neither
 * is a drag board. A day cell, the board hit-test, the drop-target toggle
 * and the marquee are.
 */
const FINGERPRINTS: [string, RegExp][] = [
  ["hit-testing the pointer against the board", /\belementsFromPoint\s*\(/],
  ["a day cell (the engine's drop target)", /className=\{?["'`]bgc\b/],
  ["the drop-target highlight", /classList\.(add|toggle)\(\s*["']hot["']/],
  ["a marquee cell", /classList\.(add|toggle)\(\s*["']marq["']/],
];

describe("one board engine", () => {
  test("no lanes × days drag surface outside app/components/board", () => {
    const offenders: string[] = [];
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]
      .filter((f) => !f.replace(ROOT + "/", "").startsWith(ENGINE + "/"));
    for (const f of files) {
      const lines = stripComments(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const [what, re] of FINGERPRINTS) {
          if (re.test(line)) offenders.push(`${f.replace(ROOT + "/", "")}:${i + 1}  ${what}:  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("the engine still carries each fingerprint (so the grep is live)", () => {
    const src = walk(join(ROOT, ENGINE)).map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
    for (const [what, re] of FINGERPRINTS) expect(re.test(src), what).toBe(true);
  });
});
