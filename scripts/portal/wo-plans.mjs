/**
 * The wo_* RLS timing probe. EXPLAINs bare selects on the loop tables AS an
 * authenticated NON-MEMBER (a uuid with no contractor/customer link) against
 * the C1 volume seed — the exact PostgREST query that 57014'd on 30 Aug 2026
 * (per-row SECURITY DEFINER helpers in the policies; fixed by
 * 20261213000000_wo_policies_indexed.sql). Pattern: volume-plans.mjs.
 *
 *   node scripts/portal/wo-plans.mjs
 */
import { loadTestEnv, refuseProduction } from "../c1/env.mjs";
import pg from "pg";

loadTestEnv();
const url = process.env.C1_DATABASE_URL;
refuseProduction(url ?? "");
if (!url) { console.error("C1_DATABASE_URL missing from .env.test.local"); process.exit(1); }

// A fixed uuid with no profiles/contractors/customers row = a non-member.
const NOBODY = "9e1d7c2a-4b3f-4c8d-9a6e-000000000001";

const QUERIES = [
  ["wo_events bare select",   "select id from public.wo_events limit 5"],
  ["wo_photos bare select",   "select id from public.wo_photos limit 5"],
  ["wo_updates bare select",  "select id from public.wo_updates limit 5"],
  ["wo_surfaces bare select", "select id from public.wo_surfaces limit 5"],
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

for (const t of ["wo_events", "wo_photos"]) {
  const { rows: [r] } = await client.query(`select count(*)::int as n from public.${t}`);
  console.log(`${t}: ${r.n} rows`);
}

// A non-member's bare select still walks the whole table probing one empty
// hashed subplan (an OR-free single-IN policy is what makes the probe that
// cheap — ~0.1µs/row). At 500k wo_photos rows the floor is ~50ms warm, so the
// bar is 100ms — the per-row-policy disease this probe exists to catch is two
// orders of magnitude past that (it 57014'd). Each query runs twice and the
// better time is judged: the first pass pays cache/JIT warmup on the small
// C1 instance and can be 10× the steady state.
let ok = true;
for (const [name, sql] of QUERIES) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    // PostgREST runs authenticated under a statement timeout; mirror it so a
    // still-per-row policy fails here the same way it failed live.
    await client.query("set local statement_timeout = '8s'");
    await client.query(
      `select set_config('request.jwt.claims', '{"sub":"${NOBODY}","role":"authenticated"}', true)`,
    );
    let best = Infinity, plan = "";
    for (let pass = 0; pass < 2; pass++) {
      const { rows } = await client.query(`explain (analyze, buffers) ${sql}`);
      plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      const ms = Number(plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? "0");
      best = Math.min(best, ms);
    }
    const slow = best > 100;
    if (slow) ok = false;
    console.log(`\n=== ${name}  (${best} ms warm)${slow ? "  ⚠ SLOW" : "  ✓"}`);
    console.log(plan.split("\n").slice(0, 8).map((l) => "  " + l).join("\n"));
  } catch (e) {
    ok = false;
    console.log(`\n=== ${name}  FAILED: ${e.code ?? ""} ${e.message}`);
  } finally {
    await client.query("rollback").catch(() => {});
  }
}
await client.end();
console.log(ok ? "\nALL FAST ✓" : "\n⚠ SLOW OR FAILING — the policies still run per row");
process.exit(ok ? 0 : 1);
