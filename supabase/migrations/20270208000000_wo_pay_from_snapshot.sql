-- =============================================================================
-- The painter's offered amount was blank (Tom, 1 Oct 2026 — "add the offered
-- amount in the offered page for a job").
--
-- The money was there all along: every issued work order's frozen document
-- carries contractorPaymentCents. But only issue_work_order (the builder's
-- Issue button) copies it into work_orders.contractor_payment_cents; the work
-- orders the ACCEPTANCE creates (accept_estimate → insert with wo_snapshot) and
-- the import paths leave the column null. send_offer reads the column alone, so
-- 19 of the last 60 issued jobs went out with booking_offers.payment_cents =
-- null and the portal said "Your price —" / showed nothing.
--
-- One rule: the base pay is the column, else the document. Enforced three
-- ways so no writer can recreate the gap —
--   1. wo_base_pay_cents(work_orders)  — the helper every reader uses
--   2. a BEFORE trigger fills the column from the document on insert/update
--   3. send_offer uses the helper
-- and the existing rows are backfilled: work orders first, then every live or
-- accepted offer still carrying null.
--
-- Converges on a re-run. Paste starts with a lock timeout so a busy table
-- fails loudly instead of deadlocking.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the helper ------------------------------------------------------------
-- A definer-function helper: no grant, runs as the owner of its callers.
create or replace function public.wo_base_pay_cents(p_wo public.work_orders)
returns integer language sql immutable as $$
  select coalesce(
    p_wo.contractor_payment_cents,
    case when jsonb_typeof(p_wo.wo_snapshot) = 'object'
          and (p_wo.wo_snapshot->>'contractorPaymentCents') ~ '^\d+(\.\d+)?$'
         then round((p_wo.wo_snapshot->>'contractorPaymentCents')::numeric)::integer
         else null end)
$$;
revoke all on function public.wo_base_pay_cents(public.work_orders) from public, anon, authenticated;

-- ---- 2. the column follows the document ---------------------------------------
create or replace function public.wo_fill_pay_from_snapshot()
returns trigger language plpgsql as $$
begin
  if new.contractor_payment_cents is null
     and jsonb_typeof(new.wo_snapshot) = 'object'
     and (new.wo_snapshot->>'contractorPaymentCents') ~ '^\d+(\.\d+)?$' then
    new.contractor_payment_cents := round((new.wo_snapshot->>'contractorPaymentCents')::numeric)::integer;
  end if;
  return new;
end $$;
revoke all on function public.wo_fill_pay_from_snapshot() from public, anon, authenticated;

drop trigger if exists t_wo_fill_pay_from_snapshot on public.work_orders;
create trigger t_wo_fill_pay_from_snapshot
  before insert or update of wo_snapshot, contractor_payment_cents on public.work_orders
  for each row execute function public.wo_fill_pay_from_snapshot();

-- ---- 3. send_offer reads the one rule -----------------------------------------
-- Body as 20270192 (variation bundle), with v_pay built on wo_base_pay_cents.
create or replace function public.send_offer(
  p_work_order_id uuid,
  p_contractor_id uuid,
  p_start date,
  p_end date default null,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_active boolean;
  v_offerable boolean;
  v_hours numeric;
  v_offer_id uuid;
  v_base integer;
  v_pay integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;

  select active into v_active from public.contractors where id = p_contractor_id;
  if v_active is null then return 'error:contractor_not_found'; end if;
  if not v_active then return 'error:contractor_suspended'; end if;

  perform public.contractor_recompute_offerable(p_contractor_id);
  select offerable into v_offerable from public.contractors where id = p_contractor_id;
  if not coalesce(v_offerable, false) then return 'error:not_offerable'; end if;

  if exists (
    select 1 from public.booking_offers
     where work_order_id = p_work_order_id and state in ('offered', 'proposed')
  ) then
    return 'conflict:already_offered';
  end if;

  -- Hours allowance comes from the frozen work-order document, not the caller.
  select coalesce(sum((s->>'hours')::numeric), 0) into v_hours
    from jsonb_array_elements(coalesce(v_wo.wo_snapshot->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s;

  -- Server-side truth, never the client's number: the job's base pay (column,
  -- else the frozen document — 20270208) plus what the customer has already
  -- signed and nobody was on the job to accept.
  v_base := public.wo_base_pay_cents(v_wo);
  v_pay := case when v_base is null then null
                else greatest(0, v_base + public.wo_contractor_variations_cents(v_wo.id)) end;

  insert into public.booking_offers (
    work_order_id, contractor_id, start_date, end_date,
    hours_allowance, payment_cents, staff_note, expires_at
  ) values (
    p_work_order_id, p_contractor_id, p_start, p_end,
    nullif(v_hours, 0),
    v_pay,
    coalesce(p_note, ''),
    now() + interval '24 hours'
  ) returning id into v_offer_id;

  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id,
                               'payment_cents', v_pay, 'base_payment_cents', v_base,
                               'start', p_start),
            auth.uid());

  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

-- ---- 4. backfill: the rows already out there ---------------------------------
update public.work_orders w
   set contractor_payment_cents = public.wo_base_pay_cents(w)
 where w.contractor_payment_cents is null
   and public.wo_base_pay_cents(w) is not null;

update public.booking_offers o
   set payment_cents = greatest(0, w.contractor_payment_cents + public.wo_contractor_variations_cents(w.id))
  from public.work_orders w
 where w.id = o.work_order_id
   and o.payment_cents is null
   and o.state in ('offered', 'proposed', 'accepted')
   and w.contractor_payment_cents is not null;

notify pgrst, 'reload schema';

-- ---- read-back: compare to the _expect_ columns before calling it live --------
select
  (select count(*) from pg_trigger where tgname = 't_wo_fill_pay_from_snapshot' and not tgisinternal) as trigger_present, 1 as _expect_trigger_present,
  (select count(*) from public.work_orders w
    where w.contractor_payment_cents is null and public.wo_base_pay_cents(w) is not null) as wos_still_unfilled, 0 as _expect_wos_still_unfilled,
  (select count(*) from public.booking_offers o join public.work_orders w on w.id = o.work_order_id
    where o.payment_cents is null and o.state in ('offered', 'proposed', 'accepted')
      and w.contractor_payment_cents is not null) as offers_still_unfilled, 0 as _expect_offers_still_unfilled,
  (select has_function_privilege('authenticated', 'public.send_offer(uuid, uuid, date, date, text)', 'execute')) as send_offer_granted, true as _expect_send_offer_granted,
  (select has_function_privilege('authenticated', 'public.wo_base_pay_cents(public.work_orders)', 'execute')) as helper_granted, false as _expect_helper_granted;

insert into public._prod_migrations(name) values ('20270208000000_wo_pay_from_snapshot.sql') on conflict (name) do nothing;
