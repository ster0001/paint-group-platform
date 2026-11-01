// READ-ONLY: 20270273 grants on production.
import fs from "node:fs";
import pg from "pg";
const env = fs.readFileSync("/Users/tomroman/Documents/paint-group-platform/.env.local", "utf8");
const url = env.match(/^IMPORT_DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on" });
await c.connect();
const r = await c.query(`select has_function_privilege('service_role', p.oid, 'execute') service_can_call, has_function_privilege('authenticated', p.oid, 'execute') authenticated_can_call, has_function_privilege('anon', p.oid, 'execute') anon_can_call from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cost_intake_set_extraction'`);
console.log(JSON.stringify(r.rows));
await c.end();
