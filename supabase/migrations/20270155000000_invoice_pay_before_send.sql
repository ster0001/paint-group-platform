-- 20270155 · a payment can be recorded on a DRAFT invoice.
--
-- Tom, 17 Sep 2026: "if a customer pays via bank transfer before we have sent
-- the invoice I don't want to have to send it again — please change for all
-- invoices." Until now invoice_record_payment answered 'error:not_payable'
-- for a draft, so the office had to Issue & send (an email the customer did
-- not need) before it could record money already in the bank.
--
-- The state matrix (§3.2, invoice_transitions) is UNCHANGED: a draft still
-- becomes issued before it becomes paid. What changes is that recording a
-- payment on a draft performs the issue step itself — number allocated,
-- totals fixed, dates set, document locked, 'issued' event written — and
-- then records the payment in the same transaction. Nothing is sent: no
-- 'sent' event, status never passes through 'sent', so the customer hears
-- from us once, with the receipt. The office can still send the (now paid)
-- invoice later if the customer wants a copy.
--
-- Every other rule of the original (20261112 §9) stands: staff only, manual
-- methods only (card payments arrive through the Stripe webhook), amount
-- bounded at balance × 1.05, receipt number allocated, payment_received event.

create or replace function public.invoice_record_payment(
  p_invoice_id uuid, p_method text, p_amount_cents integer,
  p_reference text default '', p_received_on date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_paid bigint; v_balance bigint; v_receipt text;
        v_new_status public.invoice_status; v_issue text; v_from_draft boolean := false;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_method not in ('bank_transfer', 'cash', 'other') then
    return 'error:stripe_via_webhook';
  end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;

  -- Paid before it was sent: issue it here, silently, then take the money.
  if v.status = 'draft' then
    v_issue := public.invoice_issue(p_invoice_id);
    if v_issue <> 'ok:issued' then return v_issue; end if;   -- e.g. error:nothing_to_invoice
    select * into v from public.invoices where id = p_invoice_id for update;
    v_from_draft := true;
  end if;

  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return 'error:not_payable';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = p_invoice_id and status = 'succeeded';
  v_balance := v.total_inc_cents - v_paid;
  if p_amount_cents is null or p_amount_cents <= 0 then return 'error:bad_amount'; end if;
  if p_amount_cents > round(v_balance * 1.05) then return 'error:exceeds_balance'; end if;

  v_receipt := public.receipt_allocate_number();
  insert into public.payments (invoice_id, amount_cents, paid_on, method, status,
                               received_at, recorded_by, reference, receipt_number)
    values (p_invoice_id, p_amount_cents,
            coalesce(p_received_on, (now() at time zone 'Australia/Melbourne')::date),
            p_method, 'succeeded', now(), auth.uid(),
            coalesce(p_reference, ''), v_receipt);

  v_new_status := case when v_paid + p_amount_cents >= v.total_inc_cents
                       then 'paid'::public.invoice_status
                       else 'partially_paid'::public.invoice_status end;
  if v.status is distinct from v_new_status then
    update public.invoices set status = v_new_status where id = p_invoice_id;
  end if;

  perform public.invoice_event(p_invoice_id, 'payment_received', 'staff',
    jsonb_build_object('method', p_method, 'amount_cents', p_amount_cents,
                       'receipt', v_receipt, 'reference', coalesce(p_reference, ''),
                       'overpaid', v_paid + p_amount_cents > v.total_inc_cents,
                       'paid_before_send', v_from_draft));
  return 'ok:' || v_new_status::text;
end $$;

grant execute on function public.invoice_record_payment(uuid, text, integer, text, date) to authenticated;

-- Read-back: one definition, callable by staff sessions, and the body carries
-- the draft branch. Read this output; do not assume it.
select
  (select count(*) from pg_proc where proname = 'invoice_record_payment') = 1 as fn_ok,
  has_function_privilege('authenticated', 'public.invoice_record_payment(uuid, text, integer, text, date)', 'execute') as staff_may_call,
  (select prosrc like '%public.invoice_issue(p_invoice_id)%' from pg_proc where proname = 'invoice_record_payment') as issues_drafts;

insert into public._prod_migrations(name) values ('20270155000000_invoice_pay_before_send.sql') on conflict (name) do nothing;
