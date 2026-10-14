-- =============================================================================
-- 20270254 · A contractor RATE change skips the customer; an HOURS change never does
-- =============================================================================
-- Tom, 13 Oct 2026, correcting 20270253: "if a contractor's hourly rate
-- changes it should skip the customer, if it's the hours themselves it goes to
-- the customer." And: "for 73 Kerferd we already have a contractor on site, so
-- changes need to be approved by the client and then sent to the contractor
-- for approval."
--
-- 1. HOURS: the app stops calling wo_apply_hours_only_change (it stays in the
--    database, unused). Every hours change is drafted for the customer to sign,
--    then released to the painter on the job as before (20270220).
--    Repair: rows that path sent straight to a painter who has NOT answered yet
--    are cancelled (their untouched tick rows go with them) — the next "Save &
--    draft" in Revise scope drafts them for the customer properly. A row the
--    painter already accepted stands.
--
-- 2. RATE, with a painter on the job: the new rate is a PAY CHANGE held on the
--    job (work_orders.pay_change_*) for the contractor to Accept or Decline —
--    never a variation row, so it can never reach a customer's page, signing
--    link or invoice. Accept moves the base pay by base hours × the rate
--    difference and re-rates the agreed revision changes; Decline leaves
--    everything at the agreed rate.
--      work_orders.contractor_rate_cents   the AGREED $/h (backfilled from the
--                                          last contractor_pay_synced event)
--      wo_sync_contractor_pay              + p_accepted_rate_cents, p_base_hours
--                                          (defaults keep the old call working);
--                                          live job + new rate → 'ok:pay_change_sent'
--      wo_contractor_answer_pay_change     NEW: the painter's Accept / Decline
--    Before anyone has the job: unchanged — the job's pay simply follows (and
--    now stamps contractor_rate_cents).
-- Converges on a re-run: add column if not exists, drop-first/or-replace,
-- guarded backfill and repair.
-- =============================================================================
set lock_timeout = '15s';

alter table public.work_orders
  add column if not exists contractor_rate_cents integer,
  add column if not exists pay_change_rate_cents integer,
  add column if not exists pay_change_from_rate_cents integer,
  add column if not exists pay_change_base_hours numeric,
  add column if not exists pay_change_from_cents integer,
  add column if not exists pay_change_to_cents integer,
  add column if not exists pay_change_sent_at timestamptz;

do $$ begin
  alter table public.work_orders add constraint work_orders_pay_change_amounts_check
    check (coalesce(contractor_rate_cents, 1) > 0
       and coalesce(pay_change_rate_cents, 1) > 0
       and coalesce(pay_change_from_rate_cents, 1) > 0
       and coalesce(pay_change_base_hours, 0) >= 0
       and coalesce(pay_change_from_cents, 0) >= 0
       and coalesce(pay_change_to_cents, 0) >= 0);
exception when duplicate_object then null; end $$;

-- The agreed rate on jobs synced before today: the last rate the job's pay was moved to.
update public.work_orders w
   set contractor_rate_cents = e.rate
  from (select distinct on (work_order_id) work_order_id, (meta->>'rate_cents')::integer as rate
          from public.wo_events
         where type = 'contractor_pay_synced' and (meta->>'rate_cents') ~ '^[0-9]+$'
         order by work_order_id, created_at desc) e
 where e.work_order_id = w.id and w.contractor_rate_cents is null and e.rate > 0;

-- ---- 1. repair: hours-only rows that skipped the customer -----------------------
with gone as (
  update public.wo_variations
     set status = 'cancelled'
   where hours_only and status = 'customer_approved' and contractor_accepted_at is null
  returning id, work_order_id
), rows_gone as (
  delete from public.wo_surfaces s
   using gone g
   where s.added_by_variation = g.id and s.state = 'todo'
  returning s.id
)
insert into public.wo_events (work_order_id, type, actor_kind, meta)
select g.work_order_id, 'variation_revision_cancelled', 'system',
       jsonb_build_object('variation_id', g.id, 'reason', 'hours change goes to the customer first (20270254)')
  from gone g;

