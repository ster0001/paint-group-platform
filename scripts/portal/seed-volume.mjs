/**
 * 3a-8 · The volume dataset (⚑14 defaults): ~25k accounts / 30k properties /
 * 60k estimates / 20k work orders / 160k surfaces / 100k events / 500k photo
 * rows / 40k invoices / 20k payments — seeded into the C1 TEST project only
 * (the production tripwire refuses anything else), entirely server-side via
 * generate_series so the whole seed is minutes, not hours.
 *
 *   node scripts/portal/seed-volume.mjs           # seed (skips if present)
 *   node scripts/portal/seed-volume.mjs --reseed  # wipe vol-* rows and reseed
 *
 * Every seeded row is marked (emails vol-…@volume.example, paths vol/…,
 * tokens vol…) so a wipe can never touch fixture or real test data.
 */
import { loadTestEnv, refuseProduction } from "../c1/env.mjs";
import pg from "pg";

loadTestEnv();
const url = process.env.C1_DATABASE_URL;
if (!url) {
  console.error("C1_DATABASE_URL missing from .env.test.local");
  process.exit(1);
}
refuseProduction(url);
refuseProduction(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

const RESEED = process.argv.includes("--reseed");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SIZES = {
  accounts: 25_000,
  tradeAccounts: 500,
  extraProperties: 5_000, // beyond one-per-account
  estimates: 60_000,
  workOrders: 20_000,
  surfacesPerWo: 8,
  eventsPerWo: 5,
  photos: 500_000,
  invoices: 40_000,
  payments: 20_000,
};

async function run(label, sql) {
  const t0 = Date.now();
  const res = await client.query(sql);
  console.log(`${label.padEnd(34)} ${String(res.rowCount ?? "").padStart(8)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main() {
  await client.connect();
  const who = await client.query("select current_database()");
  console.log(`Seeding volume dataset into: ${who.rows[0].current_database} (C1)`);

  const { rows: [{ count: existing }] } = await client.query(
    "select count(*)::int as count from public.accounts where email like 'vol-%@volume.example'",
  );
  if (existing > 0 && !RESEED) {
    console.log(`Already seeded (${existing} vol accounts). Use --reseed to rebuild.`);
    await client.end();
    return;
  }
  if (existing > 0) {
    console.log("Wiping previous volume rows…");
    await run("wipe payments", "delete from public.payments where invoice_id in (select id from public.invoices where token like 'vol%')");
    await run("wipe invoices", "delete from public.invoices where token like 'vol%'");
    await run("wipe photos", "delete from public.wo_photos where storage_path like 'vol/%'");
    await run("wipe events", "delete from public.wo_events where work_order_id in (select id from public.work_orders where share_token like 'vol%')");
    await run("wipe surfaces", "delete from public.wo_surfaces where work_order_id in (select id from public.work_orders where share_token like 'vol%')");
    await run("wipe signoff", "delete from public.wo_signoff where work_order_id in (select id from public.work_orders where share_token like 'vol%')");
    await run("wipe warranties", "delete from public.warranties where work_order_id in (select id from public.work_orders where share_token like 'vol%')");
    await run("wipe work orders", "delete from public.work_orders where share_token like 'vol%'");
    await run("wipe estimates", "delete from public.estimates where account_id in (select id from public.accounts where email like 'vol-%@volume.example')");
    await run("wipe properties", "delete from public.properties where account_id in (select id from public.accounts where email like 'vol-%@volume.example')");
    await run("wipe memberships", "delete from public.account_users where account_id in (select id from public.accounts where email like 'vol-%@volume.example')");
    await run("wipe accounts", "delete from public.accounts where email like 'vol-%@volume.example'");
  }

  // ---- accounts ------------------------------------------------------------
  await run("accounts", `
    insert into public.accounts (email, name, account_type)
    select 'vol-' || i || '@volume.example',
           'Volume Customer ' || i,
           case when i <= ${SIZES.tradeAccounts} then 'trade' else 'residential' end
    from generate_series(1, ${SIZES.accounts}) i`);

  // ---- properties: one per account + extras for the trade portfolios ------
  await run("properties (one each)", `
    insert into public.properties (account_id, address, suburb, state, postcode, address_norm)
    select a.id, (row_number() over ()) || ' Volume Street', 'Northcote', 'VIC', '3070',
           (row_number() over ()) || ' volume street northcote 3070'
    from public.accounts a where a.email like 'vol-%@volume.example'`);
  await run("properties (trade extras)", `
    insert into public.properties (account_id, address, suburb, state, postcode, address_norm)
    select a.id, (10000000 + a.rn * 10 + gs.i) || ' Portfolio Road', 'Preston', 'VIC', '3072',
           (10000000 + a.rn * 10 + gs.i) || ' portfolio road preston 3072'
    from (select id, row_number() over () rn from public.accounts
           where account_type = 'trade' and email like 'vol-%@volume.example') a
    cross join generate_series(1, 10) gs(i)`);

  // ---- estimates -----------------------------------------------------------
  // Spread over accounts; a mix of statuses. Non-draft rows carry the level
  // of finish the CHECK demands. builder_state stays tiny — the volume laws
  // are about row counts and key shapes, not payload weight. A numbered temp
  // table keeps the modulo join O(n log n), never per-row offsets.
  // NOT a temp table: C1 connects through the transaction POOLER, where
  // server sessions are reused and "temporary" objects leak between runs.
  await run("numbering (scratch)", `
    drop table if exists public.vol_props;
    create unlogged table public.vol_props as
    select p.id, p.account_id, p.address, p.suburb,
           (row_number() over (order by p.id)) - 1 as rn
    from public.properties p
    join public.accounts a on a.id = p.account_id
    where a.email like 'vol-%@volume.example';
    create index on public.vol_props (rn)`);
  await run("estimates", `
    insert into public.estimates (account_id, property_id, title, status, level_of_finish,
                                  source, total_cents, accepted_total_cents, builder_state, share_token)
    select p.account_id, p.id,
           p.address || ', ' || p.suburb,
           s.status::public.estimate_status,
           case when s.status = 'draft' then null else 3 end,
           'manual',
           500000 + (gs.i % 400000),
           case when s.status = 'accepted' then 500000 + (gs.i % 400000) end,
           '{}'::jsonb,
           case when s.status in ('sent','accepted') then 'volest' || gs.i end
    from generate_series(1, ${SIZES.estimates}) gs(i)
    join public.vol_props p on p.rn = gs.i % (select count(*) from public.vol_props)
    cross join lateral (
      select case (gs.i % 4) when 0 then 'draft' when 1 then 'sent' else 'accepted' end as status
    ) s`);
  await run("numbering cleanup", "drop table if exists public.vol_props");

  // ---- work orders on a slice of accepted estimates ------------------------
  await run("work orders", `
    insert into public.work_orders (estimate_id, wo_ref, share_token, stage, status, issued_at,
                                    start_date, end_date, wo_snapshot)
    select e.id, 'WO-VOL' || e.rn, 'volwo' || e.rn,
           (case (e.rn % 10) when 0 then 'in_progress' when 1 then 'walkthrough' else 'closed' end)::public.wo_stage,
           (case (e.rn % 10) when 0 then 'in_progress' when 1 then 'in_progress' else 'complete' end)::public.wo_status,
           now() - ((e.rn % 300)::int) * interval '1 day',
           current_date - (e.rn % 300)::int, current_date - (e.rn % 300)::int + 5,
           '{"version":1,"areas":[]}'::jsonb
    from (select id, row_number() over (order by id) rn from public.estimates
           where status = 'accepted' and share_token like 'volest%') e
    where e.rn <= ${SIZES.workOrders}`);

  // ---- surfaces, events, photos -------------------------------------------
  await run("surfaces", `
    insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, sort, state)
    select w.id, 'Area ' || gs.i, '', 'Surface ' || gs.i, gs.i,
           (case when w.stage = 'closed' then 'done' when gs.i % 3 = 0 then 'prepped' else 'todo' end)::public.wo_surface_state
    from public.work_orders w cross join generate_series(1, ${SIZES.surfacesPerWo}) gs(i)
    where w.share_token like 'volwo%'`);

  await run("events", `
    insert into public.wo_events (work_order_id, type, from_stage, to_stage, actor_kind, meta, created_at)
    select w.id, 'stage_changed',
           'pre_start'::public.wo_stage, 'in_progress'::public.wo_stage, 'system',
           '{}'::jsonb, now() - (gs.i || ' hours')::interval
    from public.work_orders w cross join generate_series(1, ${SIZES.eventsPerWo}) gs(i)
    where w.share_token like 'volwo%'`);

  await run("photos (500k rows)", `
    insert into public.wo_photos (work_order_id, area, kind, storage_path, caption, created_at)
    select w.id, 'Area ' || (gs.i % ${SIZES.surfacesPerWo}),
           (case when gs.i % 5 = 0 then 'before' else 'progress' end)::public.wo_photo_kind,
           'vol/' || w.id || '/' || gs.i || '.jpg', '',
           now() - (gs.i % 240) * interval '1 hour'
    from public.work_orders w cross join generate_series(1, ${Math.ceil(SIZES.photos / SIZES.workOrders)}) gs(i)
    where w.share_token like 'volwo%'`);

  // ---- money ---------------------------------------------------------------
  await run("invoices", `
    insert into public.invoices (estimate_id, kind, status, number, token,
                                 subtotal_ex_cents, gst_cents, total_inc_cents, issued_on, due_on)
    select e.id,
           (case when e.rn % 2 = 0 then 'deposit' else 'final' end)::public.invoice_kind,
           (case when e.rn % 3 = 0 then 'paid' else 'issued' end)::public.invoice_status,
           'INV-VOL' || e.rn, 'volinv' || e.rn,
           90910, 9090, 100000,
           current_date - (e.rn % 300)::int, current_date - (e.rn % 300)::int + 14
    from (select id, row_number() over (order by id) rn from public.estimates
           where status = 'accepted' and share_token like 'volest%') e
    where e.rn <= ${SIZES.invoices / 2}
    union all
    select e.id, 'progress'::public.invoice_kind, 'issued'::public.invoice_status,
           'INV-VOLB' || e.rn, 'volinvb' || e.rn,
           45455, 4545, 50000,
           current_date - (e.rn % 300)::int, current_date - (e.rn % 300)::int + 14
    from (select id, row_number() over (order by id) rn from public.estimates
           where status = 'accepted' and share_token like 'volest%') e
    where e.rn <= ${SIZES.invoices / 2}`);

  await run("payments", `
    insert into public.payments (invoice_id, amount_cents, status, method, paid_on, receipt_number)
    select i.id, i.total_inc_cents, 'succeeded', 'bank_transfer', i.issued_on + 3, 'RCT-VOL' || i.rn
    from (select id, total_inc_cents, issued_on, row_number() over (order by id) rn
            from public.invoices where token like 'volinv%' and status = 'paid') i
    where i.rn <= ${SIZES.payments}`);

  await run("analyze", "analyze");

  const counts = await client.query(`
    select (select count(*) from public.accounts where email like 'vol-%@volume.example') accounts,
           (select count(*) from public.properties where account_id in (select id from public.accounts where email like 'vol-%@volume.example')) properties,
           (select count(*) from public.estimates where share_token like 'volest%' or (account_id in (select id from public.accounts where email like 'vol-%@volume.example'))) estimates,
           (select count(*) from public.work_orders where share_token like 'volwo%') work_orders,
           (select count(*) from public.wo_photos where storage_path like 'vol/%') photos,
           (select count(*) from public.invoices where token like 'vol%') invoices`);
  console.log("\nSeeded:", counts.rows[0]);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
