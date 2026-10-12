// READ ONLY: the §3A.4 reconciliation baseline for the Payments merge
// (docs/briefs/claude-code-brief-payments-merge.md). Run it before Step 1 and
// after every step; any difference in a figure the build should not touch
// stops the build. Runs inside a READ ONLY transaction and writes nothing.
//
// Run from the MAIN checkout (it has .env.local and node_modules):
//   node ../paint-group-platform-payments/scripts/diag/payments-baseline.mjs --prod
// Without --prod it reads the test project (.env.test.local, C1_DATABASE_URL).
// Prints JSON; save it as the baseline and diff the next run against it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const pg = require("pg");
const prod = process.argv.includes("--prod");
const file = prod ? ".env.local" : ".env.test.local";
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const url = prod ? (env.IMPORT_DATABASE_URL || env.DATABASE_URL) : env.C1_DATABASE_URL;
if (!url) { console.error(`no connection string in ${file}`); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query("begin read only");
const q = async (sql) => (await c.query(sql)).rows;
const out = { target: prod ? "production" : "test", read_at: new Date().toISOString() };

// Customer invoices by state (overdue is derived, never stored).
out.invoices_by_status = await q(`
  select status::text, count(*)::int as n, coalesce(sum(total_inc_cents), 0)::bigint as total_inc_cents
    from public.invoices group by 1 order by 1`);

// Invoiced = issued and later, excluding draft and void (the ledger's rule).
out.totals = (await q(`
  with paid as (
    select invoice_id, sum(amount_cents) as paid from public.payments
     where status = 'succeeded' group by 1)
  select
    (select coalesce(sum(total_inc_cents), 0) from public.invoices where status not in ('draft', 'void'))::bigint as invoiced_cents,
    (select coalesce(sum(amount_cents), 0) from public.payments where status = 'succeeded')::bigint as paid_cents,
    (select coalesce(sum(greatest(i.total_inc_cents - coalesce(p.paid, 0), 0)), 0)
       from public.invoices i left join paid p on p.invoice_id = i.id
      where i.status in ('issued', 'sent', 'viewed', 'partially_paid'))::bigint as outstanding_cents,
    (select count(*) from public.invoices i left join paid p on p.invoice_id = i.id
      where i.status in ('issued', 'sent', 'viewed', 'partially_paid')
        and i.total_inc_cents - coalesce(p.paid, 0) > 0)::int as outstanding_invoices`))[0];

out.payments_by_status = await q(`
  select status::text, method, count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as amount_cents
    from public.payments group by 1, 2 order by 1, 2`);

out.contractor_invoices_by_status = await q(`
  select status::text, count(*)::int as n, coalesce(sum(total_inc_cents), 0)::bigint as total_inc_cents
    from public.contractor_invoices group by 1 order by 1`);

// Supplier documents: the intake queue, and what confirmed intake became.
out.cost_intake_by_status = await q(`
  select status, count(*)::int as n,
         coalesce(sum(nullif(extracted->>'total_cents', '')::bigint), 0)::bigint as extracted_total_cents
    from public.cost_intake group by 1 order by 1`);
out.material_costs = await q(`
  select (work_order_id is not null) as on_a_job, count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as amount_cents
    from public.material_costs group by 1 order by 1`);
out.job_costs_by_status_category = await q(`
  select status::text, category::text, count(*)::int as n,
         coalesce(sum(amount_ex_cents + gst_cents), 0)::bigint as amount_inc_cents
    from public.job_costs group by 1, 2 order by 1, 2`);

// Fingerprints: an md5 over every existing row's identity and money fields.
// A status moving because the business ran (a payment landed) changes these
// legitimately; a row the build altered or removed changes them too, so a
// changed fingerprint is a prompt to diff by id, not proof of a defect.
out.fingerprints = (await q(`
  select
    (select md5(coalesce(string_agg(id::text || status::text || coalesce(number, '') || total_inc_cents || coalesce(due_on::text, ''), ',' order by id), '')) from public.invoices) as invoices,
    (select md5(coalesce(string_agg(id::text || status::text || amount_cents || coalesce(receipt_number, ''), ',' order by id), '')) from public.payments) as payments,
    (select md5(coalesce(string_agg(id::text || status::text || total_inc_cents, ',' order by id), '')) from public.contractor_invoices) as contractor_invoices,
    (select md5(coalesce(string_agg(id::text || status, ',' order by id), '')) from public.cost_intake) as cost_intake,
    (select count(*) from public.invoice_events)::int as invoice_events_rows`))[0];

await c.query("rollback");
await c.end();
console.log(JSON.stringify(out, null, 2));
