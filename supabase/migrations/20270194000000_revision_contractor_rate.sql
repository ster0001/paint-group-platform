-- =============================================================================
-- The contractor rate set in the revision working scope is the rate the
-- painter is offered (Tom, 24 Sep 2026: "if I adjust the contractor rate in
-- the revision working scope before I send it out to them in the schedule,
-- the rate offered is the rate the contractor sees, and if it is updated
-- before being sent out, the contractor sees the new rate").
--
-- Two gaps closed:
--   1. wo_draft_revision_variation priced every revision change's contractor
--      delta at the GLOBAL Settings rate, ignoring the estimate's own
--      "Contractor rate ($/hr)" override. It now takes the estimate's rate
--      (p_contractor_rate_cents, from the server action, via lib/pricing) and
--      falls back to the global rate when none is passed.
--   2. work_orders.contractor_payment_cents was fixed at issue. A new staff
--      RPC, wo_sync_contractor_pay, moves an UNSENT job's base pay to the
--      accepted scope priced at the current rate, and reprices this job's
--      revision variations (engine-priced ones only — a PC's manual deduction
--      is never touched). It refuses to move money on a job that has a
--      painter (wo_has_painter: named, offered/proposed/accepted, or assigned)
--      — a painter who has been offered a figure keeps that figure.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the draft takes the estimate's contractor rate -----------------------
drop function if exists public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric);

create or replace function public.wo_draft_revision_variation(
  p_estimate_id uuid, p_block_ref text, p_category text, p_comment text,
  p_credit boolean, p_surface_keys text[], p_price_cents integer,
  p_inputs jsonb, p_priced_lines jsonb, p_hours numeric,
  p_contractor_rate_cents integer default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo uuid; v_v public.wo_variations%rowtype; v_rate integer; v_delta integer; v_token text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  if v_wo is null then return 'error:no_work_order'; end if;

  if coalesce(trim(p_block_ref), '') = '' then return 'error:no_block_ref'; end if;
  if coalesce(trim(p_category), '') = '' then return 'error:no_category'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  if p_price_cents is null or p_price_cents < 0 then return 'error:bad_price'; end if;
  if p_hours is null or p_hours < 0 then return 'error:bad_hours'; end if;

  select * into v_v
    from public.wo_variations
   where work_order_id = v_wo and revision_block_ref = p_block_ref
     and status = 'priced'
   for update;

  -- The change has netted back to nothing: retire any standing draft.
  if p_price_cents = 0 and p_hours = 0 then
    if found then
      update public.wo_variations set status = 'cancelled' where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_wo, 'variation_revision_cancelled', auth.uid(), 'staff',
                jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref));
      return 'ok:cancelled';
    end if;
    return 'ok:no_change';
  end if;

  -- The estimate's own rate when the caller knows it (the builder's
  -- "Contractor rate" override, via lib/pricing); the global rate otherwise.
  v_rate  := coalesce(nullif(p_contractor_rate_cents, 0), public.wo_contractor_rate_cents());
  v_delta := round(p_hours * v_rate)::integer;
  if found then
    update public.wo_variations
       set category = trim(p_category), comment = trim(p_comment),
           credit = p_credit, surface_keys = p_surface_keys,
           price_cents = p_price_cents, priced_inputs = p_inputs,
           priced_lines = p_priced_lines, est_hours = p_hours,
           contractor_rate_cents = v_rate, contractor_delta_cents = v_delta
     where id = v_v.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo, 'variation_revision_updated', auth.uid(), 'staff',
              jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                                 'price_cents', p_price_cents, 'credit', p_credit,
                                 'hours', p_hours));
    return 'ok:' || v_v.customer_token;
  end if;

  -- The open offer on this job, if there is one — the new draft joins it.
  select customer_token into v_token
    from public.wo_variations
   where work_order_id = v_wo and status = 'priced'
     and revision_block_ref is not null and customer_token is not null
   order by created_at
   limit 1;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment,
       est_hours, status, priced_inputs, priced_lines, price_cents,
       contractor_rate_cents, contractor_delta_cents, customer_token,
       credit, surface_keys, revision_block_ref)
    values
      (v_wo, auth.uid(), 'staff', false, trim(p_category), trim(p_comment),
       p_hours, 'priced', p_inputs, p_priced_lines, p_price_cents,
       v_rate, v_delta, v_token,
       p_credit, p_surface_keys, trim(p_block_ref))
    returning * into v_v;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_wo, 'variation_priced', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                               'price_cents', p_price_cents, 'credit', p_credit,
                               'hours', p_hours, 'contractor_rate_cents', v_rate,
                               'contractor_delta_cents', v_delta, 'revision', true));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric, integer) to authenticated;

-- ---- 2. an unsent job's pay follows the current rate ---------------------------
create or replace function public.wo_sync_contractor_pay(
  p_estimate_id uuid, p_base_cents integer, p_rate_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_old integer; v_repriced integer := 0;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_base_cents is null or p_base_cents < 0 then return 'error:bad_base'; end if;
  if p_rate_cents is null or p_rate_cents <= 0 then return 'error:bad_rate'; end if;

  select * into v_wo from public.work_orders where estimate_id = p_estimate_id for update;
  if not found then return 'ok:no_work_order'; end if;

  -- Sent out already: the figure the painter was given stands.
  if public.wo_has_painter(v_wo.id) then return 'ok:live'; end if;

  v_old := v_wo.contractor_payment_cents;

  -- Revision changes on this job, engine-priced: hours × the new rate. A
  -- credit whose deduction the PC set by hand keeps that figure.
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

  if v_old is not distinct from p_base_cents and v_repriced = 0 then return 'ok:unchanged'; end if;

  update public.work_orders
     set contractor_payment_cents = p_base_cents,
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
grant execute on function public.wo_sync_contractor_pay(uuid, integer, integer) to authenticated;

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_draft_revision_variation') as draft_overloads, 1 as _expect_draft_overloads,
  (select pg_get_function_arguments(p.oid) like '%p_contractor_rate_cents%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_draft_revision_variation' limit 1) as draft_takes_rate, true as _expect_draft_takes_rate,
  (select has_function_privilege('authenticated', 'public.wo_sync_contractor_pay(uuid, integer, integer)', 'execute')) as sync_granted, true as _expect_sync_granted;

insert into public._prod_migrations(name) values ('20270194000000_revision_contractor_rate.sql') on conflict (name) do nothing;