-- ---- 2. the sync: a live job's new rate is a pay change for the painter ---------
drop function if exists public.wo_sync_contractor_pay(uuid, integer, integer);
create or replace function public.wo_sync_contractor_pay(
  p_estimate_id uuid, p_base_cents integer, p_rate_cents integer,
  p_accepted_rate_cents integer default null, p_base_hours numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_old integer; v_repriced integer := 0;
        v_agreed integer; v_hours numeric; v_from integer; v_to integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_base_cents is null or p_base_cents < 0 then return 'error:bad_base'; end if;
  if p_rate_cents is null or p_rate_cents <= 0 then return 'error:bad_rate'; end if;

  select * into v_wo from public.work_orders where estimate_id = p_estimate_id for update;
  if not found then return 'ok:no_work_order'; end if;

  if public.wo_has_painter(v_wo.id) then
    -- An employee is paid by the hour, not by the job: nothing to agree.
    if public.wo_is_employee_job(v_wo.id) then return 'ok:live'; end if;
    v_agreed := coalesce(v_wo.contractor_rate_cents, nullif(p_accepted_rate_cents, 0));
    if v_agreed is null or p_base_hours is null or p_base_hours < 0 then return 'ok:live'; end if;

    if p_rate_cents = v_agreed then
      -- Back to the agreed rate: a pending change is withdrawn.
      if v_wo.pay_change_rate_cents is not null then
        update public.wo_variations
           set contractor_rate_cents = v_agreed,
               contractor_delta_cents = round(coalesce(est_hours, 0) * v_agreed)::integer
         where work_order_id = v_wo.id and revision_block_ref is not null
           and status in ('priced', 'customer_approved')
           and coalesce(needs_manual_deduction, false) = false
           and contractor_rate_cents = v_wo.pay_change_rate_cents;
        update public.work_orders
           set pay_change_rate_cents = null, pay_change_from_rate_cents = null, pay_change_base_hours = null,
               pay_change_from_cents = null, pay_change_to_cents = null, pay_change_sent_at = null
         where id = v_wo.id;
        insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
          values (v_wo.id, 'pay_change_withdrawn', auth.uid(), 'staff', jsonb_build_object('rate_cents', v_agreed));
        return 'ok:pay_change_withdrawn';
      end if;
      return 'ok:live';
    end if;

    if v_wo.pay_change_rate_cents = p_rate_cents then return 'ok:pay_change_pending'; end if;

    -- The agreed hours the new rate applies to: the base scope, plus the agreed
    -- revision changes still priced at hours × rate (a figure the office typed
    -- by hand stays as typed).
    select p_base_hours + coalesce(sum(case when credit then -1 else 1 end * coalesce(est_hours, 0)), 0)
      into v_hours
      from public.wo_variations
     where work_order_id = v_wo.id and revision_block_ref is not null
       and status = 'contractor_accepted' and coalesce(needs_manual_deduction, false) = false
       and contractor_delta_cents = round(coalesce(est_hours, 0) * coalesce(contractor_rate_cents, v_agreed))::integer;
    v_from := greatest(0, coalesce(v_wo.contractor_payment_cents, 0) + public.wo_contractor_variations_cents(v_wo.id));
    v_to := greatest(0, v_from + round(greatest(v_hours, 0) * (p_rate_cents - v_agreed))::integer);

    -- Changes not yet agreed follow the new rate straight away.
    update public.wo_variations
       set contractor_rate_cents = p_rate_cents,
           contractor_delta_cents = round(coalesce(est_hours, 0) * p_rate_cents)::integer
     where work_order_id = v_wo.id and revision_block_ref is not null
       and status in ('priced', 'customer_approved')
       and coalesce(needs_manual_deduction, false) = false;

    update public.work_orders
       set pay_change_rate_cents = p_rate_cents, pay_change_from_rate_cents = v_agreed,
           pay_change_base_hours = p_base_hours,
           pay_change_from_cents = v_from, pay_change_to_cents = v_to, pay_change_sent_at = now()
     where id = v_wo.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo.id, 'pay_change_sent', auth.uid(), 'staff',
              jsonb_build_object('from_rate_cents', v_agreed, 'to_rate_cents', p_rate_cents,
                                 'from_cents', v_from, 'to_cents', v_to, 'hours', v_hours));
    return 'ok:pay_change_sent';
  end if;

  -- Nobody has the job: the pay simply follows (20270194 body) and the rate is stamped.
  v_old := v_wo.contractor_payment_cents;

  update public.wo_variations
     set contractor_rate_cents = p_rate_cents,
         contractor_delta_cents = round(coalesce(est_hours, 0) * p_rate_cents)::integer
   where work_order_id = v_wo.id
     and revision_block_ref is not null
     and status in ('priced', 'customer_approved', 'contractor_accepted')
     and coalesce(needs_manual_deduction, false) = false
     and (contractor_rate_cents is distinct from p_rate_cents
          or contractor_delta_cents is distinct from round(coalesce(est_hours, 0) * p_rate_cents)::integer);
  get diagnostics v_repriced = row_count;

  if v_old is not distinct from p_base_cents and v_repriced = 0
     and v_wo.contractor_rate_cents is not distinct from p_rate_cents then
    return 'ok:unchanged';
  end if;

  update public.work_orders
     set contractor_payment_cents = p_base_cents,
         contractor_rate_cents = p_rate_cents,
         wo_snapshot = case when jsonb_typeof(wo_snapshot) = 'object'
                            then jsonb_set(wo_snapshot, '{contractorPaymentCents}', to_jsonb(p_base_cents), true)
                            else wo_snapshot end
   where id = v_wo.id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_wo.id, 'contractor_pay_synced', auth.uid(), 'staff',
            jsonb_build_object('from_cents', v_old, 'to_cents', p_base_cents,
                               'rate_cents', p_rate_cents, 'variations_repriced', v_repriced));
  return 'ok:synced';
end $$;
revoke execute on function public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric) from public, anon;
grant execute on function public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric) to authenticated;

