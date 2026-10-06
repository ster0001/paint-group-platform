-- =============================================================================
-- The final invoice skips variations already on another invoice (6 Oct 2026).
--
-- Tom, 6 Oct, 568 Collins Street: passing the last quality check routed the
-- job to its no-walkthrough close, which drafts the final invoice, which
-- raised `duplicate key value violates unique constraint
-- "invoice_lines_variation_once"` — and the whole pass rolled back with it.
--
-- §3.1 of the invoicing brief: a variation appears on at most ONE non-void
-- invoice, and the index `invoice_lines_variation_once` enforces it. The
-- draft-final loop (20270156) wrote a line for EVERY signed variation on the
-- job, including one already billed on an issued progress invoice (or on a
-- sent final being re-drafted). The ledger already nets what earlier invoices
-- took, so the right line for a billed variation is no line at all: skip it.
--
-- One predicate added to the 20270156 body; everything else is unchanged.
-- Converges on a re-run (or-replace; the grant is unchanged by it).
-- =============================================================================
set lock_timeout = '15s';

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

  -- Preparation, areas, line items, selected options, discount — the one
  -- writer of snapshot lines (20270156), shared with the deposit trigger.
  v_sort := public.invoice_write_snapshot_lines(v_inv, p_estimate_id, v_sort, false);

  -- Signed variations (customer-approved / contractor-accepted), ex GST,
  -- credits negative. Internal variations never reach the customer's invoice.
  -- NEW (6 Oct): a variation already on another live invoice is not written
  -- again — §3.1, and the ledger has already netted what that invoice took.
  for v in select * from public.wo_variations vv
            where vv.work_order_id = v_wo
              and vv.status in ('customer_approved', 'contractor_accepted')
              and vv.price_cents is not null
              and not coalesce((vv.priced_inputs->>'internal')::boolean, false)
              and not exists (
                select 1 from public.invoice_lines l
                 where l.source = 'variation' and l.source_ref = vv.id::text
                   and not l.parent_void and l.invoice_id <> v_inv
              )
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

-- Internal: called by the close and sign functions, never by a session (20261112).
revoke execute on function public.invoice_draft_final(uuid) from public, anon, authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select prosrc like '%not l.parent_void and l.invoice_id <> v_inv%' from pg_proc where proname = 'invoice_draft_final') as final_skips_billed, true as _expect_final_skips_billed,
  (select count(*) from pg_indexes where tablename = 'invoice_lines' and indexname = 'invoice_lines_variation_once') as once_index, 1 as _expect_once_index;

insert into public._prod_migrations(name) values ('20270216000000_final_invoice_skips_billed_variations.sql') on conflict (name) do nothing;
