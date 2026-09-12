#!/usr/bin/env node
/**
 * C7c · test-project hygiene — the runner.
 *
 *   node scripts/c1/hygiene.mjs count    [--json] [--warn 5000] [--fail 20000]
 *   node scripts/c1/hygiene.mjs teardown --since <iso> [--budget-min 5] [--json]
 *   node scripts/c1/hygiene.mjs sweep    [--age-days 3] [--batch 200] [--budget-min 20] [--json]
 *
 * ONE implementation, three triggers: the tripwire at the start of every e2e
 * run (count), the teardown after every run (this run's users, by marker),
 * and the scheduled sweep (anything older than N days that a cancelled or
 * crashed run left behind). Same guard, same exclusion list, same delete.
 *
 * Why direct Postgres and not the admin API: the auth admin API cannot count
 * without paging every user, and cannot delete in an order the 51-column
 * fan-out from auth.users allows. The connection string is the test
 * project's — E2E_DATABASE_URL in CI, C1_DATABASE_URL locally — and
 * `checkTarget` refuses anything it cannot prove is that project.
 *
 * THE DELETE WALK is catalog-driven, not a hand-written list: it reads every
 * foreign key from pg_constraint and applies `fkAction` (hygiene-rules.mjs).
 * A hand-written order was right on the day it was written and wrong the
 * day after the next migration; this one is right for whatever the schema is
 * when it runs. Six columns reference auth.users with NO ACTION, so the
 * estimate chain goes first, then the user — see OWNED in the rules.
 */
import pg from "pg";
import { productionRef } from "./env.mjs";
import { checkTarget, DEFAULTS, EXIT, fkAction, parseArgs, seededExclusion, summaryLine, verdict } from "./hygiene-rules.mjs";

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const json = args.json === true;
const log = (s) => console.error(s);

if (!["count", "teardown", "sweep"].includes(cmd ?? "")) {
  log("usage: hygiene.mjs count|teardown|sweep [--json] …");
  process.exit(EXIT.error);
}

