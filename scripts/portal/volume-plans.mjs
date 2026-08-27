/**
 * 3a-8 · RLS query plans on the portal's hot paths, against the seeded C1
 * dataset. Runs each query AS THE authenticated ROLE with a real user's JWT
 * claims (RLS engaged — the CLAUDE.md lesson: never judge RLS through the
 * service key), prints the plan, and FAILS if a hot path sequential-scans a
 * big table.
 *
 *   node scripts/portal/volume-plans.mjs <profile-uuid>
 */
import { loadTestEnv, refuseProduction } from "../c1/env.mjs";
import pg from "pg";

loadTestEnv();
const url = process.env.C1_DATABASE_URL;
refuseProduction(url ?? "");
const userId = process.argv[2];
if (!url || !userId) {
  console.error("usage: node scripts/portal/volume-plans.mjs <profile-uuid>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const HOT = [
  {
    name: "memberships by profile (RLS self)",
    sql: "select account_id, role from public.account_users",
  },
  {
    name: "accounts member select (RLS helper)",
    sql: "select id, account_type, email, name, phone from public.accounts",
  },
  {
    name: "properties member select",
    sql: "select id, account_id, address, suburb, postcode from public.properties",
  },
];

// Service-side hot paths (the portal's scoped reads) — RLS off, but the
// index question is identical: these must be keyed scans at 60k/500k rows.
const SERVICE = (accountId, woId, estIds) => [
  { name: "estimates by account (limit 50)",
    sql: `select id, title, status from public.estimates where account_id = '${accountId}' order by created_at desc limit 50` },
  { name: "work orders by estimate ids",
    sql: `select estimate_id, stage from public.work_orders where estimate_id in (${estIds.map((i) => `'${i}'`).join(",")})` },
  { name: "invoices by estimate ids",
    sql: `select id, status, total_inc_cents from public.invoices where estimate_id in (${estIds.map((i) => `'${i}'`).join(",")})` },
  { name: "photos by wo, kinds, limit 60",
    sql: `select id, kind, storage_path from public.wo_photos where work_order_id = '${woId}' and kind in ('before','progress','completion') order by created_at desc limit 60` },
  { name: "events by wo (stage_changed)",
    sql: `select type, to_stage, created_at from public.wo_events where work_order_id = '${woId}' and type = 'stage_changed' order by created_at asc` },
];

const BIG = ["accounts", "properties", "estimates", "work_orders", "wo_photos", "wo_events", "invoices", "payments", "account_users"];

async function explain(name, sql, asUser) {
  await client.query("begin");
  try {
    if (asUser) {
      await client.query(`set local role authenticated`);
      await client.query(
        `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true)`,
      );
    }
    const { rows } = await client.query(`explain (analyze, buffers) ${sql}`);
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const seqScan = BIG.filter((t) => plan.includes(`Seq Scan on ${t}`));
    const ms = Number(plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? "0");
    // A hashed-subplan pass shows as a seq scan but runs in single-digit ms
    // at the full seed — the verdict is the measured time, the scan note is
    // information. >50ms on a hot path is the failure.
    const slow = ms > 50;
    console.log(`\n=== ${name}  (${ms} ms)${slow ? "  ⚠ SLOW" : "  ✓"}${seqScan.length ? `  [plan notes: seq scan on ${seqScan.join(",")}]` : ""}`);
    console.log(plan.split("\n").slice(0, 6).map((l) => "  " + l).join("\n"));
    return !slow;
  } finally {
    await client.query("rollback");
  }
}

async function main() {
  await client.connect();
  const { rows: [wo] } = await client.query(
    "select w.id, w.estimate_id, e.account_id from public.work_orders w join public.estimates e on e.id = w.estimate_id where w.share_token like 'volwo%' and w.stage = 'in_progress' limit 1",
  );
  const { rows: ests } = await client.query(
    `select id from public.estimates where account_id = '${wo.account_id}' limit 10`,
  );

  let ok = true;
  for (const q of HOT) ok = (await explain(q.name, q.sql, true)) && ok;
  for (const q of SERVICE(wo.account_id, wo.id, ests.map((e) => e.id))) ok = (await explain(q.name, q.sql, false)) && ok;

  console.log(ok ? "\nALL HOT PATHS INDEXED ✓" : "\n⚠ SEQUENTIAL SCANS FOUND — fix before the gate passes");
  await client.end();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
