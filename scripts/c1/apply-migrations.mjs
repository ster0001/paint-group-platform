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

/**
 * Split a `-- @no-transaction` migration into individual statements.
 *
 * Deliberately simple, because such a file is deliberately simple: an index
 * build plus its readback. Anything with a `$$` body (a function, a do block)
 * is refused rather than split wrongly — those belong in a normal
 * transactional migration anyway.
 */
function splitStatements(sql) {
  if (sql.includes("$$")) {
    throw new Error(
      "a @no-transaction migration must not contain a $$ body — " +
        "put functions and do-blocks in a normal (transactional) migration",
    );
  }
  const withoutComments = sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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

  // Some statements CANNOT run inside a transaction — CREATE INDEX
  // CONCURRENTLY is the one that matters here, and it matters a lot: the
  // non-concurrent form takes an ACCESS EXCLUSIVE lock, which on wo_photos
  // (500k rows, 143 MB) would block every write for the duration of the
  // build. A migration opts out by declaring it on its first lines:
  //
  //   -- @no-transaction
  //
  // Such a file gets no rollback, so keep it to ONE statement that is safe to
  // re-run — `create index concurrently if not exists`. A failed CONCURRENTLY
  // build leaves an INVALID index behind; the migration's own readback is
  // what catches that, which is why they end with one.
  const noTx = /^\s*--\s*@no-transaction\b/m.test(sql.slice(0, 2000));
  process.stdout.write(`applying ${file}${noTx ? " (no transaction)" : ""} … `);
  try {
    if (noTx) {
      // A multi-statement string is ONE simple query, and Postgres wraps those
      // in an implicit transaction — which is the very thing CONCURRENTLY
      // refuses. So send each statement on its own.
      for (const stmt of splitStatements(sql)) await client.query(stmt);
      await client.query("insert into public._c1_migrations (filename) values ($1)", [file]);
    } else {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public._c1_migrations (filename) values ($1)", [file]);
      await client.query("commit");
    }
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
