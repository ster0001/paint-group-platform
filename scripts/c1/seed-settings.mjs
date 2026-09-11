/**
 * Replay captured `settings` rows into a project.
 *
 * The other half of `capture-settings.mjs` — see its header for why the
 * hand-set pricing settings cannot come from the repo.
 *
 * REFUSES TO WRITE TO PRODUCTION, like every other C1 tool. Upserts by key, so
 * it is safe to re-run and never deletes a key the file does not carry.
 *
 *   set -a; source .env.test.local; set +a
 *   node scripts/c1/seed-settings.mjs               # <- .c1-settings.json
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { refuseProduction } from "./env.mjs";

const url = process.env.C1_DATABASE_URL;
if (!url) {
  console.error("C1_DATABASE_URL missing — the target project's session-pooler connection string.");
  process.exit(1);
}
refuseProduction(url);

const file = process.argv[2] ?? ".c1-settings.json";
if (!existsSync(file)) {
  console.error(`${file} not found. Capture it first:\n\n    node scripts/c1/capture-settings.mjs\n`);
  process.exit(1);
}
const rows = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(rows) || !rows.every((r) => typeof r?.key === "string")) {
  console.error(`${file} is not a settings dump — expected [{key, value}, …].`);
  process.exit(1);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 });
await c.connect();
let written = 0;
for (const r of rows) {
  await c.query(
    "insert into public.settings (key, value) values ($1, $2::jsonb) " +
    "on conflict (key) do update set value = excluded.value",
    [r.key, JSON.stringify(r.value)],
  );
  written++;
}
// Read back, because a seed that reports success without checking is how the
// 40,313 invoices happened.
const { rows: after } = await c.query("select count(*)::int as n from public.settings");
await c.end();
console.log(`${written} settings rows written; the project now has ${after[0].n}.`);
if (after[0].n < rows.length) {
  console.error("FEWER rows than were sent — something rejected a write.");
  process.exit(1);
}
