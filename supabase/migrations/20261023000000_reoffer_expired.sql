-- =============================================================================
-- Reoffer has to work on an offer that has already lapsed
--
-- expire_booking_offers() runs opportunistically whenever anyone loads offers,
-- so a breached offer becomes 'expired' within minutes — and wo_reoffer only
-- accepted 'offered' or 'proposed'. The button therefore worked only in the
-- window BEFORE the sweep caught up, which is the opposite of when it is needed.
--
-- An expired or declined offer is exactly the case Reoffer exists for.
-- 'withdrawn' stays out: that one has already been reoffered.
-- =============================================================================

create or replace function public.wo_reoffer(
  p_offer_id uuid, p_contractor_id uuid, p_start date,
  p_end date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_wo public.work_orders%rowtype;
        v_sent text; v_msg text; v_title text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.state not in ('offered', 'proposed', 'expired', 'declined') then
    return 'error:already_' || v_o.state::text;
  end if;
  if p_contractor_id = v_o.contractor_id then return 'error:same_contractor'; end if;

  select * into v_wo from public.work_orders where id = v_o.work_order_id;
  v_title := coalesce(v_wo.wo_snapshot->>'jobTitle', v_wo.wo_ref);

  -- Only a still-live offer needs withdrawing; an expired one is already gone.
  if v_o.state in ('offered', 'proposed') then
    update public.booking_offers
       set state = 'withdrawn', responded_at = coalesce(responded_at, now())
     where id = p_offer_id;
  end if;

  v_msg := 'Your offer for ' || v_title || ' has lapsed and the job has been '
        || 'reoffered. Nothing for you to do — we will be in touch with the next one.';

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_o.contractor_id, 'offer_lapsed',
            jsonb_build_object('work_order_id', v_o.work_order_id, 'offer_id', p_offer_id,
                               'job', v_title, 'message', v_msg),
            auth.uid());

  v_sent := public.send_offer(v_o.work_order_id, p_contractor_id, p_start, p_end, p_note);
  if v_sent is null or v_sent like 'error:%' then
    raise exception 'reoffer failed at send_offer: %', v_sent;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_o.work_order_id, 'offer_reoffered', auth.uid(), 'staff',
            jsonb_build_object('from_contractor', v_o.contractor_id,
                               'to_contractor', p_contractor_id,
                               'lapsed_offer_id', p_offer_id,
                               'was_state', v_o.state::text, 'result', v_sent));

  return 'ok:reoffered';
end $$;
grant execute on function public.wo_reoffer(uuid, uuid, date, date, text) to authenticated;
