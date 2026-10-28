import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wizard mobile v5, R10 / session 1 — the brand guard, as a source test.
 *
 * Paint Home never shows Paint Group branding: every piece of chrome and
 * copy on the customer's estimate pages reads the brand (lib/wizard/brand*.ts,
 * lib/messaging/brand.ts) rather than naming the company. This test walks
 * the customer surfaces and counts the literal "Paint Group" OUTSIDE
 * comments. The count is a PER-FILE RATCHET, the house pattern
 * (eslint-rules/unchecked-read-baseline.json): every entry below is a
 * mention that is deliberate and says why. A new mention, or a new file
 * with one, fails here with the line — pass the brand instead. Lower a
 * number when you remove one; never raise one.
 */
const ROOT = join(__dirname, "..", "..");
const SURFACES = ["app/wizard", "app/estimate", "lib/wizard"];

/** file → [expected count, why it is allowed] */
const ALLOWED: Record<string, [number, string]> = {
  "app/wizard/page.tsx": [1, "the STAFF wizard's tab title — never served to a customer"],
  "app/wizard/Wordmark.tsx": [1, "the alt text of the Paint Group logo, on the Paint Group branch only"],
  "app/wizard/WizardHeader.tsx": [1, "the default for the call button's label; WizardApp passes the brand's name"],
  "app/wizard/MobileGate.tsx": [1, "R10: 'Reviews powered by Paint Group', 11px under the trust line on Paint Home — the one mention the brief allows"],
  "app/wizard/ChatWidget.tsx": [1, "the default for the panel's name; WizardApp passes the brand's name"],
  "app/estimate/assist/AssistView.tsx": [1, "the default for the hand-off line; the page passes the brand's name"],
  "app/estimate/assist/AssistantWidget.tsx": [1, "the default for the panel's name; the scope page passes the brand's name"],
  "lib/wizard/brand.ts": [1, "the hand-off's one deliberate line: a Paint Home job too big for the phone goes to the Paint Group team (brief §5)"],
  "lib/wizard/sweep.ts": [1, "the company-name fallback in the abandoned-walk email when Settings has no name"],
  "lib/wizard/describeFinish.ts": [1, "the company-name fallback in the finish email when Settings has no name"],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments out; strings and JSX text stay. A `//` after whitespace or at the line's start is a comment (a URL's `://` is not). */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("the brand guard (wizard mobile v5 R10)", () => {
  it("no customer surface names Paint Group except the mentions listed, each with its reason", () => {
    const found: Record<string, { count: number; lines: string[] }> = {};
    for (const dir of SURFACES) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
        const hits = lines.map((l, i) => (l.includes("Paint Group") ? `${rel}:${i + 1}: ${l.trim()}` : null)).filter((x): x is string => x != null);
        if (hits.length) found[rel] = { count: hits.length, lines: hits };
      }
    }
    const problems: string[] = [];
    for (const [rel, { count, lines }] of Object.entries(found)) {
      const allowed = ALLOWED[rel];
      if (!allowed) problems.push(`NEW: ${rel} names Paint Group — pass the brand's name instead:\n  ${lines.join("\n  ")}`);
      else if (count > allowed[0]) problems.push(`RAISED: ${rel} has ${count} mentions, ${allowed[0]} allowed (${allowed[1]}):\n  ${lines.join("\n  ")}`);
    }
    for (const [rel, [n]] of Object.entries(ALLOWED)) {
      const have = found[rel]?.count ?? 0;
      if (have < n) problems.push(`LOWER IT: ${rel} now has ${have} mention(s), the ratchet says ${n} — lower the number here`);
    }
    expect(problems, problems.join("\n\n")).toEqual([]);
  });
});