-- ---- 3. the painter answers -----------------------------------------------------
create or replace function public.wo_contractor_answer_pay_change(
  p_work_order_id uuid, p_accept boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_diff integer; v_base integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;
  if v_wo.pay_change_rate_cents is null then return 'error:nothing_pending'; end if;
  if p_accept is null then return 'error:no_answer'; end if;
  if not p_accept and coalesce(trim(p_note), '') = '' then return 'error:note_required'; end if;

  if p_accept then
    v_diff := v_wo.pay_change_rate_cents - v_wo.pay_change_from_rate_cents;
    v_base := greatest(0, coalesce(v_wo.contractor_payment_cents, 0) + round(v_wo.pay_change_base_hours * v_diff)::integer);
    -- Agreed revision changes priced at hours × the old rate move to the new one.
    update public.wo_variations
       set contractor_rate_cents = v_wo.pay_change_rate_cents,
           contractor_delta_cents = round(coalesce(est_hours, 0) * v_wo.pay_change_rate_cents)::integer
     where work_order_id = v_wo.id and revision_block_ref is not null
       and status = 'contractor_accepted' and coalesce(needs_manual_deduction, false) = false
       and contractor_delta_cents = round(coalesce(est_hours, 0) * coalesce(contractor_rate_cents, v_wo.pay_change_from_rate_cents))::integer;
    update public.work_orders
       set contractor_payment_cents = v_base,
           contractor_rate_cents = v_wo.pay_change_rate_cents,
           wo_snapshot = case when jsonb_typeof(wo_snapshot) = 'object'
                              then jsonb_set(wo_snapshot, '{contractorPaymentCents}', to_jsonb(v_base), true)
                              else wo_snapshot end,
           pay_change_rate_cents = null, pay_change_from_rate_cents = null, pay_change_base_hours = null,
           pay_change_from_cents = null, pay_change_to_cents = null, pay_change_sent_at = null
     where id = v_wo.id;
  else
    -- Declined: the agreed rate stands, and so do the not-yet-agreed changes' figures.
    update public.wo_variations
       set contractor_rate_cents = v_wo.pay_change_from_rate_cents,
           contractor_delta_cents = round(coalesce(est_hours, 0) * v_wo.pay_change_from_rate_cents)::integer
     where work_order_id = v_wo.id and revision_block_ref is not null
       and status in ('priced', 'customer_approved')
       and coalesce(needs_manual_deduction, false) = false
       and contractor_rate_cents = v_wo.pay_change_rate_cents;
    update public.work_orders
       set contractor_rate_cents = coalesce(contractor_rate_cents, v_wo.pay_change_from_rate_cents),
           pay_change_rate_cents = null, pay_change_from_rate_cents = null, pay_change_base_hours = null,
           pay_change_from_cents = null, pay_change_to_cents = null, pay_change_sent_at = null
     where id = v_wo.id;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_wo.id, case when p_accept then 'pay_change_accepted' else 'pay_change_declined' end, auth.uid(), v_kind,
            jsonb_build_object('from_rate_cents', v_wo.pay_change_from_rate_cents, 'to_rate_cents', v_wo.pay_change_rate_cents,
                               'from_cents', v_wo.pay_change_from_cents, 'to_cents', v_wo.pay_change_to_cents,
                               'note', coalesce(trim(p_note), '')));
  return case when p_accept then 'ok:accepted' else 'ok:declined' end;
end $$;
revoke execute on function public.wo_contractor_answer_pay_change(uuid, boolean, text) from public, anon;
grant execute on function public.wo_contractor_answer_pay_change(uuid, boolean, text) to authenticated;

-- ---- read-back: compare each column to its _expect_ before calling this live ----
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'work_orders'
      and column_name in ('contractor_rate_cents', 'pay_change_rate_cents', 'pay_change_from_rate_cents',
                          'pay_change_base_hours', 'pay_change_from_cents', 'pay_change_to_cents', 'pay_change_sent_at')) as new_cols, 7 as _expect_new_cols,
  (select count(*) from pg_constraint where conname = 'work_orders_pay_change_amounts_check') as amounts_check, 1 as _expect_amounts_check,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_sync_contractor_pay') as sync_overloads, 1 as _expect_sync_overloads,
  (select has_function_privilege('authenticated', 'public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric)', 'execute')) as sync_granted, true as _expect_sync_granted,
  (select has_function_privilege('authenticated', 'public.wo_contractor_answer_pay_change(uuid, boolean, text)', 'execute')) as answer_granted, true as _expect_answer_granted,
  (select has_function_privilege('anon', 'public.wo_contractor_answer_pay_change(uuid, boolean, text)', 'execute')) as answer_anon, false as _expect_answer_anon,
  (select has_function_privilege('anon', 'public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric)', 'execute')) as sync_anon, false as _expect_sync_anon,
  (select count(*) from public.wo_variations where hours_only and status = 'customer_approved' and contractor_accepted_at is null) as hours_only_waiting, 0 as _expect_hours_only_waiting;

insert into public._prod_migrations(name) values ('20270254000000_revision_rate_skips_customer.sql') on conflict (name) do nothing;
