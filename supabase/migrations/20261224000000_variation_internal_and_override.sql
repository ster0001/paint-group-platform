-- Tom's 1 Sep batch #2 — the internal variation + the contractor-amount override.
--
-- 1. wo_approve_variation_internal: approve a contractor-raised variation FOR
--    THE CONTRACTOR without sending it to the client — the painter gets paid,
--    the client is charged nothing and never sees it. Mechanically it lands at
--    customer_approved with price_cents = 0, no customer_token, released
--    immediately, priced_inputs.internal = true (the marker every customer
--    surface filters on). The precedent is invoice_record_drift_as_variation
--    (20261113) — an approved variation born with no token and no signature.
-- 2. wo_set_variation_contractor_amount: staff override of what the contractor
--    receives for a variation, any time before they accept it.
-- 3. estimate_changes_by_token: internal variations never render on /e.
--    Body copied from 20261120 verbatim + the one filter line.
-- 4. invoice_draft_final: internal ($0) variations never print a $0 line on
--    the final invoice. Body copied from 20261113 verbatim + the one filter
--    (arithmetically a no-op — the line was $0 — so the balancing logic is
--    untouched).

-- ---- 1. approve internally -------------------------------------------------
create or replace function public.wo_approve_variation_internal(
  p_variation_id uuid, p_contractor_cents integer, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_contractor_cents is null or p_contractor_cents < 0 then return 'error:bad_amount'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.credit then return 'error:not_for_credits'; end if;
  if v_v.status not in ('raised', 'priced') then return 'error:already_answered'; end if;

  update public.wo_variations
     set status = 'customer_approved',
         customer_responded_at = now(),
         price_cents = 0,                      -- the client is charged nothing
         customer_token = null,                -- and there is nothing to sign
         released_at = now(),                  -- straight to the painter
         released_by = auth.uid(),
         contractor_delta_cents = p_contractor_cents,
         priced_inputs = coalesce(priced_inputs, '{}'::jsonb)
           || jsonb_build_object('internal', true, 'internal_note', coalesce(trim(p_note), ''))
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_internal_approved', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id,
                               'contractor_cents', p_contractor_cents,
                               'note', coalesce(trim(p_note), '')));
  return 'ok:approved_internal';
end $$;
grant execute on function public.wo_approve_variation_internal(uuid, integer, text) to authenticated;

-- ---- 2. override the contractor's amount ------------------------------------
create or replace function public.wo_set_variation_contractor_amount(
  p_variation_id uuid, p_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_cents is null or p_cents < 0 then return 'error:bad_amount'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.credit then return 'error:use_deduction'; end if;      -- credits: wo_set_variation_deduction
  if v_v.contractor_accepted_at is not null then return 'error:already_accepted'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_amount_set', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id,
                               'from_cents', v_v.contractor_delta_cents, 'to_cents', p_cents));

  update public.wo_variations set contractor_delta_cents = p_cents where id = p_variation_id;
  return 'ok:set';
end $$;
grant execute on function public.wo_set_variation_contractor_amount(uuid, integer) to authenticated;

-- ---- 3. /e changes: internal variations never render ------------------------
create or replace function public.estimate_changes_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when e.status = 'accepted' then jsonb_build_object(
    'accepted_total_cents', l.accepted_total_cents,
    'adjusted_total_cents', l.adjusted_contract_cents,
    'variations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'comment', v.comment,
               'category', v.category,
               'price_cents', v.price_cents,
               'credit', v.credit,
               'status', v.status::text,
               'signed_name', v.signed_name,
               'signed_at', v.signed_at,
               -- the signing link, only while it still needs their signature
               'token', case when v.status = 'priced' then v.customer_token end
             ) order by v.created_at)
        from public.wo_variations v
        join public.work_orders w on w.id = v.work_order_id
       where w.estimate_id = e.id
         and v.price_cents is not null
         and v.status in ('priced', 'customer_approved', 'contractor_accepted')
         -- internal approvals are the office's arrangement with the painter
         and not coalesce((v.priced_inputs->>'internal')::boolean, false)
    ), '[]'::jsonb)
  ) end
  from public.estimates e
  cross join lateral public.invoice_ledger(e.id) l
  where e.share_token = p_token
$$;
grant execute on function public.estimate_changes_by_token(text) to anon, authenticated;

