-- 20270156 · Deposit invoices list every line item of the accepted estimate.
--
-- Tom, 17 Sep 2026: "please include all line items on deposit invoices".
-- Until now a deposit invoice carried ONE line ("Deposit — 50% of the contract
-- price…"); the customer paying it could not see what the job covers. The
-- final invoice has always itemised the accepted scope from sent_snapshot
-- (invoice_draft_final, last defined in 20270146). The deposit now shows the
-- same lines, under "Contract works — from your accepted estimate", with the
-- deposit line itself under "This invoice".
--
-- Money rule, unchanged: a deposit is INC-ANCHORED — its total is the deposit
-- figure, never the sum of its lines. So the scope lines are INFORMATIONAL:
--   • invoice_lines.informational (new column, default false) marks them;
--   • invoice_recompute_draft and invoice_set_draft_total ignore them, so an
--     amended deposit keeps its total and its single money line;
--   • invoice_issue's line-summing branch only ever runs for line-built kinds
--     (variation/standalone), which never carry informational lines;
--   • the staff document shows them read-only (no ✎), the customer sheet
--     shows them as it shows a final's contract lines.
--
-- Single source: the snapshot-walk that invoice_draft_final carried inline
-- moves into invoice_write_snapshot_lines(...) and draft_final calls it; the
-- deposit gets it from an AFTER INSERT trigger on invoices, so accept_estimate
-- (20270149) and invoice_draft_deposit (20270153) both pick it up without a
-- third copy. Existing DRAFT deposits are backfilled; issued deposits are
-- locked documents with a PDF already rendered and are left as they were.

-- 1. The flag.
alter table public.invoice_lines
  add column if not exists informational boolean not null default false;

-- 2. The one writer of snapshot lines. Returns the next free sort.
create or replace function public.invoice_write_snapshot_lines(
  p_invoice_id uuid, p_estimate_id uuid, p_sort_start integer, p_informational boolean
) returns integer language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; v_sel jsonb; r jsonb; v_sort integer := p_sort_start;
        v_areas_ex bigint := 0; v_lines_ex bigint := 0; v_opts_ex bigint := 0;
        v_base bigint; v_sundries bigint; v_discount bigint := 0; v_line_ex bigint;
        v_prep bigint := 0; v_prep_desc text; v_pre_areas bigint := 0; v_pre_lines bigint := 0;
begin
  select coalesce(sent_snapshot, '{}'::jsonb), selected_options into v_snap, v_sel
    from public.estimates where id = p_estimate_id;
  if v_snap is null then return v_sort; end if;

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
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'preparation', v_prep_desc, v_prep::integer, p_informational);
    v_sort := v_sort + 1;
  else
    v_prep := 0;
  end if;

  -- Areas and line items, as the customer saw them (ex GST).
  for r in select value from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_areas_ex := v_areas_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_lines_ex := v_lines_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  -- baseSubtotalCents = preparation + included items (ex GST). Anything the
  -- lines above still don't account for is written as a further Preparation
  -- line so the invoice always reconciles to the accepted subtotal.
  v_base := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_prep + v_areas_ex + v_lines_ex);
  v_sundries := v_base - v_prep - v_areas_ex - v_lines_ex;
  if v_sundries > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'preparation',
              'Preparation — Allowance for materials for job site set up, fillers and consumables.',
              v_sundries::integer, p_informational);
    v_sort := v_sort + 1;
  end if;

  -- The options the customer selected at acceptance. (Hardened: an
  -- object-shaped selected_options counts as "none selected", not an error.)
  for r in select value from jsonb_array_elements(coalesce(v_snap->'options', '[]'::jsonb))
            where (value->>'id') in (
              select jsonb_array_elements_text(
                case when jsonb_typeof(v_sel) = 'array'
                     then v_sel else '[]'::jsonb end))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_opts_ex := v_opts_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') || ' (selected option)', v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  -- Discount, as the snapshot carried it.
  if coalesce(v_snap->>'discountMode', '') = 'fixed' then
    v_discount := least(coalesce((v_snap->>'discountFixedCents')::bigint, 0), v_base + v_opts_ex);
  else
    v_discount := round((v_base + v_opts_ex) * coalesce((v_snap->>'discountPct')::numeric, 0) / 100);
  end if;
  if v_discount > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'Discount', (-v_discount)::integer, p_informational);
    v_sort := v_sort + 1;
  end if;

  return v_sort;
