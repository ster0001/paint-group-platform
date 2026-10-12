/**
 * Every column a migration's SQL writes on wo_variations was created by a
 * migration (12 Oct 2026). wo_contractor_decline_variation (20270220) and
 * wo_office_reject_variation (20270240) both set `declined_at`, a column that
 * only ever existed on ESTIMATES — plpgsql compiles the body without checking,
 * so both functions went live and failed with 42703 on every call: no painter
 * ever declined a change and the office never rejected one. Nothing in the unit
 * suite could see it. This reads the whole migration history the way the
 * database would end up, and refuses an UPDATE that names a column no
 * `create table` / `add column` made.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const SQL = FILES.map((f) => ({ file: f, sql: readFileSync(resolve(DIR, f), "utf8").replace(/--[^\n]*/g, "") }));

/** Columns the history creates on public.wo_variations. */
function createdColumns(): Set<string> {
  const cols = new Set<string>();
  for (const { sql } of SQL) {
    const create = sql.match(/create table (?:if not exists )?public\.wo_variations\s*\(([\s\S]*?)\n\);/);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/);
        if (m && !["constraint", "primary", "unique", "check", "foreign"].includes(m[1])) cols.add(m[1]);
      }
    }
    for (const alter of sql.matchAll(/alter table (?:if exists )?public\.wo_variations([\s\S]*?);/g)) {
      for (const m of alter[1].matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/g)) cols.add(m[1]);
      for (const m of alter[1].matchAll(/rename column ([a-z_][a-z0-9_]*) to ([a-z_][a-z0-9_]*)/g)) cols.add(m[2]);
    }
  }
  return cols;
}

/** Every `update public.wo_variations set a = …, b = … where` — the assigned names. */
function assignedColumns(): { file: string; column: string }[] {
  const out: { file: string; column: string }[] = [];
  for (const { file, sql } of SQL) {
    for (const u of sql.matchAll(/update public\.wo_variations(?:\s+\w+)?\s+set\s+([\s\S]*?)\s+(?:where|returning)\b/g)) {
      // Split the SET list on top-level commas only (case/coalesce bodies carry their own).
      let depth = 0; let cur = ""; const parts: string[] = [];
      for (const ch of u[1]) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const m = p.trim().match(/^([a-z_][a-z0-9_]*)\s*=/);
        if (m) out.push({ file, column: m[1] });
      }
    }
  }
  return out;
}

describe("wo_variations — every column a function writes exists", () => {
  it("the history creates the table and the decline column", () => {
    const cols = createdColumns();
    expect(cols.has("status")).toBe(true);
    expect(cols.has("declined_reason")).toBe(true);
    expect(cols.has("declined_at"), "20270254 adds it").toBe(true);
  });

  it("no UPDATE assigns a column no migration created", () => {
    const cols = createdColumns();
    const assigned = assignedColumns();
    expect(assigned.length).toBeGreaterThan(20); // the parser is actually finding the updates
    const missing = assigned.filter((a) => !cols.has(a.column)).map((a) => `${a.file}: ${a.column}`);
    expect(missing).toEqual([]);
  });
});