-- ---- 4. final invoice: no $0 internal lines ---------------------------------
-- BODY BASIS: 20261113 VERBATIM — the ONLY change is the internal filter in
-- the variations loop.
create or replace function public.invoice_draft_final(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_est public.estimates%rowtype; v_wo uuid; v_snap jsonb; v_led record;
        v_rate numeric; v_total bigint; v_gst integer; v_ex bigint;
        v_inv uuid; r jsonb; v_sort integer := 0; v_sum_ex bigint := 0;
        v_areas_ex bigint := 0; v_lines_ex bigint := 0; v_opts_ex bigint := 0;
        v_base bigint; v_sundries bigint; v_discount bigint := 0; v_line_ex bigint;
        v_prev text; v_bal bigint; v_vdesc text;
  v public.wo_variations%rowtype;
begin
  select * into v_est from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  v_snap := coalesce(v_est.sent_snapshot, '{}'::jsonb);
  v_rate := public.invoice_setting_num('{gstRatePct}', 10);

  -- A fresh draft replaces any standing draft final (re-sign after reopen,
  -- variation approved between prep and sign-off, …).
  delete from public.invoices
   where estimate_id = p_estimate_id and kind = 'final' and status = 'draft';

  select * into v_led from public.invoice_ledger(p_estimate_id);
  v_total := greatest(v_led.adjusted_contract_cents - v_led.invoiced_cents, 0);
  v_gst := public.gst_from_inc_cents(v_total, v_rate);
  v_ex := v_total - v_gst;

  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
                               token, created_by)
    values (p_estimate_id, v_est.customer_id, v_wo, 'final', 'draft',
            v_total::integer, v_ex::integer, v_gst, v_total::integer,
            public.invoice_new_token(), auth.uid())
    returning id into v_inv;

  -- Contract works, exactly as the accepted document reads them.
  for r in select value from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_areas_ex := v_areas_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_lines_ex := v_lines_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Sundries: baseSubtotalCents = included items + sundries (ex GST), so the
  -- residual over the itemised lines is the sundries figure.
  v_base := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_areas_ex + v_lines_ex);
  v_sundries := v_base - v_areas_ex - v_lines_ex;
  if v_sundries > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'Sundries & consumables', v_sundries::integer);
    v_sort := v_sort + 1;
  end if;

  -- The options the customer selected at acceptance. (Hardened: an
  -- object-shaped selected_options counts as "none selected", not an error.)
  for r in select value from jsonb_array_elements(coalesce(v_snap->'options', '[]'::jsonb))
            where (value->>'id') in (
              select jsonb_array_elements_text(
                case when jsonb_typeof(v_est.selected_options) = 'array'
                     then v_est.selected_options else '[]'::jsonb end))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_opts_ex := v_opts_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') || ' (selected option)', v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Discount — the engine's own rule (lib/pricing/estimate.ts:401): off the
  -- ex-GST subtotal, pct rounded or a flat amount capped at the subtotal.
  if coalesce(v_snap->>'discountMode', '') = 'fixed' then
    v_discount := least(coalesce((v_snap->>'discountFixedCents')::bigint, 0), v_base + v_opts_ex);
  else
    v_discount := round((v_base + v_opts_ex) * coalesce((v_snap->>'discountPct')::numeric, 0) / 100);
  end if;
  if v_discount > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'Discount', (-v_discount)::integer);
    v_sort := v_sort + 1;
  end if;

  -- Approved variations — their own lines, source_ref carries the variation
  -- id (approval date and approver render from it in the document view).
  -- Internal ($0, office↔painter) approvals never print (Tom, 1 Sep).
  for v in select * from public.wo_variations vv
            where vv.work_order_id = v_wo
              and vv.status in ('customer_approved', 'contractor_accepted')
              and vv.price_cents is not null
              and not coalesce((vv.priced_inputs->>'internal')::boolean, false)
            order by vv.created_at
  loop
    v_vdesc := coalesce(nullif(trim(v.comment), ''), initcap(replace(v.category, '_', ' ')));
    v_line_ex := (case when v.credit then -1 else 1 end)
                 * (v.price_cents - public.gst_from_inc_cents(v.price_cents::bigint, v_rate));
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'variation', v.id::text, v_vdesc, v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Balance the document to the anchored subtotal: "less previously invoiced"
  -- when something has been, a (rare, ≤ a few cents) rounding line otherwise.
  select coalesce(sum(l.amount_ex_cents), 0) into v_sum_ex
    from public.invoice_lines l where l.invoice_id = v_inv;
  v_bal := v_ex - v_sum_ex;
  if v_bal <> 0 then
    select string_agg(i.number || ' ' || i.kind::text, ', ' order by i.issued_on) into v_prev
      from public.invoices i
     where i.estimate_id = p_estimate_id and i.status not in ('draft', 'void')
       and i.id <> v_inv and i.number is not null;
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'adjustment',
              case when coalesce(v_prev, '') <> ''
                   then 'Less previously invoiced — ' || v_prev
                   else 'Rounding adjustment' end,
              v_bal::integer);
  end if;

  perform public.invoice_event(v_inv, 'drafted', 'system',
    jsonb_build_object('auto', 'final', 'total_inc_cents', v_total,
                       'previously_invoiced_cents', v_led.invoiced_cents));
  return 'ok:' || v_inv::text;
end $$;

revoke execute on function public.invoice_draft_final(uuid) from public, anon, authenticated;

-- ---- readback -------------------------------------------------------------
-- Expect: 2 new fns secdef, both older fns carrying the internal filter.
select p.proname, p.prosecdef as security_definer,
       position('internal' in pg_get_functiondef(p.oid)) > 0 as internal_aware
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_approve_variation_internal', 'wo_set_variation_contractor_amount',
                     'estimate_changes_by_token', 'invoice_draft_final')
 order by p.proname;
