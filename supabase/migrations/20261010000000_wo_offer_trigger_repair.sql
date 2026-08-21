-- =============================================================================
-- WO loop — repair the booking→stage trigger
--
-- The full-loop story caught it: a contractor accepts their offer,
-- respond_to_offer returns 'accepted', and the work order stays at `offered`.
-- The trigger that carries the booking state onto the stage was not there.
--
-- It sits in the same tail of 20260926 as the RLS policies that also turned out
-- to be missing, so this recreates it the same way — idempotently, with a
-- listing at the end so the result is read rather than assumed.
--
-- Why a trigger rather than editing the three booking functions: cancel_booking,
-- resolve_proposed_offer and respond_to_offer all release or claim a job by
-- writing contractor_id, and reconstructing one of them from memory is exactly
-- how send_offer lost its compliance check. This is integrity glue beside them,
-- not business logic inside them.
-- =============================================================================

create or replace function public.wo_stage_follows_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stage public.wo_stage;
begin
  if new.state is not distinct from old.state then return new; end if;
  select stage into v_stage from public.work_orders where id = new.work_order_id;

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

drop trigger if exists booking_offers_stage_sync on public.booking_offers;
create trigger booking_offers_stage_sync
  after update of state on public.booking_offers
  for each row execute function public.wo_stage_follows_offer();

-- The state columns stay server-written. Restated so this file stands alone.
revoke update (stage, stage_entered_at, blocked_reason) on public.work_orders from authenticated;

-- ---- Verification: expect one row -------------------------------------------
select tgname as trigger_name,
       tgrelid::regclass as on_table,
       tgenabled as enabled
  from pg_trigger
 where tgname = 'booking_offers_stage_sync';
