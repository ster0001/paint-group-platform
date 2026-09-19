#!/usr/bin/env node
/**
 * C7c · test-project hygiene — the runner.
 *
 *   node scripts/c1/hygiene.mjs count    [--json] [--warn 5000] [--fail 20000]
 *   node scripts/c1/hygiene.mjs teardown --since <iso> [--budget-min 5] [--json]
 *   node scripts/c1/hygiene.mjs sweep    [--age-days 1] [--batch 1000] [--budget-min 20] [--lock-wait-min 12] [--json]
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
import { E2E_RUN_LOCK_KEY, sessionPooledUrl } from "./session-url.mjs";

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
           (select count(*) from public.estimates)::int as estimates,
           (select count(*) from public.accounts)::int as accounts,
           now() as now`);
  // estimates/accounts are REPORTED, never thresholded: the delete walk is
  // bounded by users, and these are what the users are carrying. They are the
  // number that actually tells you the project is filling up.
  return { anonymous: c.anonymous, e2eLogins: c.e2e_logins, estimates: c.estimates, accounts: c.accounts, now: new Date(c.now).toISOString() };
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
  // THE SWEEP YIELDS. It takes the e2e run lock, but only for one SLICE of the
  // delete at a time — seconds, not the whole run.
  //
  // Holding it for the full sweep was the obvious design and the wrong one: a
  // 45-minute backlog clear would refuse every e2e run that started underneath
  // it (`acquireRunLock` in e2e/run-lock.ts fails, it does not wait), so the
  // tidy-up job could take out a whole afternoon's CI. The asymmetry is the
  // point — a run is someone waiting for an answer, the sweep is housekeeping
  // that has all night. Housekeeping gives way.
  //
  // It is safe to work in slices because the AGE CUTOFF, not the lock, is what
  // keeps the sweep off a live run's rows: nothing younger than --age-days is
  // ever selected, and a run's rows are minutes old. The lock is belt to that
  // braces, so it only needs to cover the moment a delete is actually running.
  //
  // Only the sweep takes it at all. `teardown` is spawned BY global-teardown,
  // from a process that already holds this lock; taking it again there would
  // refuse the run its own cleanup.
  const days = Number(args["age-days"] ?? process.env.E2E_SWEEP_AGE_DAYS ?? DEFAULTS.sweepAgeDays);
  const batch = Number(args.batch ?? process.env.E2E_SWEEP_BATCH ?? DEFAULTS.batch);
  const where = `created_at < now() - ($1::int * interval '1 day')`;

  const lockClient = new pg.Client({
    connectionString: sessionPooledUrl(dbUrl),
    ssl: { rejectUnauthorized: false },
    application_name: "pg-hygiene-sweep-lock",
  });
  await lockClient.connect();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const takeLock = async () => Boolean((await lockClient.query("select pg_try_advisory_lock($1) as ok", [E2E_RUN_LOCK_KEY])).rows[0]?.ok);
  const dropLock = async () => { await lockClient.query("select pg_advisory_unlock($1)", [E2E_RUN_LOCK_KEY]).catch(() => {}); };

  // A budget for WAITING, spent across the whole sweep: it can ride out one
  // suite and carry on, but it never waits all night.
  let waitLeftMs = Math.max(0, Number(args["lock-wait-min"] ?? DEFAULTS.lockWaitMinutes)) * 60_000;
  let announcedWait = false;
  async function takeLockOrGiveWay() {
    if (await takeLock()) return true;
    if (!announcedWait) {
      announcedWait = true;
      log(`an e2e run holds the test project — giving way, up to ${Math.round(waitLeftMs / 60_000)} min of waiting in hand…`);
    }
    // Poll FAST. The gap the sweep is looking for is the one between a run's
    // teardown and the next run's global-setup, which on a busy afternoon is
    // seconds wide — a 15-second poll walked straight past them and the sweep
    // gave way for its whole budget without deleting a row (measured, 19 Sep).
    // The probe is one indexed `pg_try_advisory_lock`; two seconds is nothing.
    while (waitLeftMs > 0) {
      const t = Date.now();
      await sleep(Math.min(2_000, waitLeftMs));
      waitLeftMs -= Date.now() - t;
      if (await takeLock()) return true;
    }
    return false;
  }

  const before = await counts();
  let deleted = 0, gaveWay = false, exhausted = false, emptied = false;
  while (deleted < batch) {
    if (Date.now() - t0 >= budgetMs) { exhausted = true; break; }
    if (!(await takeLockOrGiveWay())) { gaveWay = true; break; }
    let res;
    try {
      res = await removeUsers(where, [days], Math.min(DEFAULTS.sliceUsers, batch - deleted), budgetMs - (Date.now() - t0), stats);
    } finally {
      // Released before the next select, and before the pause below, so a run
      // that is waiting on this lock gets it within a second or two.
      await dropLock();
    }
    deleted += res.deleted;
    if (res.exhausted) { exhausted = true; break; }
    if (res.selected === 0) { emptied = true; break; }
    await sleep(500);
  }

  // The @example.com accounts a run leaves behind, same courtesy.
  let accounts = { selected: 0, deleted: 0 };
  if (!gaveWay && Date.now() - t0 < budgetMs) {
    if (await takeLockOrGiveWay()) {
      try { accounts = await removeExampleAccounts(where, [days], batch, budgetMs - (Date.now() - t0), stats, t0); }
      finally { await dropLock(); }
    } else gaveWay = true;
  }

  const left = await leftCount(where, [days]);
  const seconds = (Date.now() - t0) / 1000;
  const line = summaryLine({ verb: `sweep (older than ${days}d, batch ${batch})`, deleted, left, seconds, byTable: stats });
  const why = gaveWay ? " · GAVE WAY to an e2e run" : exhausted ? " · TIME BUDGET HIT" : emptied ? " · nothing older left" : "";
  log(line + (accounts.selected ? ` · @example.com accounts ${accounts.deleted}/${accounts.selected}` : "") + why);
  const after = await counts();
  log(`users before ${before.anonymous + before.e2eLogins} → after ${after.anonymous + after.e2eLogins}`);
  if (json) console.log(JSON.stringify({ days, batch, deleted, left, accounts, seconds, before, after, gaveWay, exhausted, byTable: stats }));
  await lockClient.end().catch(() => {});
  await client.end();
  process.exit(EXIT.ok);
}
