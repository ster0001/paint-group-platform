-- =============================================================================
-- The work order reaches the calendar when the booking is REQUESTED
--
-- Today the dates live on booking_offers and only reach the work order when the
-- contractor accepts (respond_to_offer copies start_date across). So a job you
-- have scheduled in the calendar shows nothing on its own work order until
-- somebody else acts — and the work order has no end_date column at all, so it
-- could never show a span even then.
--
-- Two changes:
--
--   1. work_orders gains end_date, so a booking's span can be stated.
--   2. The booking→work-order glue moves entirely into the trigger that already
--      carries offer state onto the stage. Offering a job now puts its
--      requested dates on the work order immediately; releasing it takes them
--      away again.
--
-- The trigger, rather than editing send_offer / respond_to_offer /
-- cancel_booking / resolve_proposed_offer: those four functions work, and
-- reconstructing one of them from memory is how send_offer lost its compliance
-- check. One place, beside them.
--
-- REQUESTED vs CONFIRMED is deliberately NOT a new column. The live offer's
-- state already answers it, and a second copy would be a second thing to keep
-- true. `wo_booking(work_order_id)` derives it.
-- =============================================================================

alter table public.work_orders add column if not exists end_date date;

-- ---- what the calendar and the work order both read -------------------------
create or replace function public.wo_booking(p_work_order_id uuid)
returns table (state text, start_date date, end_date date, contractor_id uuid)
language sql stable security definer set search_path = public as $$
  select
    case
      when o.state = 'accepted' then 'confirmed'
      when o.state = 'proposed' then 'proposed'
      when o.state = 'offered'  then 'requested'
      else 'none'
    end,
    coalesce(o.proposed_start_date, o.start_date),
    o.end_date,
    o.contractor_id
  from public.booking_offers o
  where o.work_order_id = p_work_order_id
    and o.state in ('offered', 'proposed', 'accepted')
  order by o.offered_at desc
  limit 1;
$$;
grant execute on function public.wo_booking(uuid) to authenticated;

-- ---- the glue ---------------------------------------------------------------
-- Extends the existing trigger function rather than adding a second one, so
-- there is still exactly one place where a booking changes a work order.
create or replace function public.wo_stage_follows_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stage public.wo_stage; v_live integer;
begin
  select stage into v_stage from public.work_orders where id = new.work_order_id;

  -- ---- dates ---------------------------------------------------------------
  if new.state in ('offered', 'proposed', 'accepted') then
    -- Requested or confirmed, the calendar and the work order now agree.
    update public.work_orders
       set start_date = coalesce(new.proposed_start_date, new.start_date),
           end_date   = new.end_date
     where id = new.work_order_id;

  elsif tg_op = 'UPDATE' and new.state is distinct from old.state then
    -- Released: only clear the dates if nothing else is holding the job, or a
    -- second offer's booking would be wiped by the first one lapsing.
    select count(*) into v_live
      from public.booking_offers o
     where o.work_order_id = new.work_order_id
       and o.state in ('offered', 'proposed', 'accepted')
       and o.id <> new.id;

    if v_live = 0 then
      update public.work_orders set start_date = null, end_date = null
       where id = new.work_order_id;
    end if;
  end if;

  -- ---- stage ---------------------------------------------------------------
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then return new; end if;

  if new.state = 'accepted' and v_stage = 'offered' then
    perform public.wo_set_stage(new.work_order_id, 'pre_start', 'system',
      jsonb_build_object('offer_id', new.id, 'via', 'booking_accepted'));

  elsif new.state in ('cancelled', 'declined', 'expired', 'withdrawn') and v_stage = 'pre_start'
    and not exists (
      select 1 from public.booking_offers o
       where o.work_order_id = new.work_order_id and o.state in ('offered', 'proposed', 'accepted')
         and o.id <> new.id
    ) then
    perform public.wo_set_stage(new.work_order_id, 'offered', 'system',
      jsonb_build_object('offer_id', new.id, 'via', 'booking_' || new.state::text));
  end if;

  return new;
end $$;

-- Fires on INSERT too now: offering a job is the moment it reaches the calendar.
drop trigger if exists booking_offers_stage_sync on public.booking_offers;
create trigger booking_offers_stage_sync
  after insert or update of state on public.booking_offers
  for each row execute function public.wo_stage_follows_offer();

-- ---- backfill ---------------------------------------------------------------
-- Existing live offers put their dates onto their work orders straight away, so
-- nothing has to wait for the next state change to become consistent.
update public.work_orders w
   set start_date = coalesce(o.proposed_start_date, o.start_date),
       end_date   = o.end_date
  from public.booking_offers o
 where o.work_order_id = w.id
   and o.state in ('offered', 'proposed', 'accepted')
   and (w.start_date is distinct from coalesce(o.proposed_start_date, o.start_date)
        or w.end_date is distinct from o.end_date);

-- ---- Verification -----------------------------------------------------------
--   select public.send_offer('<wo>', '<contractor>', current_date + 3, current_date + 5, '');
--   select start_date, end_date from work_orders where id = '<wo>';
--     -> both set immediately, before the contractor has answered
--   select * from public.wo_booking('<wo>');   -> 'requested', the two dates
-- After the contractor accepts:                -> 'confirmed', same dates
-- After cancel_booking:                        -> no row, and both dates null
