-- =============================================================================
-- 20270272 — every issued job sheet says how many, and how big
--
-- Tom, 15 Oct 2026: the contractor work order is not showing the number of
-- doors, windows etc per room or area, just labelling them Doors; this needs
-- to be updated for all areas with a number attached for the contractor to
-- see. And: there are also no measurements on the work orders.
--
-- The count (PR #275, 14 Oct) and, from today, the area dimensions are frozen
-- into builder_state woDoc by the builder IN THE BROWSER, on save. The issue
-- RPC copies that document into work_orders.wo_snapshot. So a sheet issued
-- from an estimate last saved before the deploy carries neither, and that is
-- every job currently on site. This migration closes both gaps at the
-- database, where the facts already are (builder_state blocks):
--
--   1. wo_doc_with_surface_counts(estimate_id, doc): a helper that fills, on
--      any surface that lacks one, the per-item count (the block surface
--      count, only where the rate item unit is Hours Per Item — the same
--      rule as the builder function countFor) and, on any area that lacks
--      them, the dims (the block L / W / H in metres; a single plane has W 0).
--      It never overwrites a value the builder froze, and never touches a
--      surface it cannot match by key (block id, colon, surface id).
--      The measured QUANTITY (m², lm) is NOT filled here: it is the pricing
--      module computeQuantity, which lives in lib/pricing and nowhere else.
--      New issues carry it from the builder; older sheets show the dimensions.
--   2. issue_work_order passes the document through the helper, so a work
--      order issued from a stale estimate still gets them.
--   3. Every existing wo_snapshot is backfilled once, in place.
--
-- The helper gets NO grant: issue_work_order is definer and the backfill is
-- this paste. Converges on a re-run (or-replace; the backfill only fills what
-- is missing).
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_doc_with_surface_counts(p_estimate_id uuid, p_doc jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_blocks jsonb; v_card uuid;
  v_areas jsonb := '[]'::jsonb; v_area jsonb; v_surfs jsonb; v_s jsonb;
  v_bid text; v_sid text; v_block jsonb; v_bs jsonb; v_type text; v_other text; v_unit text;
  v_count numeric; v_l numeric; v_w numeric; v_h numeric;
begin
  if p_doc is null or jsonb_typeof(p_doc -> 'areas') <> 'array' then return p_doc; end if;
  select builder_state -> 'blocks', rate_card_id into v_blocks, v_card
    from public.estimates where id = p_estimate_id;
  if v_blocks is null or jsonb_typeof(v_blocks) <> 'array' then return p_doc; end if;
  -- The estimate rate card, else the active one — as app/quote/page.tsx loads it.
  if v_card is null then
    select id into v_card from public.rate_cards where is_active order by created_at desc limit 1;
  end if;

  for v_area in select x from jsonb_array_elements(p_doc -> 'areas') x loop
    -- The block this area came from: areas are keyed by the block id.
    select b into v_block from jsonb_array_elements(v_blocks) b
     where b ->> 'kind' = 'area' and b ->> 'id' = v_area ->> 'id' limit 1;

    -- Dimensions, where the document has none and the block measured something.
    if v_block is not null and not (v_area ? 'dims') then
      v_l := coalesce(nullif(v_block ->> 'L', '')::numeric, 0);
      v_w := case when v_block ->> 'areaType' = 'surface' then 0 else coalesce(nullif(v_block ->> 'W', '')::numeric, 0) end;
      v_h := coalesce(nullif(v_block ->> 'H', '')::numeric, 0);
      if v_l > 0 or v_w > 0 or v_h > 0 then
        v_area := v_area || jsonb_build_object('dims', jsonb_build_object('l', v_l, 'w', v_w, 'h', v_h));
      end if;
    end if;

    v_surfs := '[]'::jsonb;
    for v_s in select y from jsonb_array_elements(coalesce(v_area -> 'surfaces', '[]'::jsonb)) y loop
      if v_s ? 'count' or (v_s ->> 'key') is null or position(':' in v_s ->> 'key') = 0 then
        v_surfs := v_surfs || v_s; continue;
      end if;
      v_bid := split_part(v_s ->> 'key', ':', 1);
      v_sid := split_part(v_s ->> 'key', ':', 2);
      v_bs := null;
      select b into v_block from jsonb_array_elements(v_blocks) b
       where b ->> 'kind' = 'area' and b ->> 'id' = v_bid limit 1;
      if v_block is not null then
        select s into v_bs from jsonb_array_elements(coalesce(v_block -> 'surfaces', '[]'::jsonb)) s
         where s ->> 'id' = v_sid limit 1;
      end if;
      v_count := case when v_bs is not null and jsonb_typeof(v_bs -> 'count') = 'number'
                      then (v_bs ->> 'count')::numeric else null end;
      if v_bs is null or v_count is null or v_count <= 0 or coalesce(v_bs ->> 'code', '') = '' then
        v_surfs := v_surfs || v_s; continue;
      end if;
      -- The rate item: the area side first, else the other side (C13), as itemIndex + priceSurface do.
      v_type := coalesce(v_block ->> 'type', 'Interior');
      v_other := case when v_type = 'Interior' then 'Exterior' else 'Interior' end;
      select unit into v_unit from public.rate_items
       where rate_card_id = v_card and category = v_type and code = v_bs ->> 'code' limit 1;
      if v_unit is null then
        select unit into v_unit from public.rate_items
         where rate_card_id = v_card and category = v_other and code = v_bs ->> 'code' limit 1;
      end if;
      if v_unit = 'Hours Per Item' then
        v_s := v_s || jsonb_build_object('count', round(v_count)::integer);
      end if;
      v_surfs := v_surfs || v_s;
    end loop;
    v_areas := v_areas || jsonb_set(v_area, '{surfaces}', v_surfs);
  end loop;
  return jsonb_set(p_doc, '{areas}', v_areas);
end $$;
revoke all on function public.wo_doc_with_surface_counts(uuid, jsonb) from public, anon, authenticated;

-- ---- 2. issuing fills them -----------------------------------------------------------
-- Body as 20260904000000_work_order_rpcs.sql, plus the one pass through the helper.
create or replace function public.issue_work_order(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_doc jsonb; v_pay integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;

  select builder_state->'woDoc' into v_doc from public.estimates where id = v_wo.estimate_id;
  if v_doc is null then return 'error:nothing_to_issue'; end if;   -- save the estimate first

  -- Counts and dimensions for the painter, from the estimate blocks (20270272).
  v_doc := public.wo_doc_with_surface_counts(v_wo.estimate_id, v_doc);

  -- Payment comes out of the stored document, never off the wire.
  v_pay := nullif(v_doc->>'contractorPaymentCents', '')::integer;

  update public.work_orders
     set wo_snapshot = jsonb_set(v_doc, '{status}', '"issued"'),
         contractor_payment_cents = coalesce(v_pay, contractor_payment_cents),
         status = case when status = 'draft' then 'issued'::public.wo_status else status end,
         issued_at = coalesce(issued_at, now())
   where id = p_work_order_id;

  return 'ok:issued';
end $$;
grant execute on function public.issue_work_order(uuid) to authenticated;

-- ---- 3. backfill every sheet already issued ------------------------------------------
update public.work_orders w
   set wo_snapshot = public.wo_doc_with_surface_counts(w.estimate_id, w.wo_snapshot)
 where w.wo_snapshot is not null
   and jsonb_typeof(w.wo_snapshot -> 'areas') = 'array'
   and exists (
     select 1 from jsonb_array_elements(w.wo_snapshot -> 'areas') a
     where not (a ? 'dims')
        or exists (select 1 from jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s where not (s ? 'count'))
   );

-- ---- Read-back: compare before calling it live ---------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_doc_with_surface_counts')          as helper_fns_expect_1,
  (select count(*) from public.work_orders where wo_snapshot is not null)              as sheets,
  (select count(*) from public.work_orders w where exists (
     select 1 from jsonb_array_elements(w.wo_snapshot -> 'areas') a,
                   jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s where s ? 'count')) as sheets_with_a_count,
  (select count(*) from public.work_orders w where exists (
     select 1 from jsonb_array_elements(w.wo_snapshot -> 'areas') a where a ? 'dims'))  as sheets_with_dims;

notify pgrst, 'reload schema';

insert into public._prod_migrations(name) values ('20270272000000_wo_snapshot_counts_dims.sql') on conflict (name) do nothing;
