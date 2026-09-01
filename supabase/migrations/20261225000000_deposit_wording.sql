-- Tom's 1 Sep batch #2: the customer's invoice never says "Progress claim" —
-- it says "Deposit", everywhere that wording appeared. The one runtime source
-- was invoice_request_payment's line description (20261112). Body copied
-- verbatim — ONLY the two v_desc strings change. Existing DRAFT lines are
-- re-worded too; issued lines are immutable by design and keep what they said.

create or replace function public.invoice_request_payment(
  p_estimate_id uuid, p_mode text, p_value numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_led record; v_total bigint; v_gst integer; v_ex bigint; v_rate numeric;
        v_inv uuid; v_wo uuid; v_desc text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_mode not in ('percent', 'fixed') then return 'error:bad_mode'; end if;

  select * into v_led from public.invoice_ledger(p_estimate_id);
  if v_led.accepted_total_cents is null or v_led.accepted_total_cents = 0 then
    return 'error:not_accepted';
  end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_total := round(v_led.adjusted_contract_cents * p_value / 100);
    v_desc := 'Deposit — ' || public.invoice_pct_text(p_value)
              || '% of the adjusted contract';
  else
    if p_value is null or p_value <= 0 or p_value <> round(p_value) then return 'error:bad_amount'; end if;
    if p_value > v_led.balance_cents then return 'error:exceeds_balance'; end if;
    v_total := p_value::bigint;
    v_desc := 'Deposit';
  end if;
  if v_total <= 0 then return 'error:nothing_to_invoice'; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_gst := public.gst_from_inc_cents(v_total, v_rate);
  v_ex := v_total - v_gst;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;

  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
                               token, created_by)
    values (p_estimate_id,
            (select customer_id from public.estimates where id = p_estimate_id),
            v_wo, 'progress', 'draft',
            v_total::integer, v_ex::integer, v_gst, v_total::integer,
            public.invoice_new_token(), auth.uid())
    returning id into v_inv;

  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, gst_cents)
    values (v_inv, 0, 'manual', v_desc, v_ex::integer, v_gst);

  perform public.invoice_event(v_inv, 'drafted', 'staff',
    jsonb_build_object('mode', p_mode, 'value', p_value, 'total_inc_cents', v_total));
  return 'ok:' || v_inv::text;
end $$;

grant execute on function public.invoice_request_payment(uuid, text, numeric) to authenticated;

-- Standing DRAFT lines only (the line guard rightly refuses issued documents).
update public.invoice_lines l
   set description = replace(l.description, 'Progress claim', 'Deposit')
  from public.invoices i
 where i.id = l.invoice_id and i.status = 'draft'
   and l.description like 'Progress claim%';

-- ---- readback -------------------------------------------------------------
-- Expect: deposit_wording = true, draft_lines_left = 0.
select
  position('Deposit —' in pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'invoice_request_payment'))) > 0 as deposit_wording,
  (select count(*) from public.invoice_lines l
     join public.invoices i on i.id = l.invoice_id
    where i.status = 'draft' and l.description like 'Progress claim%') as draft_lines_left;
