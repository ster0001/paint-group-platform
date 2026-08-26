-- ============================================================================
-- Contractor-composed invoices (Tom, 25 Aug 2026): the contractor controls
-- the DATE and the LINE ITEMS of their claim — then their submit issues it
-- (supplier-issued tax invoice; the RCTI question never arises). The server
-- still bounds everything: line totals must sum to the claimed amount, and
-- the claim can never exceed the remaining agreed money.
--
-- Idempotent; safe to re-run. Ends with read-backs (house law).
-- ============================================================================

alter table public.contractor_invoices
  add column if not exists lines jsonb not null default '[]'::jsonb,
  add column if not exists invoice_date date;

-- Signature changes (p_lines, p_invoice_date) — drop the old one rather than
-- overload it (named-arg PostgREST calls would be ambiguous).
drop function if exists public.contractor_invoice_request(uuid, text, numeric);

create or replace function public.contractor_invoice_request(
  p_work_order_id uuid, p_mode text, p_value numeric,
  p_lines jsonb default null, p_invoice_date date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype; v_cid uuid;
        v_a record; v_prev integer; v_remaining integer; v_amount integer;
        v_gst integer; v_terms integer; v_id uuid;
        v_line jsonb; v_sum bigint := 0; v_n integer := 0; v_today date;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  select * into v_c from public.contractors where id = v_cid;

  if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
  if coalesce(trim(v_c.address), '') = '' then return 'error:profile_incomplete:address'; end if;
  if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then
    return 'error:profile_incomplete:abn';
  end if;
  if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then
    return 'error:profile_incomplete:bank';
  end if;

  -- ⚑10: a pending manual deduction makes the adjusted pay uncertain — no
  -- claims until the PC has set the figure.
  if exists (select 1 from public.wo_variations v
              where v.work_order_id = p_work_order_id
                and v.credit and v.needs_manual_deduction and v.deduction_cents is null
                and v.status in ('customer_approved', 'contractor_accepted')) then
    return 'error:deduction_pending';
  end if;

  select * into v_a from public.contractor_invoice_amounts(p_work_order_id);
  v_prev := public.contractor_invoice_invoiced_cents(p_work_order_id);
  v_remaining := v_a.total_inc_cents - v_prev;
  if v_remaining <= 0 then return 'error:nothing_remaining'; end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_amount := least(round(v_a.total_inc_cents * p_value / 100.0)::integer, v_remaining);
  elsif p_mode = 'fixed' then
    if p_value is null or p_value <= 0 then return 'error:bad_amount'; end if;
    v_amount := round(p_value * 100)::integer;  -- dollars in, cents stored
    if v_amount > v_remaining then return 'error:exceeds_remaining'; end if;
  else
    return 'error:bad_mode';
  end if;
  if v_amount <= 0 then return 'error:bad_amount'; end if;

  -- The contractor's own line items (Tom, 25 Aug): labels + amounts, and the
  -- amounts must SUM to the claimed figure — a breakdown, never a back door
  -- past the remaining-money bound above.
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then return 'error:bad_lines'; end if;
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_n := v_n + 1;
      if v_n > 12 then return 'error:bad_lines'; end if;
      if coalesce(trim(v_line ->> 'label'), '') = '' or length(v_line ->> 'label') > 200 then
        return 'error:bad_lines';
      end if;
      if (v_line ->> 'cents') !~ '^[0-9]+$' or (v_line ->> 'cents')::bigint <= 0 then
        return 'error:bad_lines';
      end if;
      v_sum := v_sum + (v_line ->> 'cents')::bigint;
    end loop;
    if v_n = 0 then return 'error:bad_lines'; end if;
    if v_sum <> v_amount then return 'error:lines_mismatch'; end if;
  end if;

  -- Their invoice date: today by default, and never far from it — an invoice
  -- dated last year or next month is a typo, not a choice.
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if p_invoice_date is not null and abs(p_invoice_date - v_today) > 31 then
    return 'error:bad_date';
  end if;

  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_amount::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);

  -- Born submitted: the contractor's act IS the submission (and, being their
  -- own act on their own document, what makes this a supplier-issued invoice
  -- rather than an RCTI). The guard trigger still freezes it from here on.
  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents, claim_pct,
       subtotal_ex_cents, gst_cents, total_inc_cents,
       status, submitted_at, number, due_on, rcti,
       gst_registered_at_submit, entity_snapshot,
       lines, invoice_date)
    values
      (p_work_order_id, v_cid, 'claim',
       0, 0, '[]'::jsonb,
       v_prev, case when p_mode = 'percent' then p_value end,
       v_amount - v_gst, v_gst, v_amount,
       'submitted', now(), public.ci_allocate_number(),
       coalesce(p_invoice_date, v_today) + v_terms,
       v_c.rcti_agreement_signed_at is not null,
       v_c.gst_registered,
       jsonb_build_object(
         'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
         'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4),
       coalesce(p_lines, '[]'::jsonb), coalesce(p_invoice_date, v_today))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', v_id, 'claim', true,
                               'lines', v_n, 'invoice_date', coalesce(p_invoice_date, v_today)));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.contractor_invoice_request(uuid, text, numeric, jsonb, date)
  to authenticated;

-- ---- read-backs -------------------------------------------------------------

-- Expect: lines | jsonb, invoice_date | date
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'contractor_invoices'
   and column_name in ('lines', 'invoice_date') order by column_name;

-- Expect: exactly ONE contractor_invoice_request, 5 args, security definer
select p.proname, p.pronargs, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'contractor_invoice_request';
