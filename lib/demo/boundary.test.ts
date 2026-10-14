import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEMO_FLAGGED_TABLES } from "./scope";

/**
 * Induction brief §4.2 / §7 rule 2: "is_demo rows are excluded by one shared
 * scope used by every reporting and money query" — and Step 1's acceptance,
 * "the exclusion is one scope". The database carries the flag; this test is
 * what stops a new list read in app/ or lib/ forgetting it.
 *
 * Rule: every `.from("<flagged table>")` whose chain is a LIST read must call
 * `realOnly(` (lib/demo/scope.ts) or filter `is_demo` itself. A read by id —
 * `.eq("id"`, `.in("id"`, `.eq("work_order_id"`, `.eq("estimate_id"`,
 * `.eq("share_token"`, `.single()` / `.maybeSingle()` — is a point read of a
 * row the caller already holds and takes no scope: the contractor and the
 * office must be able to OPEN the demo job.
 *
 * DEMO_VISIBLE lists the files that must show the demo: the contractor's own
 * portal, the token pages and the per-job actions. Nothing under lib/reporting,
 * lib/crm, lib/scheduling, lib/painterStatus, lib/invoicing, app/pc, app/(app),
 * app/invoicing, app/crm or the sweeps may ever be added here.
 */
const ROOT = join(__dirname, "..", "..");

const DEMO_VISIBLE: readonly string[] = [
  // The contractor's own screens — RLS already pins these to their rows, and the demo MUST show.
  "lib/contractor/jobs.ts", "lib/contractor/employeeJobs.ts", "lib/contractor/offers.ts", "lib/contractor/timesheets.ts",
  "app/portal/",
  // Token pages: a demo token is the contractor's own, and a read by token is a point read anyway.
  "app/w/", "app/s/", "app/v/", "app/crew/",
  "lib/demo/",
  // The customer portal reads by the customer's own account; the demo has no customer (migration 20270262).
  "lib/portal/", "app/account/",
  // The estimate builder and the booked-job import, by estimate id.
  "app/quote/", "lib/import/",
];
// NOT on the list, on purpose: lib/workorder (consoleData.ts feeds /pc — it was
// the first demo row to leak, 14 Oct), lib/callbacks, lib/standards and the
// per-job API routes. Their by-id reads are exempt by shape; their list reads
// are not.

const TABLE_RE = new RegExp(`\\.from\\(["'](${DEMO_FLAGGED_TABLES.join("|")})["']\\)`, "g");
const POINT_READ = /\.(eq|in)\(["'](id|work_order_id|estimate_id|share_token|customer_token|token|painter_id|contractor_id|invoice_id|variation_id)["']|\.(single|maybeSingle)\(\)|\.(insert|update|upsert|delete)\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The query chain that follows a `.from(...)`: up to the statement's end. */
function chainAfter(src: string, at: number): string {
  const rest = src.slice(at, at + 1200);
  const end = rest.search(/;\s*\n|\n\s*\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("every list read of a demo-flagged table leaves demo rows out", () => {
  test("no .from(<flagged table>) list read in app/ or lib/ without realOnly() or an is_demo filter", () => {
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.replace(ROOT + "/", "");
      if (DEMO_VISIBLE.some((p) => rel.startsWith(p))) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(TABLE_RE)) {
        const chain = chainAfter(src, m.index ?? 0);
        if (POINT_READ.test(chain)) continue;
        if (chain.includes("realOnly(") || chain.includes("is_demo")) continue;
        // realOnly wraps the builder: `realOnly(supabase.from("x").select(...))` puts the call BEFORE `.from`.
        const before = src.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
        if (before.includes("realOnly(")) continue;
        const line = src.slice(0, m.index ?? 0).split("\n").length;
        offenders.push(`${rel}:${line} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the scope's table list matches the migration's", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20270262000000_demo_property.sql"), "utf8");
    for (const t of DEMO_FLAGGED_TABLES) expect(sql, `${t} is flagged in SQL`).toMatch(new RegExp(`['"]${t}['"]|public\\.${t}\\b`));
  });
});