end $$;

revoke execute on function public.invoice_write_snapshot_lines(uuid, uuid, integer, boolean) from public, anon, authenticated;

-- 3. invoice_draft_final — 20270146's definition with the inline walk replaced
--    by the call. Nothing else changes.
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

-- 4. Draft totals ignore informational lines.
create or replace function public.invoice_recompute_draft(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_ex bigint; v_gst integer; v_rate numeric;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found or v.status <> 'draft' then return; end if;
  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  select coalesce(sum(l.amount_ex_cents), 0) into v_ex
    from public.invoice_lines l where l.invoice_id = p_invoice_id and not l.informational;
  v_gst := public.gst_on_ex_cents(v_ex, v_rate);
  update public.invoices
     set subtotal_ex_cents = v_ex::integer,
         gst_cents = v_gst,
         total_inc_cents = (v_ex + v_gst)::integer,
         amount_cents = (v_ex + v_gst)::integer
   where id = p_invoice_id;
end $$;

revoke execute on function public.invoice_recompute_draft(uuid) from public, anon, authenticated;

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

  -- Keep the single MONEY line honest when there is exactly one; the
  -- informational scope lines are not that line.
  select count(*) into v_lines from public.invoice_lines
   where invoice_id = p_invoice_id and not informational;
  if v_lines = 1 then
    update public.invoice_lines
       set amount_ex_cents = p_total_inc_cents - v_gst, gst_cents = v_gst
     where invoice_id = p_invoice_id and not informational;
  end if;

  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'set_total',
                       'from_cents', v.total_inc_cents, 'to_cents', p_total_inc_cents));
  return 'ok:amended';
end $$;

grant execute on function public.invoice_set_draft_total(uuid, integer) to authenticated;

-- 5. Every new deposit draft gets the scope lines, whoever drafts it. Sorts
--    start at -1000 so the deposit's own money line (sort 0) stays last.
create or replace function public.invoice_deposit_scope_lines()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'deposit' and new.status = 'draft' then
    perform public.invoice_write_snapshot_lines(new.id, new.estimate_id, -1000, true);
  end if;
  return new;
end $$;

drop trigger if exists t_invoice_deposit_scope on public.invoices;
create trigger t_invoice_deposit_scope after insert on public.invoices
  for each row execute function public.invoice_deposit_scope_lines();

-- 6. Backfill: DRAFT deposits with no scope lines yet. Drafts only — the lines
--    guard permits it and no document has been rendered for them.
do $$
declare r record;
begin
  for r in select i.id, i.estimate_id from public.invoices i
            where i.kind = 'deposit' and i.status = 'draft'
              and not exists (select 1 from public.invoice_lines l
                               where l.invoice_id = i.id and l.informational)
  loop
    perform public.invoice_write_snapshot_lines(r.id, r.estimate_id, -1000, true);
  end loop;
end $$;

-- Read-back. Read it; do not assume it.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'invoice_lines' and column_name = 'informational') as column_ok,
  (select count(*) from pg_proc where proname = 'invoice_write_snapshot_lines') = 1 as helper_ok,
  (select prosrc like '%invoice_write_snapshot_lines(v_inv, p_estimate_id, v_sort, false)%'
     from pg_proc where proname = 'invoice_draft_final') as final_uses_helper,
  (select prosrc like '%not l.informational%' from pg_proc where proname = 'invoice_recompute_draft') as recompute_ignores,
  exists (select 1 from pg_trigger where tgname = 't_invoice_deposit_scope') as trigger_ok,
  (select count(*) from public.invoices i where i.kind = 'deposit' and i.status = 'draft'
     and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.informational)) as draft_deposits_still_bare,
  (select count(distinct l.invoice_id) from public.invoice_lines l where l.informational) as deposits_with_scope;

insert into public._prod_migrations(name) values ('20270156000000_invoice_deposit_scope_lines.sql') on conflict (name) do nothing;
