/**
 * C1 · re-apply ONE migration file to the TEST project, ignoring the
 * _c1_migrations ledger. For fix-forwards during a build session where the
 * file was edited after first application — every file in this repo is written
 * idempotent (if-not-exists / or-replace / drop-first), so a re-run converges.
 *
 *   node scripts/c1/reapply-one.mjs 20261116000000_variation_signature_working_scope.sql
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadTestEnv, refuseProduction } from "./env.mjs";

loadTestEnv();
const dbUrl = process.env.C1_DATABASE_URL;
if (!dbUrl) { console.error("C1_DATABASE_URL missing from .env.test.local."); process.exit(1); }
refuseProduction(dbUrl);

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/c1/reapply-one.mjs <migration filename>"); process.exit(1); }

const sql = readFileSync(resolve("supabase/migrations", file), "utf8");
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`re-applied ${file}`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
