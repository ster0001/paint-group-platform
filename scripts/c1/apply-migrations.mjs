/**
 * C1 · schema sync — apply every repo migration, in order, to the TEST
 * Supabase project over its Postgres connection string.
 *
 *   node scripts/c1/apply-migrations.mjs
 *
 * Reads .env.test.local (never .env.local — this must not be pointable at
 * production by accident): C1_DATABASE_URL is the test project's connection
 * string (Dashboard → Connect → Direct connection / Session pooler).
 *
 * Idempotent: applied filenames are recorded in `_c1_migrations`; a re-run
 * applies only what's new. Each file runs in its own transaction and the
 * runner STOPS at the first failure, naming the file — fix forward, re-run.
 *
 * Two deliberate divergences from production, both documented in
 * docs/testing/c1-test-project.md:
 *   · 20260924 (listing photo) was run on prod then withdrawn from the repo —
 *     the test project simply never gets it (nothing references it).
 *   · Migrations that only ALTER TYPE ADD VALUE still run in their own file,
 *     exactly like the SQL-editor pastes did.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadTestEnv, refuseProduction } from "./env.mjs";
import pg from "pg";

loadTestEnv();
const url = process.env.C1_DATABASE_URL;
if (!url) {
  console.error("C1_DATABASE_URL missing from .env.test.local — the test project's connection string.");
  process.exit(1);
}
refuseProduction(url);

const MIG = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`create table if not exists public._c1_migrations (
  filename text primary key, applied_at timestamptz not null default now())`);

const { rows: done } = await client.query("select filename from public._c1_migrations");
const applied = new Set(done.map((r) => r.filename));

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(MIG, file), "utf8");
  process.stdout.write(`applying ${file} … `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public._c1_migrations (filename) values ($1)", [file]);
    await client.query("commit");
    console.log("ok");
    ran += 1;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`\n✗ ${file}\n  ${e.message}\n`);
    console.error("Nothing after this file was applied. Fix forward, then re-run.");
    await client.end();
    process.exit(1);
  }
}

const { rows: count } = await client.query("select count(*)::int as n from public._c1_migrations");
console.log(`\n${ran} newly applied · ${count[0].n} total on the test project · ${files.length} in the repo`);
await client.end();
