-- =============================================================================
-- 12A Cavell Court, Tom 7 Oct 2026 — a painter's request priced in the
-- working scope IS that request, not a second row beside it.
--
-- What happened: Qudrat raised a variation; the office priced it from the
-- revision working scope; the customer signed. The pricing made a NEW
-- wo_variations row (revision_block_ref) and the painter's own row stayed at
-- 'raised' for ever — "with the office" on his portal, "to price" on the
-- console, and nothing on the job joined the two.
--
-- Now `wo_draft_revision_variation` takes `p_source_variation_id`: the raised
-- request the office opened the builder from. The first addition drafted
-- for it is written INTO that row — status priced, the block ref, the offer
-- token, the money — so the request's own record moves: with the customer,
-- approved, released to the painter to accept (20270220), accepted. One
-- record, every list and gate already understands it. `request_priced_at`
-- marks the adoption; a change that nets back to nothing puts the request
-- back to 'raised' instead of cancelling it.
--
-- The OLD 11-arg signature is dropped — one overload for PostgREST.
-- Converges on a re-run: drop-first, add column if not exists, idempotent grant.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wo_variations
  add column if not exists request_priced_at timestamptz;

drop function if exists public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric, integer);

create or replace function public.wo_draft_revision_variation(
  p_estimate_id uuid, p_block_ref text, p_category text, p_comment text,
  p_credit boolean, p_surface_keys text[], p_price_cents integer,
  p_inputs jsonb, p_priced_lines jsonb, p_hours numeric,
  p_contractor_rate_cents integer default null,
  p_source_variation_id uuid default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo uuid; v_v public.wo_variations%rowtype; v_src public.wo_variations%rowtype;
        v_rate integer; v_delta integer; v_token text; v_adopt boolean := false;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  if v_wo is null then return 'error:no_work_order'; end if;

  if coalesce(trim(p_block_ref), '') = '' then return 'error:no_block_ref'; end if;
  if coalesce(trim(p_category), '') = '' then return 'error:no_category'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  if p_price_cents is null or p_price_cents < 0 then return 'error:bad_price'; end if;
  if p_hours is null or p_hours < 0 then return 'error:bad_hours'; end if;

  select * into v_v
    from public.wo_variations
   where work_order_id = v_wo and revision_block_ref = p_block_ref
     and status = 'priced'
   for update;

  -- The change has netted back to nothing: retire any standing draft. A
  -- painter's request that was priced here goes back to 'raised' — it is
  -- still their question, just no longer priced.
  if p_price_cents = 0 and p_hours = 0 then
    if found then
      if v_v.request_priced_at is not null then
        update public.wo_variations
           set status = 'raised', revision_block_ref = null, customer_token = null,
               request_priced_at = null, priced_inputs = null, priced_lines = null,
               price_cents = null, contractor_rate_cents = null, contractor_delta_cents = null,
               surface_keys = null, credit = false
         where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
          values (v_wo, 'variation_request_unpriced', auth.uid(), 'staff',
                  jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref));
        return 'ok:cancelled';
      end if;
      update public.wo_variations set status = 'cancelled' where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_wo, 'variation_revision_cancelled', auth.uid(), 'staff',
                jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref));
      return 'ok:cancelled';
    end if;
    return 'ok:no_change';
  end if;

  -- The estimate's own rate when the caller knows it (the builder's
  -- "Contractor rate" override, via lib/pricing); the global rate otherwise.
  v_rate  := coalesce(nullif(p_contractor_rate_cents, 0), public.wo_contractor_rate_cents());
  v_delta := round(p_hours * v_rate)::integer;

  -- The painter's request this addition prices: still 'raised', on this job,
  -- not yet adopted by another block. Only an addition can be their request.
  if p_source_variation_id is not null and not p_credit then
    select * into v_src
      from public.wo_variations
     where id = p_source_variation_id and work_order_id = v_wo
       and status = 'raised' and request_priced_at is null
     for update;
    v_adopt := found;
  end if;

  if v_v.id is not null then
    -- A draft already stands for this block. If it was drafted before the
    -- office opened the builder from the request, the request takes it over:
    -- the orphan draft is cancelled and the request carries its token.
    if v_adopt and v_v.id <> v_src.id then
      update public.wo_variations set status = 'cancelled' where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_wo, 'variation_revision_cancelled', auth.uid(), 'staff',
                jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                                   'superseded_by_request', v_src.id));
      v_token := v_v.customer_token;
    else
      update public.wo_variations
         set category = trim(p_category),
             -- An adopted request keeps the painter's words; a plain draft takes the change title.
             comment = case when v_v.request_priced_at is not null then v_v.comment else trim(p_comment) end,
             credit = p_credit, surface_keys = p_surface_keys,
             price_cents = p_price_cents, priced_inputs = p_inputs,
             priced_lines = p_priced_lines, est_hours = p_hours,
             contractor_rate_cents = v_rate, contractor_delta_cents = v_delta
       where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_wo, 'variation_revision_updated', auth.uid(), 'staff',
                jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                                   'price_cents', p_price_cents, 'credit', p_credit,
                                   'hours', p_hours));
      return 'ok:' || v_v.customer_token;
    end if;
  end if;

  -- The open offer on this job, if there is one — the new draft joins it.
  if v_token is null then
    select customer_token into v_token
      from public.wo_variations
     where work_order_id = v_wo and status = 'priced'
       and revision_block_ref is not null and customer_token is not null
     order by created_at
     limit 1;
  end if;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  if v_adopt then
    -- The request becomes the priced change. The painter's words stay first
    -- on the record; the office's change title follows them.
    update public.wo_variations
       set status = 'priced', revision_block_ref = trim(p_block_ref), customer_token = v_token,
           request_priced_at = now(),
           category = trim(p_category),
           comment = trim(v_src.comment) || ' — ' || trim(p_comment),
           est_hours = p_hours, priced_inputs = p_inputs, priced_lines = p_priced_lines,
           price_cents = p_price_cents, contractor_rate_cents = v_rate,
           contractor_delta_cents = v_delta, credit = false, surface_keys = p_surface_keys
     where id = v_src.id
     returning * into v_v;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo, 'variation_priced', auth.uid(), 'staff',
              jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                                 'price_cents', p_price_cents, 'credit', false,
                                 'hours', p_hours, 'contractor_rate_cents', v_rate,
                                 'contractor_delta_cents', v_delta, 'revision', true,
                                 'request', true));
    return 'ok:' || v_token;
  end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment,
       est_hours, status, priced_inputs, priced_lines, price_cents,
       contractor_rate_cents, contractor_delta_cents, customer_token,
       credit, surface_keys, revision_block_ref)
    values
      (v_wo, auth.uid(), 'staff', false, trim(p_category), trim(p_comment),
       p_hours, 'priced', p_inputs, p_priced_lines, p_price_cents,
       v_rate, v_delta, v_token,
       p_credit, p_surface_keys, trim(p_block_ref))
    returning * into v_v;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_wo, 'variation_priced', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                               'price_cents', p_price_cents, 'credit', p_credit,
                               'hours', p_hours, 'contractor_rate_cents', v_rate,
                               'contractor_delta_cents', v_delta, 'revision', true));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric, integer, uuid) to authenticated;

-- ---- read-back: compare to the _expect_ column before calling this live ------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_draft_revision_variation') as draft_overloads, 1 as _expect_overloads,
  (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_draft_revision_variation' limit 1) as draft_args, 12 as _expect_args,
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_variations' and column_name = 'request_priced_at') as has_request_priced_at, true as _expect_col,
  has_function_privilege('authenticated',
    'public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric, integer, uuid)', 'execute') as authenticated_can_draft, true as _expect_grant;

insert into public._prod_migrations(name) values ('20270222000000_variation_request_priced_in_scope.sql') on conflict (name) do nothing;
