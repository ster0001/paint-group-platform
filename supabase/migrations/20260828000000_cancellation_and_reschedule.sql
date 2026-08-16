-- =============================================================================
-- Phase E: cancelling bookings, reschedule requests, and room for a calendar sync
--
-- Three gaps this closes:
--  1. A booking could be made but never UNMADE. Staff need to pull a pending
--     offer back, and to cancel an already-accepted job before it starts (the
--     customer postponed, the contractor broke an arm) and re-offer it.
--  2. A contractor who has accepted but is running behind had no way to ask for
--     a later start — their only options were turn up or let people down.
--  3. Unavailability had nowhere to record where a block CAME from, so a future
--     Google Calendar sync would need another schema change.
-- =============================================================================

-- NOTE: if Supabase refuses this line with a message about enum values and
-- transaction blocks, run just this one line on its own first, then run the
-- rest of the file.
alter type public.offer_state add value if not exists 'cancelled';

alter table public.booking_offers
  add column if not exists accepted_at        timestamptz,
  add column if not exists cancelled_reason   text not null default '',
  add column if not exists cancelled_at       timestamptz,
  -- Set while a reschedule is awaiting staff: the date the job WAS booked for,
  -- so rejecting the request restores it instead of losing the booking.
  add column if not exists prior_start_date   date,
  -- When staff were asked. Drives the approvals countdown; distinct from
  -- expires_at, which is the CONTRACTOR's 24-hour clock.
  add column if not exists approval_due_at    timestamptz;

