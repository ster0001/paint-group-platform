-- =============================================================================
-- An offer may only go to a compliant contractor
--
-- FOUND BY THE END-TO-END TEST, not by reading the code. The offer->accept
-- smoke test dropped a job on the first lane of the board, which happened to be
-- a contractor with no verified insurance certificate. The offer went out
-- normally. Had she accepted, an uninsured painter would have been booked into
-- a customer's home.
--
-- send_offer checked `active` (not suspended) but never `offerable` - the flag
-- the entire compliance system exists to compute. Everything upstream was
-- right: the trigger that computes it, the staff verification step, the column
-- privileges that stop a contractor setting it themselves. Nothing consulted it
-- at the moment it mattered.
--
-- This also closes the stale-flag gap recorded since Phase A: `offerable` is
-- recomputed only when a contractor_documents row changes, so a certificate
-- that lapses while sitting untouched leaves it reading true. Recomputing here,
-- at the point of use, means an offer can never be sent on the strength of a
-- certificate that expired last month.
--
-- The board still SHOWS non-offerable lanes on purpose - staff need to see who
-- is nearly ready, and those lanes are already marked. What changes is that the
-- send is refused rather than quietly allowed.
--
-- Otherwise IDENTICAL to 20260902000000: same locking, same one-live-offer
-- check, same hours derivation, same server-side payment. Only the compliance
-- gate is new.
-- =============================================================================

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
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;

  select active into v_active from public.contractors where id = p_contractor_id;
  if v_active is null then return 'error:contractor_not_found'; end if;
  if not v_active then return 'error:contractor_suspended'; end if;

  -- NEW: re-derive compliance from the documents themselves rather than
  -- trusting the stored flag, then refuse if it doesn't hold.
  perform public.contractor_recompute_offerable(p_contractor_id);
  select offerable into v_offerable from public.contractors where id = p_contractor_id;
  if not coalesce(v_offerable, false) then return 'error:not_offerable'; end if;

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

-- ---- Verification -----------------------------------------------------------
-- As staff, offering a contractor with no verified insurance must now return
-- 'error:not_offerable' and create no row:
--   select public.send_offer('<issued wo id>', '<non-offerable contractor id>', current_date + 7);
--   select count(*) from booking_offers
--    where contractor_id = '<that id>' and state = 'offered';
