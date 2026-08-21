/**
 * The §7.6 audit, as a test.
 *
 * The brief asks for `grep` audits before merge: no client-side writes to money
 * or status columns, and no price arithmetic outside lib/pricing. A grep somebody
 * remembers to run is a grep that eventually nobody runs, so it lives here and
 * fails the build instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments are stripped before anything is matched. The first version of this
 * audit flagged three files, and all three were the prose EXPLAINING the rule —
 * a doc comment saying "never hardcode +10:00" is not a hardcoded +10:00. An
 * audit that cries wolf at its own documentation gets switched off.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sourceFiles = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
const read = (f: string) => ({ path: relative(ROOT, f), text: stripComments(readFileSync(f, "utf8")) });
const sources = sourceFiles.map(read);

describe("no client write reaches a money or status column", () => {
  // .update({ ... }) / .insert({ ... }) naming a guarded column on a guarded table.
  const GUARDED = /\.(update|insert|upsert)\(\s*\{[^}]*\b(stage|status|payment_cents|price_cents|contractor_delta_cents|contractor_payment_cents|total_cents|subtotal_cents)\b/;

  // The loop's own tables. Anything writing these from app code is a bug: every
  // write goes through an RPC.
  const LOOP_TABLE = /\.from\(\s*["'](work_orders|wo_surfaces|wo_variations|wo_updates|wo_signoff|wo_qa_checks|wo_events|wo_checklist_items|warranties)["']\s*\)/;

  // Matched within one statement, not one file: QuoteBuilder writes colours to
  // work_orders AND total_cents to estimates, and a file-level match called that
  // a violation when the two have nothing to do with each other.
  it("never writes a guarded column on a loop table", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      for (const match of file.text.matchAll(new RegExp(LOOP_TABLE.source, "g"))) {
        const statement = file.text.slice(match.index, (match.index ?? 0) + 400);
        if (GUARDED.test(statement)) offenders.push(`${file.path} (${match[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never writes work_orders.stage from anywhere in app code", () => {
    const offenders = sources
      .filter((f) => /stage\s*:/.test(f.text) && /\.(update|upsert)\(/.test(f.text))
      .filter((f) => f.path.startsWith("app/"))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("money is computed in one place", () => {
  it("has no hard-coded contractor rate outside the engine and its tests", () => {
    // 6000 cents = $60/hr. It belongs in Settings, and the one preview that
    // shows it reads the live value through a prop.
    const offenders = sources
      .filter((f) => /\b6000\b/.test(f.text))
      .filter((f) => !f.path.startsWith("lib/pricing/"))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("does no hours × rate arithmetic outside lib/pricing", () => {
    const offenders = sources
      .filter((f) => !f.path.startsWith("lib/pricing/"))
      .filter((f) => /hours\s*\*\s*\w*[Rr]ate|[Rr]ate\w*\s*\*\s*hours/.test(f.text))
      // The mirror is allowed to state the rule; it is what pins the arithmetic.
      .filter((f) => f.path !== "lib/workorder/variations.ts")
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("keeps the service-role key out of anything a browser loads", () => {
    const offenders = sources
      .filter((f) => f.text.includes("SUPABASE_SERVICE_ROLE_KEY"))
      .filter((f) => f.text.includes('"use client"') || f.text.includes("'use client'"))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("the loop's own conventions", () => {
  it("never buckets a date with toISOString().slice(0,10) in loop code", () => {
    // That is the UTC date. Before 10am Melbourne it is yesterday, which is how
    // the sparkline and the "days until start" bug both happened.
    const offenders = sources
      .filter((f) => f.path.startsWith("lib/workorder/") || f.path.includes("cron/wo-sweep"))
      .filter((f) => /toISOString\(\)\.slice\(0,\s*10\)/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("never hardcodes the Melbourne offset", () => {
    const offenders = sources
      .filter((f) => /\+10:00|\+11:00/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
