/**
 * 20270181 · the bucket trigger and bucketFor agree.
 *
 * The migration is pasted by hand, so the repo pins what it promises: for
 * every ACTION outcome the SQL trigger files the same bucket bucketFor does,
 * the trigger fires before insert and before update of the two columns it
 * reads, and the file registers itself under its own name.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketFor, WIZARD_BUCKETS, type WizardOutcome } from "./journey";

const FILE = "20270181000000_wizard_bucket_forward_only.sql";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");

function fnBody(): string {
  const m = sql.match(/create or replace function public\.wizard_drafts_bucket_forward_only\(\)[\s\S]*?\$\$;/);
  if (!m) throw new Error("wizard_drafts_bucket_forward_only() not found in the migration");
  return m[0];
}

/** What the trigger sets for an outcome, read off the SQL; null = leaves the row alone. */
function sqlBucketFor(outcome: string): string | null {
  const body = fnBody();
  const single = body.match(new RegExp(`if new\\.outcome = '${outcome}' then\\s+new\\.bucket := '([a-z_]+)'`));
  if (single) return single[1];
  const grouped = body.match(/elsif new\.outcome in \(([^)]*)\) then\s+new\.bucket := '([a-z_]+)'/);
  if (grouped && grouped[1].includes(`'${outcome}'`)) return grouped[2];
  return null;
}

describe("20270181 · wizard bucket is forward-only at the database", () => {
  const now = new Date("2026-09-20T01:00:00Z");
  const active = { completed: false, lastActiveAt: now.toISOString(), now };

  it("every action outcome maps to the same bucket in SQL as in bucketFor", () => {
    for (const outcome of ["call_requested", "visit_requested", "question_asked", "help_requested"] as WizardOutcome[]) {
      expect(sqlBucketFor(outcome), outcome).toBe(bucketFor({ ...active, outcome }));
    }
  });
  it("'none' is left to the app (online_now / dropped / priced_no_request are time-based)", () => {
    expect(sqlBucketFor("none")).toBeNull();
    expect(bucketFor({ ...active, outcome: "none" })).toBe("online_now");
  });
  it("the trigger fires BEFORE insert and before update of bucket or outcome", () => {
    expect(sql).toMatch(/create trigger wizard_drafts_bucket_forward_only\s+before insert or update of bucket, outcome on public\.wizard_drafts/);
    expect(sql).toMatch(/drop trigger if exists wizard_drafts_bucket_forward_only/);
  });
  it("only buckets the column's check constraint allows are written", () => {
    for (const b of [...fnBody().matchAll(/new\.bucket := '([a-z_]+)'/g)].map((m) => m[1])) {
      expect(WIZARD_BUCKETS).toContain(b);
    }
  });
  it("registers itself under its own file name", () => {
    expect(sql).toContain(`insert into public._prod_migrations(name) values ('${FILE}')`);
  });
});
