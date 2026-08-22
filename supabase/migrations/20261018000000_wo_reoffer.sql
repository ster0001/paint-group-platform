-- =============================================================================
-- ⚑7 Reoffer — Tom's ruling, 22 Aug (SESSION-HANDOFF.md → Rulings)
--
--   tap -> confirm -> withdraw the lapsed offer (logged) -> create the next
--   offer through the EXISTING scheduling flow -> notify the lapsed contractor
--   courteously.
--
-- One transaction: a job must never end up with the old offer withdrawn and no
-- new one, or with two live offers. send_offer is called rather than
-- reimplemented — it carries the compliance check that a contractor without
-- current insurance cannot be offered work, and that check must not be lost on
-- the reoffer path of all places.
--
-- The message is written HERE so there is one place its tone can be reviewed.
-- The contractor did nothing wrong by not answering in time.
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
  if v_o.state not in ('offered', 'proposed') then return 'error:already_' || v_o.state::text; end if;
  if p_contractor_id = v_o.contractor_id then return 'error:same_contractor'; end if;

  select * into v_wo from public.work_orders where id = v_o.work_order_id;
  v_title := coalesce(v_wo.wo_snapshot->>'jobTitle', v_wo.wo_ref);

  -- 1. withdraw the lapsed one
  update public.booking_offers
     set state = 'withdrawn', responded_at = coalesce(responded_at, now())
   where id = p_offer_id;

  -- 2. tell the contractor whose offer it was. No blame: they did not do
  --    anything wrong by not answering in time.
  v_msg := 'Your offer for ' || v_title || ' has lapsed and the job has been '
        || 'reoffered. Nothing for you to do — we will be in touch with the next one.';

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_o.contractor_id, 'offer_lapsed',
            jsonb_build_object('work_order_id', v_o.work_order_id, 'offer_id', p_offer_id,
                               'job', v_title, 'message', v_msg),
            auth.uid());

  -- 3. the next offer, through the flow that already exists — compliance check
  --    and all. Its own trigger puts the new dates on the work order.
  v_sent := public.send_offer(v_o.work_order_id, p_contractor_id, p_start, p_end, p_note);
  if v_sent is null or v_sent like 'error:%' then
    raise exception 'reoffer failed at send_offer: %', v_sent;   -- rolls the whole thing back
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_o.work_order_id, 'offer_reoffered', auth.uid(), 'staff',
            jsonb_build_object('from_contractor', v_o.contractor_id,
                               'to_contractor', p_contractor_id,
                               'lapsed_offer_id', p_offer_id, 'result', v_sent));

  return 'ok:reoffered';
end $$;
grant execute on function public.wo_reoffer(uuid, uuid, date, date, text) to authenticated;

-- Verification:
--   select public.wo_reoffer('<lapsed offer>', '<other contractor>', current_date + 7);
--     -> 'ok:reoffered'; the old offer is 'withdrawn', exactly one 'offered' remains,
--        and contractor_events has an 'offer_lapsed' row for the first contractor.
