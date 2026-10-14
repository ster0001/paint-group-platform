-- A rate change sent to the painter counts each hour ONCE (Tom, 14 Oct 2026).
--
-- 73 Kerferd Street (PS-3613): the office set the contractor rate to $67 in
-- Revise scope (from the card $60) and drafted two changes the customer
-- signed — 6 h and 3 h, ALREADY priced at $67 ($402, $201). wo_sync_contractor_pay
-- (20270254) added the $7 uplift to the base hours AND to those 9 hours, so the
-- Change to your rate figure would read $63 high ($6,894 for $6,831). Its
-- filter matched rows at hours × coalesce(their own rate, agreed) — true for a
-- row at the new rate too. Now only rows still priced at the AGREED rate count.
-- The accept step (wo_contractor_answer_pay_change) moves the base by base
-- hours × difference and re-rates only rows at the old rate, so the pay the
-- painter ends with was already right; this fixes the figure they are shown.
--
-- Replaces one function body, same signature and grants. Converges on re-run.
set lock_timeout = '15s';

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
    -- revision changes still priced at hours × the AGREED rate. A change the
    -- office drafted at the new rate already carries it (73 Kerferd, 14 Oct
    -- 2026: 9 h drafted at $67 were uplifted again, +$63 on the figure the
    -- painter was asked to accept); a figure typed by hand stays as typed.
    select p_base_hours + coalesce(sum(case when credit then -1 else 1 end * coalesce(est_hours, 0)), 0)
      into v_hours
      from public.wo_variations
     where work_order_id = v_wo.id and revision_block_ref is not null
       and status = 'contractor_accepted' and coalesce(needs_manual_deduction, false) = false
       and coalesce(contractor_rate_cents, v_agreed) = v_agreed
       and contractor_delta_cents = round(coalesce(est_hours, 0) * v_agreed)::integer;
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

-- ---- read-back: compare each column to its _expect_ before calling this live ----
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_sync_contractor_pay') as sync_overloads, 1 as _expect_sync_overloads,
  (select position('coalesce(contractor_rate_cents, v_agreed) = v_agreed' in pg_get_functiondef('public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric)'::regprocedure)) > 0) as agreed_rate_filter, true as _expect_agreed_rate_filter,
  (select has_function_privilege('authenticated', 'public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric)', 'execute')) as sync_granted, true as _expect_sync_granted,
  (select has_function_privilege('anon', 'public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric)', 'execute')) as sync_anon, false as _expect_sync_anon;

insert into public._prod_migrations(name) values ('20270264000000_pay_change_no_double_uplift.sql') on conflict (name) do nothing;
