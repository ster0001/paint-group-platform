-- 20270256 · Payments merge Step 3 — the quick actions (payments-merge brief §4.3).
--
-- ADDITIVE ONLY (brief §3A.1): one enum value, five nullable columns, seven
-- transition rows, new functions, and a `create or replace` of invoice_issue
-- whose only change is to keep a due date set on the draft. No existing money,
-- document or event row is deleted or bulk-updated.
--
--   · One-press "✓ Paid $X": invoice_record_full_payment — the amount is the
--     balance, computed HERE under the invoice row lock (the browser never
--     supplies it), so a second press finds nothing owing: 'error:already_paid'.
--   · Undo: invoice_payment_undo — the payment row is KEPT and marked
--     `reversed` (reversed_at/by/reason), the invoice steps back, and a
--     `payment_reversed` event is written. Refused once the receipt has gone
--     (⚑P2, Tom 13 Oct: the receipt goes when the 8-second undo window closes;
--     `receipt_sent_at` is claimed just before it goes) and after 10 minutes. Every paid total in
--     SQL and TS already sums `status = 'succeeded'` only.
--   · Deposit adjust: invoice_set_deposit — sends a PERCENT or the operator's
--     dollar figure; cents are computed here off the ledger (§3 rule 2).
--   · Due date: invoice_set_draft_due — drafts only; locked once issued (R13).
--     invoice_issue now keeps a draft's due date when it is today or later.
--   · Change amount on a sent, unpaid deposit: invoice_change_amount — void and
--     re-issue in ONE transaction; a failure leaves the original untouched
--     (⚑P6: any staff, event-logged). The send follows the commit, in the app.
--   · Create deposit (noinv rows): invoice_draft_deposit is staff-callable again
--     (20270255 put a staff/service guard inside it).
--
-- Converges on a re-run. Ends with the read-back and its ledger row.
set lock_timeout = '15s';

-- ---- 1. schema -------------------------------------------------------------------------
alter type public.payment_status add value if not exists 'reversed';

alter table public.payments add column if not exists reversed_at timestamptz;
alter table public.payments add column if not exists reversed_by uuid references auth.users (id) on delete set null;
alter table public.payments add column if not exists reversal_reason text;
alter table public.payments add column if not exists receipt_sent_at timestamptz;
alter table public.payments add column if not exists invoice_status_before public.invoice_status;
comment on column public.payments.reversed_at is
  'Payments merge Step 3: set by invoice_payment_undo. The row is kept; status becomes reversed and it counts nowhere.';
comment on column public.payments.receipt_sent_at is
  'Claimed by the receipt sender just before the email goes (payment_claim_receipt). Undo is refused once set.';
comment on column public.payments.invoice_status_before is
  'The invoice''s status just before a one-press payment — where Undo puts it back. Null on other paths (Undo then reads the events).';
create index if not exists payments_reversed_by_idx on public.payments (reversed_by) where reversed_by is not null;

-- Undo steps an invoice back. Mirrored in lib/invoicing/stateMachine.ts (contract-tested).
insert into public.invoice_transitions (from_status, to_status) values
  ('paid'::public.invoice_status,           'issued'::public.invoice_status),
  ('paid'::public.invoice_status,           'sent'::public.invoice_status),
  ('paid'::public.invoice_status,           'viewed'::public.invoice_status),
  ('paid'::public.invoice_status,           'partially_paid'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'issued'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'sent'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'viewed'::public.invoice_status)
on conflict do nothing;

