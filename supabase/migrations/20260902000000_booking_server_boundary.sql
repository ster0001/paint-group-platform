-- =============================================================================
-- R2 — the server boundary for booking money and state
--
-- Closes audit findings C1, C2 and C3 for the booking path.
--
-- BEFORE: the browser inserted booking offers directly, supplying its own
-- payment_cents, across two or three separate calls. A devtools user could
-- offer a job at any price; a dropped connection could leave a job assigned
-- with no offer; a stale tab could withdraw an offer that had already been
-- accepted.
--
-- AFTER:
--   * every transition is one SECURITY DEFINER function = one transaction;
--   * each takes the EXPECTED CURRENT STATE and raises a typed conflict if the
--     row has moved on — this is what kills the stale-tab problem;
--   * no function accepts an amount. The contractor's payment is read from
--     work_orders.contractor_payment_cents, which the server itself wrote from
--     lib/pricing when the work order was issued. Money never crosses the wire
--     from a client;
--   * client roles lose INSERT/UPDATE on booking_offers entirely, so bypassing
--     the functions with supabase-js is refused by the database.
--
-- Conflict contract: every function returns text. 'ok:<state>' on success,
-- 'conflict:<actual state>' when the row wasn't where the caller thought,
-- 'error:<reason>' otherwise. Callers surface conflicts as "this has changed —
-- refresh", never as a crash.
-- =============================================================================

-- ---- 1. send an offer -------------------------------------------------------
-- Derives the payment from stored pricing data. Takes no amount.
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
  v_hours numeric;
  v_offer_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;

  select active into v_active from public.contractors where id = p_contractor_id;
  if v_active is null then return 'error:contractor_not_found'; end if;
  if not v_active then return 'error:contractor_suspended'; end if;

  -- One live offer per job. The partial unique index is the real guard; this
  -- check exists so the caller gets a clean message instead of a constraint.
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

  insert into public.booking_offers (
    work_order_id, contractor_id, start_date, end_date,
    hours_allowance, payment_cents, staff_note, expires_at
  ) values (
    p_work_order_id, p_contractor_id, p_start, p_end,
    nullif(v_hours, 0),
    v_wo.contractor_payment_cents,   -- server-side truth, never the client's number
    coalesce(p_note, ''),
    now() + interval '24 hours'
  ) returning id into v_offer_id;

  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id,
                               'payment_cents', v_wo.contractor_payment_cents, 'start', p_start),
            auth.uid());

  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

-- ---- 2. withdraw ------------------------------------------------------------
create or replace function public.withdraw_offer(p_offer_id uuid, p_expected_state text)
returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_rows integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  update public.booking_offers
     set state = 'withdrawn', responded_at = now()
   where id = p_offer_id
     and state::text = p_expected_state          -- the stale-tab guard
     and state in ('offered', 'proposed');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select * into v_o from public.booking_offers where id = p_offer_id;
    if not found then return 'error:not_found'; end if;
    return 'conflict:' || v_o.state;             -- caller says "refresh"
  end if;

  select * into v_o from public.booking_offers where id = p_offer_id;
  update public.work_orders set contractor_id = null where id = v_o.work_order_id;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_o.contractor_id, 'offer_withdrawn', jsonb_build_object('offer_id', p_offer_id), auth.uid());

  return 'ok:withdrawn';
end $$;
grant execute on function public.withdraw_offer(uuid, text) to authenticated;

-- ---- 3. reassign ------------------------------------------------------------
-- Cancel + re-offer to someone else, atomically, so the one-live-offer rule
-- can never be momentarily violated.
create or replace function public.reassign_offer(
  p_offer_id uuid, p_new_contractor_id uuid, p_start date, p_end date default null,
  p_expected_state text default 'offered'
) returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_rows integer; v_result text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  update public.booking_offers
     set state = 'cancelled', cancelled_at = now(), responded_at = now(),
         cancelled_reason = 'Reassigned to another contractor'
   where id = p_offer_id and state::text = p_expected_state and state in ('offered', 'proposed');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select * into v_o from public.booking_offers where id = p_offer_id;
    if not found then return 'error:not_found'; end if;
    return 'conflict:' || v_o.state;
  end if;

  select * into v_o from public.booking_offers where id = p_offer_id;
  -- Same function, so the new offer gets the same server-derived payment.
  v_result := public.send_offer(v_o.work_order_id, p_new_contractor_id, p_start, p_end, '');
  if v_result not like 'ok:%' then
    raise exception 'reassign failed: %', v_result;  -- rolls the cancel back too
  end if;
  return 'ok:reassigned';
end $$;
grant execute on function public.reassign_offer(uuid, uuid, date, date, text) to authenticated;

-- ---- 4. move an existing booking's dates ------------------------------------
create or replace function public.move_booking(
  p_offer_id uuid, p_start date, p_end date default null, p_expected_state text default 'accepted'
) returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_rows integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;

  update public.booking_offers
     set start_date = p_start, end_date = p_end
   where id = p_offer_id and state::text = p_expected_state
     and state in ('offered', 'proposed', 'accepted');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select * into v_o from public.booking_offers where id = p_offer_id;
    if not found then return 'error:not_found'; end if;
    return 'conflict:' || v_o.state;
  end if;

  select * into v_o from public.booking_offers where id = p_offer_id;
  -- Only a booked job pins its date onto the work order.
  if v_o.state = 'accepted' then
    update public.work_orders set start_date = p_start where id = v_o.work_order_id;
  end if;
  return 'ok:moved';
end $$;
grant execute on function public.move_booking(uuid, date, date, text) to authenticated;

-- ---- 5. shut the back door --------------------------------------------------
-- Server actions alone don't stop a devtools user calling supabase-js with the
-- anon key. Client roles lose write access to the booking table outright; every
-- write now happens inside the functions above, which run as the owner.
--
-- Reads are untouched — the existing SELECT policies still apply.
revoke insert, update, delete on public.booking_offers from authenticated;

-- work_orders: the money and assignment columns are server-owned. Everything
-- else (crew notes, colours, access notes) stays hand-editable by staff.
revoke update on public.work_orders from authenticated;
do $$ declare v_cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'work_orders'
     and column_name not in (
       'id', 'estimate_id', 'created_at',
       'contractor_id', 'contractor_payment_cents', 'start_date', 'status',
       'wo_snapshot', 'issued_at', 'share_token'
     );
  execute format('grant update (%s) on public.work_orders to authenticated', v_cols);
  raise notice 'work_orders: staff may still hand-edit: %', v_cols;
end $$;

-- ---- Verification -----------------------------------------------------------
-- As staff, from the browser console, each of these must now FAIL:
--   supabase.from('booking_offers').insert({...})            -> permission denied
--   supabase.from('booking_offers').update({payment_cents:1}) -> permission denied
--   supabase.from('work_orders').update({contractor_payment_cents: 1}) -> denied
-- while this still works:
--   supabase.from('work_orders').update({crew_notes: 'x'})
--
-- Stale-tab guard:
--   select public.withdraw_offer('<accepted offer id>', 'offered');
--   -> 'conflict:accepted'   (nothing changes)
--
-- Server-derived money:
--   select public.send_offer('<issued wo id>', '<contractor id>', current_date + 7);
--   -> 'ok:offered', and booking_offers.payment_cents equals
--      work_orders.contractor_payment_cents — the caller never supplied it.
