import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Payments merge brief §3 rule 4 / Step 1–2 acceptance: "every figure on this
 * page comes from lib/invoicing — no arithmetic in components; the grep audit
 * must stay clean". The Payments page's own files (its loader, its JSON route
 * and — from Step 2 — its components) may MAP and FORMAT cents, never add,
 * subtract, multiply or divide them. Arithmetic belongs in
 * lib/invoicing/jobMoney.ts, where it is tested.
 */
const ROOT = join(__dirname, "..", "..");
const PAGE_FILES = [
  "app/invoicing/jobMoneyData.ts",
  "app/api/invoicing/job-money",
  "app/invoicing/payments", // Step 2: the page itself
];

function walk(p: string, out: string[] = []): string[] {
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) for (const name of readdirSync(p)) walk(join(p, name), out);
  else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  return out;
}

/** A cents-named value on either side of + − × ÷. Comments are stripped first. */
// The right-hand side may be a property (`s + r.amountCents` slipped past the first version, 8c).
const CENTS_MATH = /\b\w*[cC]ents\w*\b\s*[-+*/]\s*[\w(]|[\w)]\s*[-+*/]\s*(?:[\w$]+\??\.)*\w*[cC]ents\w*\b/;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the Payments page computes no money of its own", () => {
  test("no arithmetic on a *cents value in the page's files", () => {
    const offenders: string[] = [];
    for (const f of PAGE_FILES.flatMap((p) => walk(join(ROOT, p)))) {
      const lines = stripComments(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => { if (CENTS_MATH.test(line)) offenders.push(`${f.replace(ROOT + "/", "")}:${i + 1}  ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });

  test("the audit bites: it catches the shapes it exists for", () => {
    expect(CENTS_MATH.test("amountIncCents: c.amount_ex_cents + c.gst_cents")).toBe(true);
    expect(CENTS_MATH.test("const left = r.balanceCents - paid")).toBe(true);
    expect(CENTS_MATH.test("fmt2(r.balanceCents)")).toBe(false);
  });
});
