-- =====================================================================
-- Invoicing Step 2 — the draft-editing surface for the §7.3 document editor.
-- Brief: docs/briefs/claude-code-brief-invoicing-payments.md §7.3, §8 Step 2.
-- Requires 20261111 + 20261112 (run live 24 Aug).
--
-- Drafts are fully editable documents; every edit round-trips through the
-- server (§3.2). These RPCs are that round trip:
--   invoice_update_line / invoice_add_line / invoice_remove_line — line edits;
--     totals recompute server-side (line-built rule) after every change
--   invoice_set_draft_total — amend a deposit/progress figure (the mockup's
--     "amended $1,854 → $1,978 by Tom"), inc-anchored split, event-logged
--   invoice_reconcile_adjustment — §7.3(b): keep an off-ledger total as a
--     recorded one-off adjustment (event-logged; silent drift is impossible)
--   invoice_record_drift_as_variation — §7.3(b): the other path — the drift
--     becomes a staff-override variation on the existing wo_variations
--     machinery, moving the ledger so the document reconciles (emerald)
--
-- Guard interplay: all of these touch DRAFTS only, which the 20261112
-- triggers allow; the moment an invoice is issued they all refuse.
-- =====================================================================

-- ---- internal: recompute a draft's totals from its lines (⚑14 line rule) --

create or replace function public.invoice_recompute_draft(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_ex bigint; v_gst integer; v_rate numeric;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found or v.status <> 'draft' then return; end if;
  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  select coalesce(sum(l.amount_ex_cents), 0) into v_ex
    from public.invoice_lines l where l.invoice_id = p_invoice_id;
  v_gst := public.gst_on_ex_cents(v_ex, v_rate);
  update public.invoices
     set subtotal_ex_cents = v_ex::integer,
         gst_cents = v_gst,
         total_inc_cents = (v_ex + v_gst)::integer,
         amount_cents = (v_ex + v_gst)::integer
   where id = p_invoice_id;
end $$;

revoke execute on function public.invoice_recompute_draft(uuid) from public, anon, authenticated;

-- ---- line edits -----------------------------------------------------------

create or replace function public.invoice_update_line(
  p_line_id uuid, p_description text, p_amount_ex_cents integer, p_qty numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines%rowtype; v_status public.invoice_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.invoice_lines where id = p_line_id for update;
  if not found then return 'error:not_found'; end if;
  select status into v_status from public.invoices where id = l.invoice_id;
  if v_status <> 'draft' then return 'error:not_draft'; end if;
  if coalesce(trim(p_description), '') = '' then return 'error:no_description'; end if;
  if p_amount_ex_cents is null or abs(p_amount_ex_cents) > 100000000 then
    return 'error:bad_amount';
  end if;

  update public.invoice_lines
     set description = trim(p_description),
         amount_ex_cents = p_amount_ex_cents,
         qty = coalesce(p_qty, qty)
   where id = p_line_id;
  perform public.invoice_recompute_draft(l.invoice_id);
  perform public.invoice_event(l.invoice_id, 'amended', 'staff',
    jsonb_build_object('line_id', p_line_id, 'what', 'update_line',
                       'from_cents', l.amount_ex_cents, 'to_cents', p_amount_ex_cents,
                       'from_description', l.description, 'to_description', trim(p_description)));
  return 'ok:updated';
end $$;

grant execute on function public.invoice_update_line(uuid, text, integer, numeric) to authenticated;

create or replace function public.invoice_add_line(
  p_invoice_id uuid, p_description text, p_amount_ex_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_sort integer; v_line uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;
  if coalesce(trim(p_description), '') = '' then return 'error:no_description'; end if;
  if p_amount_ex_cents is null or abs(p_amount_ex_cents) > 100000000 then
    return 'error:bad_amount';
  end if;

  select coalesce(max(sort), -1) + 1 into v_sort
    from public.invoice_lines where invoice_id = p_invoice_id;
  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
    values (p_invoice_id, v_sort, 'manual', trim(p_description), p_amount_ex_cents)
    returning id into v_line;
  perform public.invoice_recompute_draft(p_invoice_id);
  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('line_id', v_line, 'what', 'add_line',
                       'to_cents', p_amount_ex_cents, 'to_description', trim(p_description)));
  return 'ok:' || v_line::text;
end $$;

grant execute on function public.invoice_add_line(uuid, text, integer) to authenticated;

create or replace function public.invoice_remove_line(p_line_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines%rowtype; v_status public.invoice_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.invoice_lines where id = p_line_id for update;
  if not found then return 'error:not_found'; end if;
  select status into v_status from public.invoices where id = l.invoice_id;
  if v_status <> 'draft' then return 'error:not_draft'; end if;

  delete from public.invoice_lines where id = p_line_id;
  perform public.invoice_recompute_draft(l.invoice_id);
  perform public.invoice_event(l.invoice_id, 'amended', 'staff',
    jsonb_build_object('line_id', p_line_id, 'what', 'remove_line',
                       'from_cents', l.amount_ex_cents, 'from_description', l.description));
  return 'ok:removed';
end $$;

grant execute on function public.invoice_remove_line(uuid) to authenticated;

-- ---- deposit / progress amend (inc-anchored) ------------------------------

create or replace function public.invoice_set_draft_total(
  p_invoice_id uuid, p_total_inc_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_led record; v_rate numeric; v_gst integer;
        v_lines integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;
  if v.kind not in ('deposit', 'progress') then return 'error:use_line_editor'; end if;
  if p_total_inc_cents is null or p_total_inc_cents <= 0 then return 'error:bad_amount'; end if;

  -- Bounded by the job itself: an amended deposit/claim can never exceed the
  -- adjusted contract.
  select * into v_led from public.invoice_ledger(v.estimate_id);
  if p_total_inc_cents > v_led.adjusted_contract_cents then
    return 'error:exceeds_contract';
  end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_gst := public.gst_from_inc_cents(p_total_inc_cents::bigint, v_rate);

  update public.invoices
     set total_inc_cents = p_total_inc_cents,
         amount_cents = p_total_inc_cents,
         gst_cents = v_gst,
         subtotal_ex_cents = p_total_inc_cents - v_gst
   where id = p_invoice_id;

  -- Keep the single seeded line honest when there is exactly one.
  select count(*) into v_lines from public.invoice_lines where invoice_id = p_invoice_id;
  if v_lines = 1 then
    update public.invoice_lines
       set amount_ex_cents = p_total_inc_cents - v_gst, gst_cents = v_gst
     where invoice_id = p_invoice_id;
  end if;

  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'set_total',
                       'from_cents', v.total_inc_cents, 'to_cents', p_total_inc_cents));
  return 'ok:amended';
end $$;

grant execute on function public.invoice_set_draft_total(uuid, integer) to authenticated;

-- ---- the reconciliation banner's two resolution paths (§7.3 b) ------------

-- The drift a FINAL draft carries against the ledger: total − (adjusted −
-- previously invoiced). Zero = the emerald resting state.
create or replace function public.invoice_final_drift_cents(p_invoice_id uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v public.invoices%rowtype; v_led record;
begin
  select * into v from public.invoices where id = p_invoice_id;
  if not found or v.kind <> 'final' then return 0; end if;
  select * into v_led from public.invoice_ledger(v.estimate_id);
  return v.total_inc_cents::bigint
         - greatest(v_led.adjusted_contract_cents - v_led.invoiced_cents, 0);
end $$;

revoke execute on function public.invoice_final_drift_cents(uuid) from public, anon, authenticated;

create or replace function public.invoice_reconcile_adjustment(p_invoice_id uuid, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_drift bigint;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' or v.kind <> 'final' then return 'error:not_final_draft'; end if;
  v_drift := public.invoice_final_drift_cents(p_invoice_id);
  if v_drift = 0 then return 'error:nothing_to_reconcile'; end if;

  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'reconcile_decision', 'decision', 'one_off_adjustment',
                       'drift_cents', v_drift, 'note', coalesce(trim(p_note), '')));
  return 'ok:adjustment_recorded';
end $$;

grant execute on function public.invoice_reconcile_adjustment(uuid, text) to authenticated;

-- The other path: the drift IS extra (or descoped) work — record it on the
-- existing wo_variations machinery as a PC-entered override, approved on the
-- customer's verbal say-so. The adjusted contract moves by exactly the drift,
-- so the document reconciles without touching its lines. The variation is
-- expressed by THIS document's edited lines — deliberately no new invoice
-- line, so nothing shows twice (a later re-draft rebuilds from the snapshot
-- and gives the variation its own line instead).
create or replace function public.invoice_record_drift_as_variation(
  p_invoice_id uuid, p_comment text
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_drift bigint; v_var uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' or v.kind <> 'final' then return 'error:not_final_draft'; end if;
  if v.work_order_id is null then return 'error:no_work_order'; end if;
  v_drift := public.invoice_final_drift_cents(p_invoice_id);
  if v_drift = 0 then return 'error:nothing_to_reconcile'; end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment,
       status, price_cents, credit, customer_responded_at)
    values
      (v.work_order_id, auth.uid(), 'staff', true, 'extra_scope', trim(p_comment),
       'customer_approved', abs(v_drift)::integer, v_drift < 0, now())
    returning id into v_var;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'variation_customer_approved', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_var, 'override', true,
                               'price_cents', abs(v_drift), 'credit', v_drift < 0,
                               'via', 'invoice_reconciliation', 'invoice_id', p_invoice_id));

  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'reconcile_decision', 'decision', 'recorded_as_variation',
                       'variation_id', v_var, 'drift_cents', v_drift,
                       'note', trim(p_comment)));
  return 'ok:' || v_var::text;
