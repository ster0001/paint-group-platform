import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MOVEMENTS_TABLES } from "./types";

/**
 * Movements brief §5: "Only RPCs write it." Nothing under app/ or lib/ inserts,
 * updates, upserts or deletes a movements-family row, and nothing sets a
 * movements status by hand — every transition is one of the definer RPCs in
 * migration 20270279 (movement_place, movement_mark_ordered, movement_set_status,
 * …). The database already revokes the writes from clients; this test is what
 * makes a service-role shortcut in a sweep or an action fail review too.
 */
const ROOT = join(__dirname, "..", "..");

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

describe("movements are written only through their RPCs", () => {
  test("no .insert / .update / .delete / .upsert on a movements table anywhere in app/ or lib/", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const t of MOVEMENTS_TABLES) {
        const re = new RegExp(`\\.from\\(["']${t}["']\\)[\\s\\S]{0,160}?\\.(insert|update|delete|upsert)\\(`, "g");
        if (re.test(src)) offenders.push(`${f.replace(ROOT + "/", "")} → ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no component, action or sweep sets a movement status by hand", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("movements")) continue;
      if (/\.update\(\{[^}]*\bstatus\b\s*:/.test(src) && /["']movements["']/.test(src)) offenders.push(f.replace(ROOT + "/", ""));
      if (/status\s*=\s*["'](tray|planned|booked|done|problem|cancelled)["']/.test(src) && /["']movements["']/.test(src) && /\.from\(["']movements["']\)/.test(src)) {
        offenders.push(`${f.replace(ROOT + "/", "")} (status literal beside a movements read)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no Client Component touches a movements-family table directly", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/m.test(src)) continue;
      for (const t of MOVEMENTS_TABLES) if (new RegExp(`\\.from\\(["']${t}["']\\)`).test(src)) offenders.push(`${f.replace(ROOT + "/", "")} → ${t}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the migration carries every table, a demo trigger on the job-linked ones, and no painter policy on a base table", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20270279000000_movements.sql"), "utf8");
    for (const t of MOVEMENTS_TABLES) {
      expect(sql, `${t} created`).toMatch(new RegExp(`create table if not exists public\\.${t}\\s*\\(`));
      expect(sql, `${t} has RLS on`).toContain(`alter table public.${t} enable row level security`);
      expect(sql, `${t} has a staff policy`).toMatch(new RegExp(`create policy ${t}_staff on public\\.${t}`));
    }
    for (const t of ["movements", "movement_items", "wo_material_lines", "wo_logistics_decisions"]) {
      expect(sql, `${t} copies is_demo by trigger`).toMatch(new RegExp(`create trigger t_demo_flag before insert on public\\.${t}\\b`));
    }
    // §5 column limits live in the two painter read functions, never in a base-table policy.
    expect(sql).not.toMatch(/create policy \w+_painter on public\.(movements|supplier_branches)/);
    expect(sql).toContain("create or replace function public.movements_for_painter(");
    expect(sql).toContain("create or replace function public.supplier_branches_for_painter(");
    const at = sql.indexOf("create or replace function public.movements_for_painter(");
    const body = sql.slice(at, sql.indexOf("$$;", at));
    for (const hidden of ["expected_cost_cents", "problem_note", "ordered_by", "booked_by"]) expect(body, `painter read never carries ${hidden}`).not.toContain(hidden);
  });
});
