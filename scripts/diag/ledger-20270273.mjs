// READ-ONLY: is 20270273 (materials duplicate guard) on production?
import fs from "node:fs";
import pg from "pg";
const env = fs.readFileSync("/Users/tomroman/Documents/paint-group-platform/.env.local", "utf8");
const url = env.match(/^IMPORT_DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on" });
await c.connect();
const led = await c.query(`select name, applied_at from _prod_migrations where name like '20270273%' or name like '20270307%' order by 1`);
console.log(JSON.stringify(led.rows));
const fn = await c.query(`select position('differs' in pg_get_functiondef(oid)) > 0 as has_invoice_no_skip from pg_proc where proname = 'cost_intake_set_extraction'`);
console.log(JSON.stringify(fn.rows));
await c.end();
