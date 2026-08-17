-- =============================================================================
-- R3 batch 1 — work order issuing and scheduling through the server boundary
--
-- REGRESSION FIX. The R2 lockdown revoked wo_snapshot / contractor_payment_cents
-- / status / issued_at / contractor_id / start_date on work_orders from client
-- roles — correctly, since they are money and state — but the builder's "Issue
-- to contractor" button and its contractor/start-date controls still wrote them
-- directly. Those three things have been broken since that migration ran.
--
-- The fix is the same shape as the booking functions: no document and no money
-- from the caller. issue_work_order reads BOTH from the estimate's own saved
-- work-order document (builder_state->'woDoc'), exactly as accept_estimate
-- already does, so issuing cannot be used to inject a payment figure.
-- =============================================================================

create or replace function public.issue_work_order(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_doc jsonb; v_pay integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;

  select builder_state->'woDoc' into v_doc from public.estimates where id = v_wo.estimate_id;
  if v_doc is null then return 'error:nothing_to_issue'; end if;   -- save the estimate first

  -- Payment comes out of the stored document, never off the wire.
  v_pay := nullif(v_doc->>'contractorPaymentCents', '')::integer;

  update public.work_orders
     set wo_snapshot = jsonb_set(v_doc, '{status}', '"issued"'),
         contractor_payment_cents = coalesce(v_pay, contractor_payment_cents),
         status = case when status = 'draft' then 'issued'::public.wo_status else status end,
         issued_at = coalesce(issued_at, now())
   where id = p_work_order_id;

  return 'ok:issued';
end $$;
grant execute on function public.issue_work_order(uuid) to authenticated;

-- Assignment and start date from the work-order tab. Kept separate from the
-- booking flow: this is staff setting up a job, not offering it.
create or replace function public.set_work_order_schedule(
  p_work_order_id uuid, p_contractor_id uuid default null, p_start_date date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_live integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  -- Reassigning underneath a live offer would desync the two. Withdraw first.
  select count(*) into v_live from public.booking_offers
   where work_order_id = p_work_order_id and state in ('offered', 'proposed');
  if v_live > 0 and p_contractor_id is distinct from
     (select contractor_id from public.work_orders where id = p_work_order_id) then
    return 'conflict:live_offer';
  end if;

  update public.work_orders
     set contractor_id = coalesce(p_contractor_id, contractor_id),
         start_date = coalesce(p_start_date, start_date)
   where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:updated';
end $$;
grant execute on function public.set_work_order_schedule(uuid, uuid, date) to authenticated;

-- Clearing a value needs an explicit path, since coalesce above means "keep".
create or replace function public.clear_work_order_contractor(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.work_orders set contractor_id = null where id = p_work_order_id;
  return 'ok:cleared';
end $$;
grant execute on function public.clear_work_order_contractor(uuid) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- select public.issue_work_order('<draft work order id>');
--   -> 'ok:issued'; wo_snapshot populated and contractor_payment_cents equal to
--      the estimate's saved woDoc figure — the caller supplied neither.
-- select public.issue_work_order('<wo whose estimate was never saved>');
--   -> 'error:nothing_to_issue'
-- select public.set_work_order_schedule('<wo with a live offer>', '<other contractor>');
--   -> 'conflict:live_offer'
