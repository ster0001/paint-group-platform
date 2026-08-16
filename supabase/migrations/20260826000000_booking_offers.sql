-- =============================================================================
-- Phase C: booking offers — the scheduling core
--
-- Staff offer an issued work order to a contractor for a date range. The
-- contractor has 24 hours to accept, propose a different start date, or decline.
-- Nothing reaches the customer until the offer is ACCEPTED (the customer gate).
--
-- Lifecycle, per the approved workflow spec:
--   offered ──accept──▶ accepted
--      │  ├─propose──▶ proposed ──staff approve──▶ accepted
--      │  │                      └─staff decline─▶ declined
--      │  ├─decline──▶ declined
--      │  ├─(24h)────▶ expired      (auto — no action needed by anyone)
--      │  └─withdraw─▶ withdrawn    (staff pulled it back)
--
-- Two rules are enforced by the DATABASE rather than the UI, because the UI can
-- always be stale or bypassed:
--   1. ONE LIVE OFFER PER JOB — a partial unique index, so a double-send is an
--      error rather than two contractors both thinking they have the job.
--   2. EXPIRY IS RE-CHECKED SERVER-SIDE on every response. A contractor whose
--      phone has been asleep on the offer screen for two days cannot accept.
-- =============================================================================

do $$ begin
  create type public.offer_state as enum
    ('offered', 'proposed', 'accepted', 'declined', 'expired', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.booking_offers (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  contractor_id  uuid not null references public.contractors (id) on delete cascade,
  state          public.offer_state not null default 'offered',

  -- what is being offered
  start_date     date not null,
  end_date       date,
  hours_allowance numeric(8,2),
  payment_cents  integer,
  staff_note     text not null default '',

  -- the clock
  offered_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  responded_at   timestamptz,

  -- the response
  proposed_start_date date,          -- set when state = 'proposed'
  response_note  text not null default '',
  decline_reason text not null default '',

  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists booking_offers_wo_idx on public.booking_offers (work_order_id, created_at desc);
create index if not exists booking_offers_contractor_idx on public.booking_offers (contractor_id, state);

-- RULE 1: at most one LIVE offer per work order. 'offered' and 'proposed' are
-- live (the job is spoken for); everything else is settled history.
create unique index if not exists booking_offers_one_live
  on public.booking_offers (work_order_id)
  where state in ('offered', 'proposed');

-- ---- RLS ---------------------------------------------------------------------
alter table public.booking_offers enable row level security;

drop policy if exists booking_offers_staff on public.booking_offers;
create policy booking_offers_staff on public.booking_offers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A contractor reads only offers made to them. Responses go through the RPCs
-- below, so no write policy is granted.
drop policy if exists booking_offers_contractor_read on public.booking_offers;
create policy booking_offers_contractor_read on public.booking_offers
  for select to authenticated
  using (contractor_id = public.current_contractor_id());

-- ---- expiry ------------------------------------------------------------------
-- Sweep lapsed offers back to 'expired'. Called opportunistically whenever
-- anyone loads offers, so it works without a cron job; safe to call often.
create or replace function public.expire_booking_offers()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.booking_offers
     set state = 'expired', responded_at = coalesce(responded_at, now())
   where state in ('offered', 'proposed')
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.expire_booking_offers() to authenticated;

-- ---- the contractor's response ----------------------------------------------
-- One entry point for all three responses so the expiry and ownership checks
-- can never be skipped by calling the "other" function.
--
-- p_action: 'accept' | 'propose' | 'decline'
-- Returns the resulting state, or an error string prefixed with 'error:'.
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_action   text,
  p_note     text default '',
  p_proposed_start date default null,
  p_decline_reason text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_o public.booking_offers%rowtype;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;

  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.contractor_id <> v_cid then return 'error:not_yours'; end if;

  -- Only a live offer can be responded to, and only before it lapses. Checked
  -- here rather than trusted from the page, which may have been open for hours.
  if v_o.state not in ('offered', 'proposed') then return 'error:already_' || v_o.state; end if;
  if v_o.expires_at < now() then
    update public.booking_offers set state = 'expired', responded_at = now() where id = p_offer_id;
    return 'error:expired';
  end if;

  if p_action = 'accept' then
    update public.booking_offers
       set state = 'accepted', responded_at = now(), response_note = coalesce(p_note, '')
     where id = p_offer_id;
    -- Lock the date onto the work order. THIS is the moment the job becomes real
    -- for the customer; nothing before it should have reached them.
    update public.work_orders
       set start_date = v_o.start_date
     where id = v_o.work_order_id;
    return 'accepted';

  elsif p_action = 'propose' then
    if p_proposed_start is null then return 'error:no_date'; end if;
    -- Responding stops the clock: the contractor met the SLA, the ball is now
    -- with staff, so expires_at is pushed out of the way.
    update public.booking_offers
       set state = 'proposed', responded_at = now(), proposed_start_date = p_proposed_start,
           response_note = coalesce(p_note, ''), expires_at = now() + interval '14 days'
     where id = p_offer_id;
    return 'proposed';

  elsif p_action = 'decline' then
    update public.booking_offers
       set state = 'declined', responded_at = now(),
           decline_reason = coalesce(p_decline_reason, ''), response_note = coalesce(p_note, '')
     where id = p_offer_id;
    -- The job goes back in the pool: clear the assignment so staff can re-offer.
    update public.work_orders set contractor_id = null where id = v_o.work_order_id;
    return 'declined';
  end if;

  return 'error:bad_action';
end $$;
grant execute on function public.respond_to_offer(uuid, text, text, date, text) to authenticated;

-- ---- staff resolving a proposed date ----------------------------------------
create or replace function public.resolve_proposed_offer(p_offer_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_o public.booking_offers%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_o from public.booking_offers where id = p_offer_id for update;
  if not found then return 'error:not_found'; end if;
  if v_o.state <> 'proposed' then return 'error:not_proposed'; end if;

  if p_approve then
    update public.booking_offers
       set state = 'accepted', start_date = coalesce(v_o.proposed_start_date, v_o.start_date),
           responded_at = now()
     where id = p_offer_id;
    update public.work_orders
       set start_date = coalesce(v_o.proposed_start_date, v_o.start_date)
     where id = v_o.work_order_id;
    return 'accepted';
  else
    update public.booking_offers set state = 'declined', responded_at = now() where id = p_offer_id;
    update public.work_orders set contractor_id = null where id = v_o.work_order_id;
    return 'declined';
  end if;
end $$;
grant execute on function public.resolve_proposed_offer(uuid, boolean) to authenticated;

-- ---- has this job been accepted? --------------------------------------------
-- Drives the privacy gate: suburb only until the contractor has committed.
create or replace function public.work_order_is_accepted(p_work_order_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.booking_offers
     where work_order_id = p_work_order_id and state = 'accepted'
  );
$$;
grant execute on function public.work_order_is_accepted(uuid) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- Two live offers on one job must fail:
--   insert twice with state 'offered' -> duplicate key on booking_offers_one_live
-- An expired offer must not be acceptable:
--   update booking_offers set expires_at = now() - interval '1 hour' where id = ...;
--   select public.respond_to_offer('<id>', 'accept');   -- expect 'error:expired'
