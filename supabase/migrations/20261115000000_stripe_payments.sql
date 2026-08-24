-- =====================================================================
-- Invoicing Step 4 — the Stripe webhook's database half.
-- Brief: docs/briefs/claude-code-brief-invoicing-payments.md §5, §8 Step 4.
-- Requires 20261111–20261114 (all run live 24 Aug).
--
-- The signed webhook is the SOLE writer of card-payment success (§5.3):
-- every function here is service_role-gated — no browser session, staff
-- included, can call them. Idempotency lives at two layers: stripe_events
-- (unique event_id — insert-or-skip is the processing door) and
-- payments.stripe_payment_intent_id (unique — a replayed completed-checkout
-- event finds its payment already recorded and exits ok).
--
-- Refunds NEVER silently un-pay an invoice (§5.2): the payment flips to
-- refunded (so ledger `paid` drops and the money view shows it), an event is
-- written for the feed and the "credit note needed?" surface — but the
-- invoice's status is deliberately untouched. Whether that becomes a credit
-- note or a re-invoice is a human's call.
-- =====================================================================

-- ---- the idempotency door -------------------------------------------------

-- Three answers, because "seen before" is not "finished": 'new' = process it;
-- 'retry' = seen but a previous dispatch died before marking processed —
-- process again (every handler is itself idempotent); 'done' = fully
-- processed, acknowledge and stop. Without the middle state, a dispatch
-- failure followed by Stripe's retry would be waved through as a duplicate
-- and the payment silently lost.
create or replace function public.stripe_event_insert(
  p_event_id text, p_type text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_processed timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'stripe_events_service_only';
  end if;
  insert into public.stripe_events (event_id, type, payload)
    values (p_event_id, p_type, coalesce(p_payload, '{}'::jsonb))
    on conflict (event_id) do nothing;
  if found then return 'new'; end if;
  select processed_at into v_processed from public.stripe_events where event_id = p_event_id;
  return case when v_processed is null then 'retry' else 'done' end;
end $$;

revoke execute on function public.stripe_event_insert(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.stripe_event_insert(text, text, jsonb) to service_role;

create or replace function public.stripe_event_processed(p_event_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'stripe_events_service_only';
  end if;
  update public.stripe_events set processed_at = now() where event_id = p_event_id;
end $$;

revoke execute on function public.stripe_event_processed(text) from public, anon, authenticated;
grant execute on function public.stripe_event_processed(text) to service_role;

-- ---- checkout.session.completed → the payment ------------------------------

create or replace function public.record_stripe_payment(
  p_invoice_id uuid, p_payment_intent text,
  p_amount_cents integer, p_surcharge_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_paid bigint; v_receipt text; v_pay uuid;
        v_new_status public.invoice_status;
begin
  if auth.role() <> 'service_role' then return 'error:service_only'; end if;
  if coalesce(trim(p_payment_intent), '') = '' then return 'error:no_intent'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then return 'error:bad_amount'; end if;

  -- Replayed delivery: the intent already has its payment row — done.
  if exists (select 1 from public.payments where stripe_payment_intent_id = p_payment_intent) then
    return 'ok:already';
  end if;

  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = p_invoice_id and status = 'succeeded';

  v_receipt := public.receipt_allocate_number();
  insert into public.payments (invoice_id, amount_cents, surcharge_cents, paid_on, method,
                               status, received_at, stripe_payment_intent_id, receipt_number)
    values (p_invoice_id, p_amount_cents, greatest(coalesce(p_surcharge_cents, 0), 0),
            (now() at time zone 'Australia/Melbourne')::date, 'stripe_card',
            'succeeded', now(), p_payment_intent, v_receipt)
    returning id into v_pay;

  -- Checkout charged the exact balance computed at session creation, but the
  -- ledger may have moved between click and completion — derive, don't assume.
  if v.status in ('issued', 'sent', 'viewed', 'partially_paid') then
    v_new_status := case when v_paid + p_amount_cents >= v.total_inc_cents
                         then 'paid'::public.invoice_status
                         else 'partially_paid'::public.invoice_status end;
    if v.status is distinct from v_new_status then
      update public.invoices set status = v_new_status where id = p_invoice_id;
    end if;
  end if;

  perform public.invoice_event(p_invoice_id, 'payment_received', 'system',
    jsonb_build_object('method', 'stripe_card', 'amount_cents', p_amount_cents,
                       'surcharge_cents', greatest(coalesce(p_surcharge_cents, 0), 0),
                       'receipt', v_receipt, 'payment_intent', p_payment_intent));
  return 'ok:' || v_pay::text;
end $$;

revoke execute on function public.record_stripe_payment(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(uuid, text, integer, integer) to service_role;

-- ---- the processing fee, once the balance transaction settles ---------------

create or replace function public.payment_set_stripe_fee(p_payment_intent text, p_fee_cents integer)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then return 'error:service_only'; end if;
  update public.payments set stripe_fee_cents = p_fee_cents
   where stripe_payment_intent_id = p_payment_intent and stripe_fee_cents is null;
  return case when found then 'ok:set' else 'ok:already' end;
end $$;

revoke execute on function public.payment_set_stripe_fee(text, integer) from public, anon, authenticated;
grant execute on function public.payment_set_stripe_fee(text, integer) to service_role;

-- ---- charge.refunded — the payment flips, the invoice does NOT --------------

create or replace function public.record_stripe_refund(p_payment_intent text, p_amount_cents integer)
returns text language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype;
begin
  if auth.role() <> 'service_role' then return 'error:service_only'; end if;
  select * into v_pay from public.payments
   where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'error:not_found'; end if;
  if v_pay.status = 'refunded' then return 'ok:already'; end if;

  update public.payments set status = 'refunded' where id = v_pay.id;

  perform public.invoice_event(v_pay.invoice_id, 'payment_refunded', 'system',
    jsonb_build_object('payment_intent', p_payment_intent,
                       'amount_cents', coalesce(p_amount_cents, v_pay.amount_cents),
                       'receipt', v_pay.receipt_number,
                       'needs_credit_note', true));
  return 'ok:refunded';
end $$;

revoke execute on function public.record_stripe_refund(text, integer) from public, anon, authenticated;
grant execute on function public.record_stripe_refund(text, integer) to service_role;

-- ---- payment_intent.payment_failed — feed only ------------------------------

create or replace function public.record_stripe_failure(p_invoice_id uuid, p_payment_intent text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then return 'error:service_only'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id) then
    return 'error:not_found';
  end if;
  perform public.invoice_event(p_invoice_id, 'payment_failed', 'system',
    jsonb_build_object('payment_intent', p_payment_intent, 'reason', coalesce(p_reason, '')));
  return 'ok:noted';
end $$;

revoke execute on function public.record_stripe_failure(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_failure(uuid, text, text) to service_role;

-- ---- readback -------------------------------------------------------------
-- Expect 6 functions, all security definer.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('stripe_event_insert', 'stripe_event_processed',
                     'record_stripe_payment', 'payment_set_stripe_fee',
                     'record_stripe_refund', 'record_stripe_failure')
 order by p.proname;
-- Expect 6 rows, all false — no browser session may call any of them.
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may_call
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('stripe_event_insert', 'stripe_event_processed',
                     'record_stripe_payment', 'payment_set_stripe_fee',
                     'record_stripe_refund', 'record_stripe_failure')
 order by p.proname;
