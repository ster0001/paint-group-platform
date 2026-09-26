-- =============================================================================
-- Remove three imported jobs from the platform (Tom, 26 Sep 2026): they were
-- brought over from Airtable / PaintScout but had already started on the old
-- system, so they stay there and go from here.
--
--   1/15 Copelen Street · 9 Adeline St Williamstown · 409/338 Murray St
--
-- TWO PASSES. Run PART A first and READ it: it must show exactly ONE estimate
-- per address (three rows), each with an imported quote number. Then copy the
-- three estimate ids into PART B and run it as ONE paste. Nothing in PART A
-- writes. The customer (accounts) rows are left alone — only the jobs go.
-- Photos in the wo-photos storage bucket are not removed by SQL (orphans only).
-- =============================================================================

-- ---------- PART A · what would go (read-only) ------------------------------
with pat as (
  select array['%15 Copelen%', '%Adeline St%', '%338 Murray%'] as p
),
hits as (
  select e.id as estimate_id, e.title, e.status, e.source,
         e.external_ref->>'quote_no' as quote_no,
         coalesce(e.sent_snapshot->>'jobAddress', e.builder_state->>'jobAddress', w.wo_snapshot->>'jobAddress') as address,
         e.account_id, w.id as work_order_id, w.wo_ref, w.stage, w.contractor_id
    from public.estimates e
    left join public.work_orders w on w.estimate_id = e.id, pat
   where coalesce(e.sent_snapshot->>'jobAddress', '') ilike any (pat.p)
      or coalesce(e.builder_state->>'jobAddress', '') ilike any (pat.p)
      or coalesce(w.wo_snapshot->>'jobAddress', '') ilike any (pat.p)
      or coalesce(e.title, '') ilike any (pat.p)
)
select h.*,
       (select count(*) from public.invoices i where i.estimate_id = h.estimate_id) as invoices,
       (select string_agg(i.status::text, ',') from public.invoices i where i.estimate_id = h.estimate_id) as invoice_statuses,
       (select count(*) from public.payments p join public.invoices i on i.id = p.invoice_id where i.estimate_id = h.estimate_id) as payments,
       (select count(*) from public.contractor_invoices ci where ci.work_order_id = h.work_order_id) as contractor_invoices,
       (select count(*) from public.job_costs jc where jc.work_order_id = h.work_order_id) as job_costs,
       (select count(*) from public.booking_offers bo where bo.work_order_id = h.work_order_id) as offers,
       (select count(*) from public.wo_photos ph where ph.work_order_id = h.work_order_id) as photos,
       (select count(*) from public.crm_import_keys k where k.row_id = h.estimate_id or k.row_id = h.work_order_id) as import_keys
  from hits h
 order by h.address;

-- ---------- PART B · the removal (paste as ONE block, after filling the ids) --
-- Fill v_estimates with the three estimate ids PART A showed. The block refuses
-- to run with more or fewer than three, so a wide match cannot slip through.
begin;
set local lock_timeout = '15s';
set local role service_role;   -- the invoice delete guard admits service_role only

do $$
declare
  v_estimates uuid[] := array[
    '00000000-0000-0000-0000-000000000000',   -- 1/15 Copelen Street
    '00000000-0000-0000-0000-000000000000',   -- 9 Adeline St Williamstown
    '00000000-0000-0000-0000-000000000000'    -- 409/338 Murray St
  ];
  v_wos uuid[]; v_invoices uuid[]; v_offers uuid[]; v_n integer;
begin
  if array_length(v_estimates, 1) <> 3 then raise exception 'expected exactly three estimate ids'; end if;
  select count(*) into v_n from public.estimates where id = any (v_estimates);
  if v_n <> 3 then raise exception 'only % of the three estimate ids exist — check PART A', v_n; end if;

  select coalesce(array_agg(id), '{}') into v_wos from public.work_orders where estimate_id = any (v_estimates);
  select coalesce(array_agg(id), '{}') into v_invoices from public.invoices where estimate_id = any (v_estimates);
  select coalesce(array_agg(id), '{}') into v_offers from public.booking_offers where work_order_id = any (v_wos);

  -- RESTRICT edges under the work orders (prod-purge-order, 6 Sep), then the money.
  delete from public.colour_records      where source_job_id = any (v_wos);
  delete from public.contractor_expenses where work_order_id = any (v_wos);
  delete from public.expense_preapprovals where work_order_id = any (v_wos);
  delete from public.job_costs           where work_order_id = any (v_wos);
  delete from public.contractor_invoices where work_order_id = any (v_wos);
  delete from public.defect_observations
   where estimate_source_id in (select id from public.estimate_sources where estimate_id = any (v_estimates));
  delete from public.credit_notes        where invoice_id = any (v_invoices);
  delete from public.invoices            where id = any (v_invoices);        -- payments cascade
  delete from public.external_approvals  where estimate_id = any (v_estimates);

  -- Automation bookkeeping keyed by id (no FK): claims, held messages, import keys.
  delete from public.automation_claims
   where entity_id = any (array_cat(array_cat(v_estimates::text[], v_wos::text[]), array_cat(v_invoices::text[], v_offers::text[])));
  delete from public.automation_holds    where work_order_id = any (v_wos) or estimate_id = any (v_estimates);
  delete from public.crm_import_keys     where row_id = any (v_estimates) or row_id = any (v_wos);

  -- The jobs themselves: the work orders (wo_* cascade), then the estimates
  -- (events, messages set-null, working scopes, follow-ups cascade).
  delete from public.work_orders where id = any (v_wos);
  delete from public.estimates   where id = any (v_estimates);

  raise notice 'removed % estimates, % work orders, % invoices, % offers', 3, coalesce(array_length(v_wos, 1), 0), coalesce(array_length(v_invoices, 1), 0), coalesce(array_length(v_offers, 1), 0);
end $$;

-- Read-back: every count 0 for the three addresses.
select
  (select count(*) from public.estimates e
    where coalesce(e.sent_snapshot->>'jobAddress', e.builder_state->>'jobAddress', '') ilike any (array['%15 Copelen%', '%Adeline St%', '%338 Murray%'])) as estimates_left, 0 as _expect_estimates_left,
  (select count(*) from public.work_orders w
    where coalesce(w.wo_snapshot->>'jobAddress', '') ilike any (array['%15 Copelen%', '%Adeline St%', '%338 Murray%'])) as work_orders_left, 0 as _expect_work_orders_left;

commit;