// ---- the guard -------------------------------------------------------------
const dbUrl = process.env.E2E_DATABASE_URL || process.env.C1_DATABASE_URL || "";
const target = checkTarget({ dbUrl, siteUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, productionRef: productionRef() });
if (!target.ok) {
  log(`REFUSED: ${target.reason}`);
  process.exit(EXIT.refused);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
// A single statement may not hang the job; the walk is chunked so 2 minutes is generous.
await client.query("set statement_timeout = '120s'");
const q = async (text, params = []) => (await client.query(text, params)).rows;

// ---- counts (the tripwire) -------------------------------------------------
async function counts() {
  const [c] = await q(`
    select (select count(*) from auth.users where is_anonymous)::int as anonymous,
           (select count(*) from auth.users where email like 'pg.e2e.%')::int as e2e_logins,
           now() as now`);
  return { anonymous: c.anonymous, e2eLogins: c.e2e_logins, now: new Date(c.now).toISOString() };
}

if (cmd === "count") {
  const c = await counts();
  const v = verdict(c, {
    warnRows: Number(args.warn ?? process.env.E2E_TRIPWIRE_WARN ?? DEFAULTS.warnRows),
    failRows: Number(args.fail ?? process.env.E2E_TRIPWIRE_FAIL ?? DEFAULTS.failRows),
  });
  log(v.line);
  if (v.level === "warn") log(`::warning::test project is filling up (${v.total.toLocaleString("en-AU")} run-created users). The sweep (scripts/c1/hygiene.mjs sweep, .github/workflows/hygiene.yml) should be bringing this down.`);
  if (v.level === "fail") log(`::error::test project has ${v.total.toLocaleString("en-AU")} run-created users — over the fail threshold. Run the sweep: node scripts/c1/hygiene.mjs sweep (or trigger .github/workflows/hygiene.yml). This is the 11 Sep outage's leading indicator.`);
  if (json) console.log(JSON.stringify({ ...c, level: v.level, total: v.total, ref: target.ref }));
  await client.end();
  process.exit(v.level === "fail" ? EXIT.tripwire : EXIT.ok);
}

// ---- the exclusion list ----------------------------------------------------
const seededEmails = ["E2E_STAFF_EMAIL", "E2E_CONTRACTOR_EMAIL", "E2E_CUSTOMER_EMAIL"]
  .map((k) => (process.env[k] ?? "").trim().toLowerCase()).filter(Boolean);
if (seededEmails.length === 0) {
  log("REFUSED: no E2E_*_EMAIL in the environment — the seeded logins cannot be excluded, so nothing is deleted.");
  await client.end();
  process.exit(EXIT.refused);
}
const seededRows = await q("select id, email from auth.users where lower(email) = any($1)", [seededEmails]);
let excluded;
try {
  excluded = seededExclusion(seededRows);
} catch (e) {
  log(String(e.message ?? e));
  await client.end();
  process.exit(EXIT.refused);
}
const missingSeeds = seededEmails.filter((e) => !seededRows.some((r) => r.email.toLowerCase() === e));
if (missingSeeds.length) log(`note: seeded login(s) not present on this project (nothing to protect, nothing deleted): ${missingSeeds.join(", ")}`);

// ---- the catalog -----------------------------------------------------------
/** parent "schema.table" → [{ child, column, rule, nullable, childPk }] */
const catalog = new Map();
{
  const rows = await q(`
    select pn.nspname || '.' || p.relname as parent,
           cn.nspname || '.' || c.relname as child,
           a.attname as column,
           case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                                when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as rule,
           not a.attnotnull as nullable,
           (select pa.attname from pg_index i join pg_attribute pa on pa.attrelid = i.indrelid and pa.attnum = i.indkey[0]
             where i.indrelid = c.oid and i.indisprimary and array_length(i.indkey::int[], 1) = 1) as child_pk
      from pg_constraint con
      join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
      join pg_class c on c.oid = con.conrelid join pg_namespace cn on cn.oid = c.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f' and array_length(con.conkey, 1) = 1
       and pn.nspname in ('public', 'auth') and cn.nspname in ('public', 'auth')`);
  for (const r of rows) {
    if (!catalog.has(r.parent)) catalog.set(r.parent, []);
    catalog.get(r.parent).push({ child: r.child, column: r.column, rule: r.rule, nullable: r.nullable, childPk: r.child_pk });
  }
}
const pkOf = new Map();
for (const [, fks] of catalog) for (const fk of fks) if (fk.childPk) pkOf.set(fk.child, fk.childPk);
pkOf.set("auth.users", "id");
pkOf.set("public.accounts", "id");

const ident = (name) => name.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");

/**
 * Delete `ids` from `table` after clearing everything that would refuse.
 * `deleteSelf=false` means Postgres will cascade the rows itself; we only
 * clear their restricting children.
 */
async function purge(table, ids, deleteSelf, stats, depth = 0, trail = []) {
  if (ids.length === 0) return;
  if (depth > 14) throw new Error(`FK walk too deep at ${table} (via ${trail.join(" → ")})`);
  for (const fk of catalog.get(table) ?? []) {
    const action = fkAction(fk);
    if (action === "leave") continue;
    const col = `"${fk.column}"`;
    if (action === "nullify") {
      await client.query(`update ${ident(fk.child)} set ${col} = null where ${col} = any($1)`, [ids]);
      continue;
    }
    const childPk = pkOf.get(fk.child);
    if (!childPk) {
      // No single-column primary key: nothing hangs off such a table by FK, so
      // a direct delete is the whole job (join tables, per-row settings).
      if (action === "purge") {
        const r = await client.query(`delete from ${ident(fk.child)} where ${col} = any($1)`, [ids]);
        stats[fk.child] = (stats[fk.child] ?? 0) + r.rowCount;
      }
      continue;
    }
    // A self-reference with the same ids would loop; a self-reference with
    // different ids (a tree) is handled by the depth guard.
    const childIds = (await q(`select "${childPk}" as id from ${ident(fk.child)} where ${col} = any($1)`, [ids])).map((r) => r.id);
    if (childIds.length === 0) continue;
    if (fk.child === table && childIds.every((id) => ids.includes(id))) continue;
    await purge(fk.child, childIds, action === "purge", stats, depth + 1, [...trail, `${table}.${fk.column}`]);
  }
  if (deleteSelf) {
    const pk = pkOf.get(table) ?? "id";
    const r = await client.query(`delete from ${ident(table)} where "${pk}" = any($1)`, [ids]);
    stats[table] = (stats[table] ?? 0) + r.rowCount;
  }
}

// ---- selecting whom to remove ----------------------------------------------
/** Users a run makes: anonymous customers, and pg.e2e.* logins. Nothing else, ever. */
const RUN_USER = "(is_anonymous or email like 'pg.e2e.%')";

async function removeUsers(where, params, cap, budgetMs, stats) {
  const started = Date.now();
  let deleted = 0;
  let exhausted = false;
  const ids = (await q(
    `select id from auth.users where ${RUN_USER} and ${where} and id <> all($${params.length + 1}) order by created_at asc limit ${Number(cap)}`,
    [...params, excluded],
  )).map((r) => r.id);
  for (let i = 0; i < ids.length; i += DEFAULTS.chunk) {
    if (Date.now() - started > budgetMs) { exhausted = true; break; }
    const chunk = ids.slice(i, i + DEFAULTS.chunk);
    await client.query("begin");
    try {
      await purge("auth.users", chunk, true, stats);
      await client.query("commit");
      deleted += chunk.length;
    } catch (e) {
      await client.query("rollback");
      log(`chunk failed (${chunk.length} users, kept): ${e.message}`);
      // Fall back to one at a time so one bad row does not hide 24 good ones.
      for (const id of chunk) {
        if (Date.now() - started > budgetMs) { exhausted = true; break; }
        await client.query("begin");
        try { await purge("auth.users", [id], true, stats); await client.query("commit"); deleted += 1; }
        catch (e2) { await client.query("rollback"); log(`user ${id} kept: ${e2.message}`); }
      }
    }
  }
  return { selected: ids.length, deleted, exhausted };
}

/** Accounts the drives create for anonymous customers (@example.com), with everything RESTRICTed to them. */
async function removeExampleAccounts(where, params, cap, budgetMs, stats, started) {
  const ids = (await q(
    `select id from public.accounts where email like '%@example.com' and ${where} order by created_at asc limit ${Number(cap)}`,
    params,
  )).map((r) => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += DEFAULTS.chunk) {
    if (Date.now() - started > budgetMs) break;
    const chunk = ids.slice(i, i + DEFAULTS.chunk);
    await client.query("begin");
    try { await purge("public.accounts", chunk, true, stats); await client.query("commit"); deleted += chunk.length; }
    catch (e) { await client.query("rollback"); log(`account chunk kept: ${e.message}`); }
  }
  return { selected: ids.length, deleted };
}

async function leftCount(where, params) {
  const [r] = await q(`select count(*)::int as n from auth.users where ${RUN_USER} and ${where} and id <> all($${params.length + 1})`, [...params, excluded]);
  return r.n;
}

const t0 = Date.now();
const stats = {};
const budgetMs = Number(args["budget-min"] ?? (cmd === "teardown" ? 5 : DEFAULTS.budgetMinutes)) * 60_000;

if (cmd === "teardown") {
  const since = String(args.since ?? process.env.E2E_RUN_STARTED_AT ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(since)) {
    log("REFUSED: teardown needs --since <iso timestamp> — the run marker global-setup recorded. A teardown with no marker would delete by pattern over all time, which is how a fixture gets deleted.");
    await client.end();
    process.exit(EXIT.refused);
  }
  const where = "created_at >= $1::timestamptz";
  const before = await counts();
  const users = await removeUsers(where, [since], 5000, budgetMs, stats);
  const accounts = await removeExampleAccounts(where, [since], 5000, budgetMs, stats, t0);
  const left = await leftCount(where, [since]);
  const seconds = (Date.now() - t0) / 1000;
  const line = summaryLine({ verb: `teardown (since ${since})`, created: users.selected, deleted: users.deleted, left, seconds, byTable: stats });
  log(line + (accounts.selected ? ` · @example.com accounts ${accounts.deleted}/${accounts.selected}` : "") + (users.exhausted ? " · TIME BUDGET HIT" : ""));
  const after = await counts();
  log(`users before ${before.anonymous + before.e2eLogins} → after ${after.anonymous + after.e2eLogins}`);
  if (json) console.log(JSON.stringify({ since, created: users.selected, deleted: users.deleted, left, accounts, seconds, before, after, byTable: stats }));
  await client.end();
  process.exit(EXIT.ok);
}

if (cmd === "sweep") {
  const days = Number(args["age-days"] ?? process.env.E2E_SWEEP_AGE_DAYS ?? DEFAULTS.sweepAgeDays);
  const batch = Number(args.batch ?? process.env.E2E_SWEEP_BATCH ?? DEFAULTS.batch);
  const where = `created_at < now() - ($1::int * interval '1 day')`;
  const before = await counts();
  const users = await removeUsers(where, [days], batch, budgetMs, stats);
  const accounts = await removeExampleAccounts(where, [days], batch, budgetMs, stats, t0);
  const left = await leftCount(where, [days]);
  const seconds = (Date.now() - t0) / 1000;
  const line = summaryLine({ verb: `sweep (older than ${days}d, batch ${batch})`, deleted: users.deleted, left, seconds, byTable: stats });
  log(line + (accounts.selected ? ` · @example.com accounts ${accounts.deleted}/${accounts.selected}` : "") + (users.exhausted ? " · TIME BUDGET HIT" : ""));
  const after = await counts();
  log(`users before ${before.anonymous + before.e2eLogins} → after ${after.anonymous + after.e2eLogins}`);
  if (json) console.log(JSON.stringify({ days, batch, deleted: users.deleted, left, accounts, seconds, before, after, byTable: stats }));
  await client.end();
  process.exit(EXIT.ok);
}
