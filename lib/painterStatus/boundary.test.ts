import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Brief §6 rule 1 and Step 9 acceptance: "greps clean for client-side writes
 * to result, colour, status or money columns". Nothing in the app writes the
 * evaluator's tables, the call-back record or a bonus amount except the
 * definer RPCs; a Client Component never talks to those tables at all.
 */
const ROOT = join(__dirname, "..", "..");
const GUARDED_TABLES = ["painter_job_results", "painter_status", "painter_bonuses", "wo_callbacks", "wo_reminder_moments", "wo_day_flags", "standards_acks"];
/** The one server-side planner that may write moment rows (Step 4: "written only by the sweep (service) and the RPCs"). */
const ALLOWED_WRITERS: Record<string, string[]> = { wo_reminder_moments: ["lib/automations/sweeps/jobReminders.ts"] };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];

describe("status, call-back and bonus tables are written only through their RPCs", () => {
  test("no .insert / .update / .delete / .upsert on a guarded table anywhere in app/ or lib/", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const t of GUARDED_TABLES) {
        const re = new RegExp(`\\.from\\(["']${t}["']\\)[\\s\\S]{0,120}?\\.(insert|update|delete|upsert)\\(`, "g");
        const rel = f.replace(ROOT + "/", "");
        if (re.test(src) && !(ALLOWED_WRITERS[t] ?? []).includes(rel)) offenders.push(`${rel} → ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no Client Component reads or writes a guarded table directly", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/m.test(src)) continue;
      for (const t of GUARDED_TABLES) if (src.includes(`"${t}"`) || src.includes(`'${t}'`)) offenders.push(`${f.replace(ROOT + "/", "")} → ${t}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no component or action sets a colour, result or bonus amount by hand", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/\.update\(\{[^}]*\b(colour|result|amount_cents|streak|bonus_counter)\b\s*:/.test(src) && GUARDED_TABLES.some((t) => src.includes(t))) offenders.push(f.replace(ROOT + "/", ""));
    }
    expect(offenders).toEqual([]);
  });
});