-- ---- 2. invoice_issue keeps a draft's due date -----------------------------------------
create or replace function public.invoice_issue(p_invoice_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_rate numeric; v_ex bigint; v_gst integer;
        v_total bigint; v_terms integer; v_today date; v_due date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);

  if v.kind in ('deposit', 'progress', 'final') then
    -- Inc-anchored: the promise is an inc-GST figure computed off the ledger.
    v_total := v.total_inc_cents;
    if v_total <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_from_inc_cents(v_total, v_rate);
    v_ex := v_total - v_gst;
  else
    -- Line-built: sum ex lines, GST once, round half-up (⚑14).
    select coalesce(sum(l.amount_ex_cents), 0) into v_ex
      from public.invoice_lines l where l.invoice_id = p_invoice_id;
    if v_ex <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_on_ex_cents(v_ex, v_rate);
    v_total := v_ex + v_gst;
  end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  v_terms := case when v.kind = 'final'
                  then public.invoice_setting_num('{finalTermsDays}', 7)::integer
                  else public.invoice_setting_num('{paymentTermsDays}', 7)::integer end;
  -- 20270256: a due date chosen on the draft (the Send confirm) stands; an
  -- old or missing one falls back to the terms, exactly as before.
  v_due := case when v.due_on is not null and v.due_on >= v_today then v.due_on else v_today + v_terms end;

  update public.invoices
     set status = 'issued',
         number = public.invoice_allocate_number(),
         issued_on = v_today,
         due_on = v_due,
         subtotal_ex_cents = v_ex::integer,
         gst_cents = v_gst,
         total_inc_cents = v_total::integer,
         amount_cents = v_total::integer
   where id = p_invoice_id;

  perform public.invoice_event(p_invoice_id, 'issued', 'staff',
    jsonb_build_object('number', (select number from public.invoices where id = p_invoice_id),
                       'total_inc_cents', v_total, 'due_on', v_due));
  return 'ok:issued';
end $$;
grant execute on function public.invoice_issue(uuid) to authenticated;

-- ---- 3. one-press paid -------------------------------------------------------------------
create or replace function public.invoice_record_full_payment(p_invoice_id uuid, p_method text default 'bank_transfer')
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_paid bigint; v_balance bigint; v_res text; v_payment uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  -- One press is for an invoice the customer has; a draft goes through "Already paid".
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return case when v.status = 'paid' then 'error:already_paid' else 'error:not_payable' end;
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = p_invoice_id and status = 'succeeded';
  v_balance := v.total_inc_cents - v_paid;
  if v_balance <= 0 then return 'error:already_paid'; end if;

  v_res := public.invoice_record_payment(p_invoice_id, p_method, v_balance::integer, '', null);
  if v_res not like 'ok:%' then return v_res; end if;
  select id into v_payment from public.payments
   where invoice_id = p_invoice_id and recorded_by is not distinct from auth.uid() and status = 'succeeded'
   order by created_at desc, id desc limit 1;
  update public.payments set invoice_status_before = v.status where id = v_payment;
  return 'ok:' || v_payment::text;
end $$;
revoke execute on function public.invoice_record_full_payment(uuid, text) from public, anon;
grant execute on function public.invoice_record_full_payment(uuid, text) to authenticated;

-- ---- 4. undo ------------------------------------------------------------------------------
create or replace function public.invoice_payment_undo(p_payment_id uuid, p_reason text default 'undo')
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments%rowtype; v public.invoices%rowtype; v_paid bigint; v_to public.invoice_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into p from public.payments where id = p_payment_id for update;
  if not found then return 'error:not_found'; end if;
  if p.status <> 'succeeded' then return 'error:not_reversible'; end if;
  if p.method = 'stripe_card' then return 'error:stripe_refund_only'; end if;
  if p.receipt_sent_at is not null then return 'error:receipt_sent'; end if;
  if p.received_at < now() - interval '10 minutes' then return 'error:undo_expired'; end if;

  select * into v from public.invoices where id = p.invoice_id for update;
  update public.payments
     set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(),
         reversal_reason = coalesce(nullif(trim(p_reason), ''), 'undo')
   where id = p_payment_id;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = v.id and status = 'succeeded';
  v_to := case
    when v_paid >= v.total_inc_cents then 'paid'::public.invoice_status
    when v_paid > 0 then 'partially_paid'::public.invoice_status
    when p.invoice_status_before in ('issued', 'sent', 'viewed') then p.invoice_status_before
    when exists (select 1 from public.invoice_events e where e.invoice_id = v.id and e.type = 'viewed') then 'viewed'::public.invoice_status
    when exists (select 1 from public.invoice_events e where e.invoice_id = v.id and e.type = 'sent') then 'sent'::public.invoice_status
    else 'issued'::public.invoice_status end;
  if v.status is distinct from v_to then
    update public.invoices set status = v_to where id = v.id;
  end if;

  perform public.invoice_event(v.id, 'payment_reversed', 'staff',
    jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents, 'method', p.method,
                       'receipt', p.receipt_number, 'reason', coalesce(nullif(trim(p_reason), ''), 'undo'),
                       'from_status', v.status, 'to_status', v_to));
  return 'ok:' || v_to::text;
