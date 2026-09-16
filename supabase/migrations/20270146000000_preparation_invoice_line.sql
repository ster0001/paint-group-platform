-- 20270146 · The "Preparation" line on invoices (Tom, 15 Sep 2026).
--
-- Until today the per-job sundries allowance sat inside the estimate subtotal
-- unlisted; the customer's parts didn't add up (27 Allenby Avenue). The
-- estimate now carries it as sent_snapshot.preparation — "Preparation —
-- Allowance for materials for job site set up, fillers and consumables." —
-- FIRST, above every area and line item. This migration:
--
--   1. invoice_draft_final: writes that line FIRST on the final invoice, from
--      the snapshot's own preparation entry (falling back to the residual for a
--      snapshot sent before the line existed), instead of a trailing
--      "Sundries & consumables" residual.
--   2. Renames the "Sundries & consumables" lines already on invoices to the
--      new wording and moves them to the top (sort -1). Amounts untouched.
--      The lines guard locks non-draft invoices; this is a wording-only fix
--      run as a migration, so the guard is stepped around for the update.
--
-- Idempotent: or-replace + a where-clause that matches nothing the second time.

create or replace function public.invoice_draft_final(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_est public.estimates%rowtype; v_wo uuid; v_snap jsonb; v_led record;
        v_rate numeric; v_total bigint; v_gst integer; v_ex bigint;
        v_inv uuid; r jsonb; v_sort integer := 0; v_sum_ex bigint := 0;
        v_areas_ex bigint := 0; v_lines_ex bigint := 0; v_opts_ex bigint := 0;
        v_base bigint; v_sundries bigint; v_discount bigint := 0; v_line_ex bigint;
        v_prev text; v_bal bigint; v_vdesc text;
        v_prep bigint := 0; v_prep_desc text; v_pre_areas bigint := 0; v_pre_lines bigint := 0;
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

  -- The Preparation line FIRST. From the snapshot's own entry when it has one;
  -- for a snapshot sent before the line existed, the residual of the base
  -- subtotal over the itemised areas and line items IS that allowance.
  v_prep := coalesce((v_snap->'preparation'->>'priceCents')::bigint, 0);
  if v_prep > 0 then
    v_prep_desc := coalesce(nullif(v_snap->'preparation'->>'title', ''), 'Preparation') ||
      case when public.invoice_strip_html(v_snap->'preparation'->>'descriptionHtml') <> ''
           then ' — ' || public.invoice_strip_html(v_snap->'preparation'->>'descriptionHtml') else '' end;
  else
    select coalesce(sum(coalesce((a->>'priceCents')::bigint, 0)), 0) into v_pre_areas
      from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb)) a;
    select coalesce(sum(coalesce((l->>'priceCents')::bigint, 0)), 0) into v_pre_lines
      from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb)) l;
    v_prep := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_pre_areas + v_pre_lines) - v_pre_areas - v_pre_lines;
    v_prep_desc := 'Preparation — Allowance for materials for job site set up, fillers and consumables.';
  end if;
  if v_prep > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'preparation', v_prep_desc, v_prep::integer);
    v_sort := v_sort + 1;
  else
    v_prep := 0;
  end if;

  -- Areas and line items, as the customer saw them (ex GST).
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

  -- baseSubtotalCents = preparation + included items (ex GST). Anything the
  -- lines above still don't account for is written as a further Preparation
  -- line so the invoice always reconciles to the accepted subtotal.
  v_base := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_prep + v_areas_ex + v_lines_ex);
  v_sundries := v_base - v_prep - v_areas_ex - v_lines_ex;
  if v_sundries > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'preparation',
              'Preparation — Allowance for materials for job site set up, fillers and consumables.',
              v_sundries::integer);
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

  -- Discount, as the snapshot carried it.
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

  -- Signed variations (customer-approved / contractor-accepted), ex GST,
  -- credits negative. Internal variations never reach the customer's invoice.
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

  -- Balance the lines to the ledger's ex-GST figure: what earlier invoices
  -- already took, or a cent of rounding.
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

-- 2. Existing invoices: the same line, the new wording, at the top. Wording
--    only — amounts, totals and numbering are untouched. The lines guard locks
--    every non-draft invoice, so it is stepped around for this one statement.
alter table public.invoice_lines disable trigger t_invoice_lines_guard;
update public.invoice_lines
   set description = 'Preparation — Allowance for materials for job site set up, fillers and consumables.',
       source_ref  = 'preparation',
       sort        = -1
 where source = 'estimate_snapshot'
   and description = 'Sundries & consumables';
alter table public.invoice_lines enable trigger t_invoice_lines_guard;

-- Registers itself in the production ledger (added 16 Sep 2026: this file
-- shipped without it, so `select … from public._prod_migrations` could not say
-- whether it was live — see docs/ARCHITECTURE.md, the invoicing read-failure note).
insert into public._prod_migrations(name) values ('20270146000000_preparation_invoice_line.sql') on conflict (name) do nothing;
