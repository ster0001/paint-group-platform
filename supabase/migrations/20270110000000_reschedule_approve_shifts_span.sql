-- =============================================================================
-- Approving a proposed start date moves the WHOLE booking (6 Sep 2026)
--
-- Found running the scheduling help capture as a real contractor + staff on
-- the C1 stack: an offer for 4–8 Sep with the final walkthrough confirmed for
-- 8 Sep 15:00; the contractor proposed 11 Sep; staff approved. Result:
-- booking_offers.start_date = 11 Sep but end_date STAYED 8 Sep (the portal's
-- Requests card read "FRI, 11 SEPT – TUE, 8 SEPT", the contractor's calendar
-- showed one day), and the booked final walkthrough stayed on 8 Sep — three
-- days BEFORE the job now starts. The staff board looked fine only because it
-- draws the block by span, so nobody noticed until the painter's side was read.
--
-- resolve_proposed_offer (20260828 body verbatim) now, on approve:
--   · shifts end_date by the same number of days as start_date moved, on the
--     offer AND the work order (the booking→work-order trigger only listens to
--     `state`, but the write is in the same statement so it carries anyway;
--     the explicit work_orders write keeps the intent readable);
--   · re-books a BOOKED final walkthrough by the same delta, carrying the
--     client-confirmed time — the same move `wo_contractor_set_finish_date`
--     makes when the last day changes (20261222). This is the precedent over
--     "clear it and raise the console card": by the time staff press Approve
--     they have rung the customer about the new dates (the card copy says so:
--     "Ring the customer, then approve or reject"), and a finish-date change
--     already moves the walkthrough without a second call. The event carries
--     via='reschedule_approved' + the old date, so the move is auditable and
--     the walkthrough invite (idempotent on date+time) re-sends the new slot.
-- The refuse branches are unchanged: a refused reschedule restores the original
-- start (the end never moved), a refused first-time proposal releases the job.
--
-- Applies to BOTH kinds of proposal — a first-time "could I start the Monday
-- after?" and a reschedule of an accepted booking — because both move the
-- start and neither touched the end before this.
-- =============================================================================

create or replace function public.resolve_proposed_offer(p_offer_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_was_booked boolean;
        v_new_start date; v_new_end date; v_delta integer;
        v_walk public.wo_walkthroughs%rowtype; v_walk_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.state <> 'proposed' then return 'error:not_proposed'; end if;

  v_was_booked := v_o.prior_start_date is not null;

  if p_approve then
    -- start_date still holds the date the job WAS on (request_reschedule and
    -- respond_to_offer both leave it alone and write proposed_start_date), so
    -- the delta is simply new minus old. Zero when nothing actually moved.
    v_new_start := coalesce(v_o.proposed_start_date, v_o.start_date);
    v_delta     := v_new_start - v_o.start_date;
    v_new_end   := case when v_o.end_date is null then null else v_o.end_date + v_delta end;

    update public.booking_offers
       set state = 'accepted',
           start_date = v_new_start,
           end_date = v_new_end,
           accepted_at = coalesce(v_o.accepted_at, now()),
           prior_start_date = null, approval_due_at = null, responded_at = now()
     where id = p_offer_id;
    update public.work_orders
       set start_date = v_new_start,
           end_date = v_new_end,
           contractor_id = v_o.contractor_id
     where id = v_o.work_order_id;

    -- A booked final walkthrough rides with the job. Cancel + re-insert rather
    -- than update: every booking is its own row (20261028), the invite logic
    -- and the event log both key on that.
    if v_delta <> 0 then
      select * into v_walk from public.wo_walkthroughs
       where work_order_id = v_o.work_order_id and kind = 'final' and status = 'booked'
       order by created_at desc limit 1;
      if found then
        update public.wo_walkthroughs set status = 'cancelled'
         where work_order_id = v_o.work_order_id and kind = 'final' and status = 'booked';
        insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, scheduled_time, booked_by, note)
          values (v_o.work_order_id, 'final', v_walk.scheduled_date + v_delta, v_walk.scheduled_time, auth.uid(),
                  'Moved with the approved start date')
          returning id into v_walk_id;
        insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
          values (v_o.work_order_id, 'walkthrough_booked', auth.uid(), 'staff',
                  jsonb_build_object('walkthrough_id', v_walk_id, 'kind', 'final',
                                     'date', v_walk.scheduled_date + v_delta, 'time', v_walk.scheduled_time,
                                     'via', 'reschedule_approved',
                                     'from', v_walk.scheduled_date, 'delta_days', v_delta));
      end if;
    end if;
    return 'accepted';
  end if;

  if v_was_booked then
    -- A reschedule was refused: the original booking stands.
    update public.booking_offers
       set state = 'accepted', start_date = v_o.prior_start_date,
           proposed_start_date = null, prior_start_date = null,
           approval_due_at = null, responded_at = now()
     where id = p_offer_id;
    update public.work_orders set start_date = v_o.prior_start_date where id = v_o.work_order_id;
    return 'kept_original';
  end if;

  -- A first-time proposal was refused: the job goes back in the pool.
  update public.booking_offers set state = 'declined', responded_at = now() where id = p_offer_id;
  update public.work_orders set contractor_id = null, start_date = null where id = v_o.work_order_id;
  return 'declined';
end $$;
grant execute on function public.resolve_proposed_offer(uuid, boolean) to authenticated;

-- ---- read-back --------------------------------------------------------------
-- Expect exactly ONE row: shifts_end = true, moves_walkthrough = true, secdef = true.
select p.proname,
       p.prosrc like '%end_date = v_new_end%'                     as shifts_end,
       p.prosrc like '%Moved with the approved start date%'       as moves_walkthrough,
       p.prosecdef                                                 as secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'resolve_proposed_offer';

-- ---- Verification (C1, as staff) -------------------------------------------
--   send_offer(wo, contractor, D, D+4) → wo_book_walkthrough(wo, 'final', D+4, '', '15:00')
--   contractor: respond_to_offer(offer, 'accept') → request_reschedule(offer, D+7)
--   staff: resolve_proposed_offer(offer, true)
--   select start_date, end_date from booking_offers where id = offer;   -> D+7, D+11
--   select scheduled_date, scheduled_time, status from wo_walkthroughs
--     where work_order_id = wo and kind = 'final' order by created_at;   -> D+4 cancelled, D+11 15:00 booked
-- e2e/wo-reschedule.spec.ts does exactly this.