end $$;
revoke execute on function public.invoice_payment_undo(uuid, text) from public, anon;
grant execute on function public.invoice_payment_undo(uuid, text) to authenticated;

-- The receipt sender CLAIMS the receipt before sending: stamps receipt_sent_at
-- only while the payment is still succeeded and unclaimed, in one statement, so
-- an Undo and a receipt can never both happen. Service role only.
create or replace function public.payment_claim_receipt(p_payment_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return 'error:service_only'; end if;
  update public.payments set receipt_sent_at = now()
   where id = p_payment_id and status = 'succeeded' and receipt_sent_at is null;
  get diagnostics v_n = row_count;
  return case when v_n = 1 then 'ok:claimed' else 'ok:not_claimed' end;
end $$;
revoke execute on function public.payment_claim_receipt(uuid) from public, anon, authenticated;

-- ---- 5. deposit adjust, due date --------------------------------------------------------
create or replace function public.invoice_set_deposit(p_invoice_id uuid, p_mode text, p_value numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_led record; v_total integer; v_res text; v_pct numeric;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;
  if v.kind not in ('deposit', 'progress') then return 'error:use_line_editor'; end if;
  select * into v_led from public.invoice_ledger(v.estimate_id);
  if coalesce(v_led.adjusted_contract_cents, 0) <= 0 then return 'error:nothing_to_invoice'; end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_total := round(v_led.adjusted_contract_cents * p_value / 100.0)::integer;
  elsif p_mode = 'fixed' then
    if p_value is null or p_value <= 0 or p_value <> trunc(p_value) then return 'error:bad_amount'; end if;
    v_total := p_value::integer;
  else
    return 'error:bad_mode';
  end if;

  v_res := public.invoice_set_draft_total(p_invoice_id, v_total);   -- bounds, GST, the money line, the event
  if v_res not like 'ok:%' then return v_res; end if;
  if v.kind = 'deposit' then
    v_pct := round(v_total * 100.0 / v_led.adjusted_contract_cents, 1);
    update public.invoice_lines
       set description = 'Deposit — ' || public.invoice_pct_text(v_pct) || '% of the contract price, payable on acceptance'
     where invoice_id = p_invoice_id and not informational
       and (select count(*) from public.invoice_lines l where l.invoice_id = p_invoice_id and not l.informational) = 1;
  end if;
  return 'ok:' || v_total::text;
end $$;
revoke execute on function public.invoice_set_deposit(uuid, text, numeric) from public, anon;
grant execute on function public.invoice_set_deposit(uuid, text, numeric) to authenticated;

create or replace function public.invoice_set_draft_due(p_invoice_id uuid, p_due_on date)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;           -- R13: locked once sent
  if p_due_on is null or p_due_on < (now() at time zone 'Australia/Melbourne')::date then return 'error:due_in_past'; end if;
  if v.due_on is not distinct from p_due_on then return 'ok:unchanged'; end if;
  update public.invoices set due_on = p_due_on where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'due_on', 'from', v.due_on, 'to', p_due_on));
  return 'ok:due_set';
end $$;
revoke execute on function public.invoice_set_draft_due(uuid, date) from public, anon;
grant execute on function public.invoice_set_draft_due(uuid, date) to authenticated;

