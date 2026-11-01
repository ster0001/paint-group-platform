// READ-ONLY (default_transaction_read_only=on): what did the bills@ door do
// with the Viponds invoices? Last 14 days of cost_intake by day/source/status,
// the recent rows, every row mentioning Viponds, and the Viponds vendor.
import fs from "node:fs";
import pg from "pg";
const env = fs.readFileSync("/Users/tomroman/Documents/paint-group-platform/.env.local", "utf8");
const url = env.match(/^IMPORT_DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on" });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log("##", label); console.table(r.rows); }
  catch (e) { console.log("##", label, "ERR", e.message); }
};
await q("last 14 days by day/source/status", `select (created_at at time zone 'Australia/Melbourne')::date d, source, extract_status, status, count(*)::int n from cost_intake where created_at > now() - interval '14 days' group by 1,2,3,4 order by 1 desc, 2`);
await q("recent rows (10 days)", `select to_char(created_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') at, source, left(from_email,30) from_email, left(subject,48) subject, extract_status es, status, match_reason mr, left(coalesce(extracted->>'supplier',''),18) supplier, extracted->>'invoice_no' inv, extracted->>'total_cents' total, left(coalesce(extracted->>'error',''),40) err from cost_intake where created_at > now() - interval '10 days' order by created_at desc limit 80`);
await q("viponds / INV-110xx ever", `select to_char(created_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') at, source, left(from_email,30) from_email, left(subject,48) subject, extract_status es, status, duplicate_of is not null dup, extracted->>'invoice_no' inv, extracted->>'total_cents' total, resulting_type, resulting_id from cost_intake where from_email ilike '%vipond%' or subject ilike '%vipond%' or extracted::text ilike '%vipond%' or extracted->>'invoice_no' ilike '%1103%' or extracted->>'invoice_no' ilike '%1104%' order by created_at desc limit 30`);
await q("viponds vendor", `select id, name, sender_domains from vendors where name ilike '%vipond%'`);
await q("last email-door row", `select to_char(max(created_at) at time zone 'Australia/Melbourne','DD Mon HH24:MI') last_email_row from cost_intake where source='email'`);
await c.end();
