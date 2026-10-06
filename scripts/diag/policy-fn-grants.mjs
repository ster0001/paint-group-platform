// READ ONLY: every public.* function named inside an RLS policy, with whether
// authenticated / anon may execute it. A policy runs as the CALLER, so a helper
// it names with no grant fails the whole statement (30 Sep 2026). Reads
// .env.test.local (C1_DATABASE_URL) by default; pass --prod to read .env.local.
import { readFileSync } from "node:fs";
import pg from "pg";
const file = process.argv.includes("--prod") ? ".env.local" : ".env.test.local";
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const url = process.argv.includes("--prod") ? (env.IMPORT_DATABASE_URL || env.DATABASE_URL) : env.C1_DATABASE_URL;
if (!url) { console.error(`no connection string in ${file}`); process.exit(1); }
const c = new pg.Client({ connectionString: url }); await c.connect();
const r = await c.query(`
  with fns as (
    select p.oid, p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  pol as (select schemaname, tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as body from pg_policies)
  select f.proname || '(' || f.args || ')' as sig, f.prosecdef as definer,
         has_function_privilege('authenticated', f.oid, 'execute') as authenticated_ok,
         has_function_privilege('anon', f.oid, 'execute') as anon_ok,
         (select string_agg(distinct pol.schemaname || '.' || pol.tablename, ', ') from pol where position(f.proname || '(' in pol.body) > 0) as used_by
    from fns f
   where exists (select 1 from pol where position(f.proname || '(' in pol.body) > 0)
   order by authenticated_ok, sig`);
for (const row of r.rows) console.log(row.authenticated_ok ? "ok  " : "NO  ", row.sig, row.definer ? "definer" : "invoker", "| anon", row.anon_ok, "|", row.used_by);
console.log("-- wo-photos bucket:", JSON.stringify((await c.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'wo-photos'")).rows));
console.log("-- wo-photos policies:", JSON.stringify((await c.query("select policyname, cmd, roles::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual,'') || coalesce(with_check,'')) like '%wo-photos%' order by 1")).rows));
console.log("-- RPCs the photo route calls:", JSON.stringify((await c.query("select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('wo_is_my_job_as_contractor','wo_record_photo','wo_record_reference_photo','wo_photo_access') order by 1")).rows));
console.log("-- applied 202702xx migrations:", JSON.stringify((await c.query("select name from public._prod_migrations where name like '202702%' order by 1")).rows.map((x) => x.name)));
await c.end();