-- ---- 6. change a sent deposit: void + reissue, one transaction ----------------------------
create or replace function public.invoice_change_amount(p_invoice_id uuid, p_mode text, p_value numeric, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_led record; v_total integer; v_rate numeric; v_gst integer;
        v_new uuid; v_res text; v_pct numeric; v_today date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.kind <> 'deposit' then return 'error:deposit_only'; end if;
  if v.status not in ('issued', 'sent', 'viewed') then return 'error:not_changeable'; end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice_id and status = 'succeeded') then
    return 'error:has_payments';
  end if;
  select * into v_led from public.invoice_ledger(v.estimate_id);
  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_total := round(v_led.adjusted_contract_cents * p_value / 100.0)::integer;
  elsif p_mode = 'fixed' then
    if p_value is null or p_value <= 0 or p_value <> trunc(p_value) then return 'error:bad_amount'; end if;
    v_total := p_value::integer;
  else
    return 'error:bad_mode';
  end if;
  if v_total > v_led.adjusted_contract_cents then return 'error:exceeds_contract'; end if;
  if v_total = v.total_inc_cents then return 'error:same_amount'; end if;

  v_res := public.invoice_void(p_invoice_id,
    'Deposit amount changed; replaced by a corrected invoice' || coalesce(nullif(' — ' || trim(coalesce(p_reason, '')), ' — '), ''));
  if v_res not like 'ok:%' then raise exception 'invoice_change_amount: void refused (%)', v_res; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_gst := public.gst_from_inc_cents(v_total::bigint, v_rate);
  v_pct := round(v_total * 100.0 / nullif(v_led.adjusted_contract_cents, 0), 1);
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status, due_on,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents, token)
    values (v.estimate_id, v.customer_id, v.work_order_id, 'deposit', 'draft',
            case when v.due_on >= v_today then v.due_on else null end,
            v_total, v_total - v_gst, v_gst, v_total, public.invoice_new_token())
    returning id into v_new;
  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, gst_cents)
    values (v_new, 0, 'manual',
            'Deposit — ' || public.invoice_pct_text(coalesce(v_pct, 0)) || '% of the contract price, payable on acceptance',
            v_total - v_gst, v_gst);
  perform public.invoice_event(v_new, 'drafted', 'staff',
    jsonb_build_object('auto', 'change_amount', 'replaces', p_invoice_id, 'replaces_number', v.number,
                       'total_inc_cents', v_total, 'deposit_pct', v_pct));
  v_res := public.invoice_issue(v_new);
  if v_res <> 'ok:issued' then raise exception 'invoice_change_amount: reissue refused (%)', v_res; end if;
  return 'ok:' || v_new::text;
end $$;
revoke execute on function public.invoice_change_amount(uuid, text, numeric, text) from public, anon;
grant execute on function public.invoice_change_amount(uuid, text, numeric, text) to authenticated;

-- ---- 7. Create deposit invoice on a booked job with none (staff guard is inside, 20270255) ----
grant execute on function public.invoice_draft_deposit(uuid, text) to authenticated;

-- ---- read-back: compare every value to its _expect_ ---------------------------------------
select
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'payment_status' and e.enumlabel = 'reversed') as reversed_value, true as _expect_reversed_value,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payments'
     and column_name in ('reversed_at', 'reversed_by', 'reversal_reason', 'receipt_sent_at', 'invoice_status_before'))::int as new_columns, 5 as _expect_new_columns,
  (select count(*) from public.invoice_transitions where from_status in ('paid', 'partially_paid')
     and to_status in ('issued', 'sent', 'viewed', 'partially_paid'))::int as undo_transitions, 7 as _expect_undo_transitions,
  (select position('v.due_on >= v_today' in prosrc) > 0 from pg_proc where proname = 'invoice_issue') as issue_keeps_due, true as _expect_issue_keeps_due,
  has_function_privilege('authenticated', 'public.invoice_record_full_payment(uuid, text)', 'execute') as full_payment_auth, true as _expect_full_payment_auth,
  has_function_privilege('authenticated', 'public.invoice_payment_undo(uuid, text)', 'execute') as undo_auth, true as _expect_undo_auth,
  has_function_privilege('authenticated', 'public.payment_claim_receipt(uuid)', 'execute') as claim_receipt_auth, false as _expect_claim_receipt_auth,
  has_function_privilege('authenticated', 'public.invoice_set_deposit(uuid, text, numeric)', 'execute') as set_deposit_auth, true as _expect_set_deposit_auth,
  has_function_privilege('authenticated', 'public.invoice_set_draft_due(uuid, date)', 'execute') as set_due_auth, true as _expect_set_due_auth,
  has_function_privilege('authenticated', 'public.invoice_change_amount(uuid, text, numeric, text)', 'execute') as change_amount_auth, true as _expect_change_amount_auth,
  has_function_privilege('authenticated', 'public.invoice_draft_deposit(uuid, text)', 'execute') as draft_deposit_auth, true as _expect_draft_deposit_auth,
  has_function_privilege('anon', 'public.invoice_payment_undo(uuid, text)', 'execute') as undo_anon, false as _expect_undo_anon;

insert into public._prod_migrations(name) values ('20270256000000_payments_quick_actions.sql') on conflict (name) do nothing;
