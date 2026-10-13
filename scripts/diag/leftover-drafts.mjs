// READ ONLY — the leftover drafts already on a database (payments-merge brief
// §6.1, §6.2). From 20270261 no new ones are created; these existing rows stay
// hidden by rule until Tom approves deleting them (§3A.3). This lists them and
// PRINTS a guarded delete for Tom to paste after reading the list. It writes
// nothing itself (a `begin read only` transaction).
//
//   node ../paint-group-platform-drafts/scripts/diag/leftover-drafts.mjs --prod   (from the main checkout)
//   node scripts/diag/leftover-drafts.mjs                                          (the test project)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const pg = require("pg");
const prod = process.argv.includes("--prod");
const file = prod ? ".env.local" : ".env.test.local";
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const url = prod ? (env.IMPORT_DATABASE_URL || env.DATABASE_URL) : env.C1_DATABASE_URL;
if (!url) { console.error(`no connection string in ${file}`); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query("begin read only");
const { rows } = await c.query(`
  select i.id, i.kind::text as kind, i.total_inc_cents, i.created_at::date as drafted,
         coalesce(e.sent_snapshot->>'jobAddress', e.title, '?') as job,
         case when i.total_inc_cents = 0 then '6.1 $0 draft' else '6.2 deposit draft beside a final' end as why
    from public.invoices i
    join public.estimates e on e.id = i.estimate_id
   where i.status = 'draft'
     and (i.total_inc_cents = 0
          or (i.kind = 'deposit' and exists (
                select 1 from public.invoices f
                 where f.estimate_id = i.estimate_id and f.kind = 'final' and f.total_inc_cents > 0
                   and f.status not in ('void', 'written_off'))))
   order by why, job`);
await c.query("rollback");
await c.end();

console.log(`${prod ? "PRODUCTION" : "test"} — ${rows.length} leftover drafts`);
console.table(rows.map((r) => ({ why: r.why, job: r.job, kind: r.kind, total: `$${(Number(r.total_inc_cents) / 100).toFixed(2)}`, drafted: r.drafted, id: r.id })));
if (rows.length) {
  console.log("\n-- Paste only after Tom has approved the list above. Drafts only — a row sent since is skipped.");
  console.log("set lock_timeout = '15s';");
  console.log(`delete from public.invoices where status = 'draft' and id in (\n  ${rows.map((r) => `'${r.id}'`).join(",\n  ")}\n);`);
  console.log(`select count(*) as left_over from public.invoices where id in (${rows.map((r) => `'${r.id}'`).join(", ")});  -- expect 0`);
}