end $$;

grant execute on function public.invoice_record_drift_as_variation(uuid, text) to authenticated;

-- Staff read of the drift, for the banner.
create or replace function public.invoice_final_drift_staff(p_invoice_id uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return null; end if;
  return public.invoice_final_drift_cents(p_invoice_id);
end $$;

grant execute on function public.invoice_final_drift_staff(uuid) to authenticated;

-- ---- hardening: invoice_draft_final vs object-shaped selected_options -----
-- Some acceptances stored selected_options as '{}' (an object, not an array);
-- jsonb_array_elements_text throws on objects, which would crash the final
-- draft at sign-off for those jobs. BODY BASIS: 20261112 §9b VERBATIM — the
-- ONLY change is the jsonb_typeof guard in the options loop.

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
  for v in select * from public.wo_variations vv
            where vv.work_order_id = v_wo
              and vv.status in ('customer_approved', 'contractor_accepted')
              and vv.price_cents is not null
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
-- Expect 9 functions, all security definer.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('invoice_recompute_draft', 'invoice_update_line',
                     'invoice_add_line', 'invoice_remove_line',
                     'invoice_set_draft_total', 'invoice_final_drift_cents',
                     'invoice_reconcile_adjustment', 'invoice_record_drift_as_variation',
                     'invoice_final_drift_staff')
 order by p.proname;
-- Expect true — the options loop is hardened against object-shaped selected_options.
select pg_get_functiondef(p.oid) like '%jsonb_typeof(v_est.selected_options)%' as options_hardened
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'invoice_draft_final';
-- Expect internal ones NOT executable by authenticated (2 rows, both false).
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may_call
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('invoice_recompute_draft', 'invoice_final_drift_cents')
 order by p.proname;