-- Proposals must NOT expire on their own. A contractor who proposed a date has
-- met their SLA; the ball is with staff, and silently expiring it would drop a
-- job on the floor. Only unanswered offers lapse.
create or replace function public.expire_booking_offers()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.booking_offers
     set state = 'expired', responded_at = coalesce(responded_at, now())
   where state = 'offered'
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---- staff: cancel anything not yet finished --------------------------------
-- Works on offered / proposed / accepted. Clears the job off the board and puts
-- it back in the unscheduled tray so it can be offered to someone else.
create or replace function public.cancel_booking(p_offer_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.state not in ('offered', 'proposed', 'accepted') then
    return 'error:already_' || v_o.state;
  end if;

  update public.booking_offers
     set state = 'cancelled', cancelled_at = now(), cancelled_reason = coalesce(p_reason, ''),
         responded_at = coalesce(responded_at, now())
   where id = p_offer_id;

  -- Release the job. start_date is cleared too, so it lands back in the tray
  -- rather than looking like a booking with nobody on it.
  update public.work_orders
     set contractor_id = null, start_date = null
   where id = v_o.work_order_id;

  return 'cancelled';
end $$;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ---- contractor: ask to move an already-accepted job -------------------------
create or replace function public.request_reschedule(
  p_offer_id uuid, p_new_start date, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_o public.booking_offers%rowtype;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if p_new_start is null then return 'error:no_date'; end if;

  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.contractor_id <> v_cid then return 'error:not_yours'; end if;
  if v_o.state <> 'accepted' then return 'error:not_accepted'; end if;

  update public.booking_offers
     set state = 'proposed',
         proposed_start_date = p_new_start,
         prior_start_date = v_o.start_date,      -- so a rejection can restore it
         response_note = coalesce(p_note, ''),
         approval_due_at = now() + interval '24 hours',
         responded_at = now()
   where id = p_offer_id;

  return 'proposed';
end $$;
grant execute on function public.request_reschedule(uuid, date, text) to authenticated;

-- ---- staff resolving a proposal --------------------------------------------
-- Rewritten so rejecting a RESCHEDULE keeps the job on its original date,
-- instead of throwing the booking away like rejecting a first-time proposal.
create or replace function public.resolve_proposed_offer(p_offer_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype; v_was_booked boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.state <> 'proposed' then return 'error:not_proposed'; end if;

  v_was_booked := v_o.prior_start_date is not null;

  if p_approve then
    update public.booking_offers
       set state = 'accepted',
           start_date = coalesce(v_o.proposed_start_date, v_o.start_date),
           accepted_at = coalesce(v_o.accepted_at, now()),
           prior_start_date = null, approval_due_at = null, responded_at = now()
     where id = p_offer_id;
    update public.work_orders
       set start_date = coalesce(v_o.proposed_start_date, v_o.start_date),
           contractor_id = v_o.contractor_id
     where id = v_o.work_order_id;
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

-- Stamp accepted_at on the contractor's own acceptance too, and start the staff
-- clock when they propose.
create or replace function public.respond_to_offer(
  p_offer_id uuid, p_action text, p_note text default '',
  p_proposed_start date default null, p_decline_reason text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_o public.booking_offers%rowtype;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;

  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.contractor_id <> v_cid then return 'error:not_yours'; end if;
  if v_o.state not in ('offered', 'proposed') then return 'error:already_' || v_o.state; end if;
  if v_o.state = 'offered' and v_o.expires_at < now() then
    update public.booking_offers set state = 'expired', responded_at = now() where id = p_offer_id;
    return 'error:expired';
  end if;

  if p_action = 'accept' then
    update public.booking_offers
       set state = 'accepted', responded_at = now(), accepted_at = now(),
           response_note = coalesce(p_note, '')
     where id = p_offer_id;
    update public.work_orders set start_date = v_o.start_date where id = v_o.work_order_id;
    return 'accepted';

  elsif p_action = 'propose' then
    if p_proposed_start is null then return 'error:no_date'; end if;
    update public.booking_offers
       set state = 'proposed', responded_at = now(), proposed_start_date = p_proposed_start,
           response_note = coalesce(p_note, ''), approval_due_at = now() + interval '24 hours'
     where id = p_offer_id;
    return 'proposed';

  elsif p_action = 'decline' then
    update public.booking_offers
       set state = 'declined', responded_at = now(),
           decline_reason = coalesce(p_decline_reason, ''), response_note = coalesce(p_note, '')
     where id = p_offer_id;
    update public.work_orders set contractor_id = null where id = v_o.work_order_id;
    return 'declined';
  end if;

  return 'error:bad_action';
end $$;
grant execute on function public.respond_to_offer(uuid, text, text, date, text) to authenticated;

-- ---- room for a calendar sync -----------------------------------------------
-- Nothing writes these yet. They exist so connecting Google Calendar later is a
-- feature, not a migration: synced events land here as blocks the contractor
-- can see but not hand-edit, and re-syncing updates in place via external_id.
alter table public.contractor_unavailability
  add column if not exists external_source   text,   -- e.g. 'google'
  add column if not exists external_id       text,   -- the provider's event id
  add column if not exists external_calendar text,   -- which of their calendars
  add column if not exists synced_at         timestamptz;

create unique index if not exists contractor_unavailability_external
  on public.contractor_unavailability (external_source, external_id)
  where external_source is not null;

-- A contractor may only hand-create and hand-delete their OWN, non-synced
-- blocks. Synced ones belong to the provider and would just reappear.
drop policy if exists contractor_unavailability_own_write on public.contractor_unavailability;
create policy contractor_unavailability_own_write on public.contractor_unavailability
  for insert to authenticated
  with check (
    contractor_id = public.current_contractor_id()
    and source = 'contractor'
    and external_source is null
  );

drop policy if exists contractor_unavailability_own_delete on public.contractor_unavailability;
create policy contractor_unavailability_own_delete on public.contractor_unavailability
  for delete to authenticated
  using (
    contractor_id = public.current_contractor_id()
    and source = 'contractor'
    and external_source is null
  );

-- ---- Verification -----------------------------------------------------------
-- select public.cancel_booking('<accepted offer id>', 'Customer postponed');
--   -> 'cancelled', and the work order has no contractor and no start date.
-- As the contractor on an accepted job:
--   select public.request_reschedule('<offer id>', '2026-09-10', 'Running behind');
--   -> 'proposed', prior_start_date holds the original date.
-- As staff: select public.resolve_proposed_offer('<offer id>', false);
--   -> 'kept_original', and the original date is back on the work order.
