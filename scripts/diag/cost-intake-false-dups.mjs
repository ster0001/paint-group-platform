// READ-ONLY: duplicate-flagged rows whose invoice number DIFFERS from the row
// they were flagged against, and whose invoice number was never confirmed
// anywhere — the signature of guard (b) hiding a real invoice.
import fs from "node:fs";
import pg from "pg";
const env = fs.readFileSync("/Users/tomroman/Documents/paint-group-platform/.env.local", "utf8");
const url = env.match(/^IMPORT_DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on" });
await c.connect();
const r = await c.query(`
  select to_char(a.created_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') at,
         left(a.extracted->>'supplier',22) supplier, a.extracted->>'invoice_no' inv, a.extracted->>'invoice_date' inv_date,
         (nullif(a.extracted->>'total_cents','')::bigint)::numeric/100 total,
         left(a.subject,44) subject,
         b.extracted->>'invoice_no' flagged_against,
         a.confirmed_at is not null dismissed,
         exists (select 1 from cost_intake x where x.id <> a.id and x.status='confirmed'
                   and lower(coalesce(x.extracted->>'invoice_no','')) = lower(coalesce(a.extracted->>'invoice_no',''))) confirmed_elsewhere
    from cost_intake a join cost_intake b on b.id = a.duplicate_of
   where a.status = 'duplicate'
     and coalesce(a.extracted->>'invoice_no','') <> ''
     and lower(coalesce(a.extracted->>'invoice_no','')) <> lower(coalesce(b.extracted->>'invoice_no',''))
   order by a.created_at desc`);
console.table(r.rows);
await c.end();
