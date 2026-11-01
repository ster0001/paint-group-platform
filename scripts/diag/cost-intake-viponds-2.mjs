// READ-ONLY: the duplicate chain for the Viponds rows + the confirmed job cost.
import fs from "node:fs";
import pg from "pg";
const env = fs.readFileSync("/Users/tomroman/Documents/paint-group-platform/.env.local", "utf8");
const url = env.match(/^IMPORT_DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on" });
await c.connect();
const q = async (label, sql) => { try { const r = await c.query(sql); console.log("##", label); console.table(r.rows); } catch (e) { console.log("##", label, "ERR", e.message); } };
await q("viponds rows + what they duplicate", `select to_char(a.created_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') at, left(a.subject,40) subject, a.extracted->>'invoice_no' inv, a.extracted->>'invoice_date' inv_date, a.status, to_char(a.confirmed_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') decided, a.match_reason mr, a.proposed_wo_id is not null has_wo, to_char(b.created_at at time zone 'Australia/Melbourne','DD Mon HH24:MI') dup_of_at, b.extracted->>'invoice_no' dup_of_inv, b.status dup_of_status from cost_intake a left join cost_intake b on b.id = a.duplicate_of where a.extracted::text ilike '%vipond%' order by a.created_at desc`);
await q("confirmed job cost 6da1", `select jc.id, jc.amount_cents, jc.invoice_no, jc.invoice_date, jc.status, jc.created_at::date, w.job_no, w.wo_snapshot->>'jobAddress' address from job_costs jc left join work_orders w on w.id = jc.wo_id where jc.id = '6da1da4f-68c9-4542-97da-8f10ea142436'`);
await q("any material_cost / job_cost with INV-11043", `select 'job_cost' t, id, amount_cents, invoice_no from job_costs where invoice_no ilike '%11043%' union all select 'material_cost', id, amount_cents, coalesce(invoice_no,'') from material_costs where invoice_no ilike '%11043%'`);
await q("cost intake settings", `select value from settings where key ilike '%cost_intake%'`);
await c.end();
