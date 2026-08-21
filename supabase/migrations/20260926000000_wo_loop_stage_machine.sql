-- =============================================================================
-- WO completion loop, step 1 — the seven-stage state machine
--
-- Work orders v1 has `status` (draft | issued | in_progress | complete), which
-- the contractor link, the schedule board and the CSS chips all read. The loop
-- needs seven stages, one of which is ALSO called in_progress. Two independent
-- status columns is exactly the "typed status" problem the PC console exists to
-- kill, so:
--
--   * `stage` is NEW and is the single source of truth for the loop;
--   * `status` is DERIVED from it, in one function, on every transition.
--
-- Nothing writes `status` by hand again. v1 surfaces keep working untouched.
--
-- The legal transitions live in a TABLE, not in a CASE statement, because three
-- things need to agree about them: this function, the UI (which offers only the
-- moves that exist) and the tests. Data can be read by all three; a CASE can't.
-- `lib/workorder/stages.ts` mirrors this table and a unit test diffs the two, so
-- the mirror cannot drift silently.
--
-- Gates (all surfaces ticked, QA passed, pack delivered) are NOT enforced here.
-- Their tables don't exist yet; each later step fills in its own gate inside
-- wo_gate_blocked(). Today the shape of a move is checked, not its readiness.
-- =============================================================================

do $$ begin
  create type public.wo_stage as enum
    ('offered', 'pre_start', 'in_progress', 'qa', 'completion_prep', 'walkthrough', 'closed');
exception when duplicate_object then null; end $$;

alter table public.work_orders
  add column if not exists stage           public.wo_stage,
  add column if not exists stage_entered_at timestamptz,
  add column if not exists blocked_reason  text;

-- ---- the transition table ---------------------------------------------------
-- actors: who may ASK for this move. 'system' is the trigger/scheduled sweep;
-- it is never a caller-supplied value.
create table if not exists public.wo_stage_transitions (
  from_stage public.wo_stage not null,
  to_stage   public.wo_stage not null,
  label      text not null,
  actors     text[] not null,
  primary key (from_stage, to_stage)
);

insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',      array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['staff']),
  ('in_progress',     'qa',              'all surfaces done — QA is scheduled', array['system','staff','contractor']),
  ('in_progress',     'completion_prep', 'all surfaces done — no QA due',       array['system','staff','contractor']),
  ('qa',              'completion_prep', 'QA passed',                           array['staff']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('completion_prep', 'walkthrough',     'evidence pack delivered',             array['system','staff','contractor']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer'])
on conflict (from_stage, to_stage) do update
  set label = excluded.label, actors = excluded.actors;

-- ---- the event log ----------------------------------------------------------
-- Append-only. The completion report and the console are both renderings of
-- this table, which is why every transition writes one whether a human or the
-- sweep caused it.
create table if not exists public.wo_events (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  type          text not null,                  -- 'stage_changed' | (later: 'tick', 'photo', 'variation_*', …)
  from_stage    public.wo_stage,
  to_stage      public.wo_stage,
  actor         uuid references auth.users (id) on delete set null,
  actor_kind    text not null default 'system', -- staff | contractor | customer | system
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists wo_events_wo_idx  on public.wo_events (work_order_id, created_at desc);
create index if not exists wo_events_type_idx on public.wo_events (work_order_id, type, created_at desc);
create index if not exists work_orders_stage_idx on public.work_orders (stage) where stage <> 'closed';

-- ---- status is derived, never typed ----------------------------------------
create or replace function public.wo_derive_status(p_stage public.wo_stage, p_issued_at timestamptz)
returns public.wo_status language sql immutable set search_path = public as $$
  select case
    when p_stage = 'closed'    then 'complete'::public.wo_status
    when p_stage = 'offered'   then case when p_issued_at is null
                                        then 'draft'::public.wo_status
                                        else 'issued'::public.wo_status end
    when p_stage = 'pre_start' then 'issued'::public.wo_status
    else 'in_progress'::public.wo_status          -- in_progress | qa | completion_prep | walkthrough
  end;
$$;

-- ---- backfill ---------------------------------------------------------------
-- Existing rows get the stage their v1 status and booking imply. Done before
-- the NOT NULL default so no row is ever stage-less.
update public.work_orders w set stage = case
    when w.status = 'complete'    then 'closed'::public.wo_stage
    when w.status = 'in_progress' then 'in_progress'::public.wo_stage
    when exists (select 1 from public.booking_offers o
                  where o.work_order_id = w.id and o.state = 'accepted')
                                  then 'pre_start'::public.wo_stage
    else 'offered'::public.wo_stage
  end
 where w.stage is null;

update public.work_orders set stage_entered_at = coalesce(stage_entered_at, issued_at, created_at)
 where stage_entered_at is null;

alter table public.work_orders alter column stage set default 'offered';
alter table public.work_orders alter column stage set not null;

-- ---- gates ------------------------------------------------------------------
-- Returns a plain-English reason the move can't happen yet, or null when it can.
-- Each later step of the build fills in its own arm; an unimplemented gate is
-- deliberately open rather than closed, so the machine is usable while it grows.
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
begin
  -- step 2 fills: in_progress -> qa | completion_prep  (every surface DONE)
  -- step 3 fills: any forward move             (no variation awaiting approval)
  -- step 5 fills: qa -> completion_prep        (all due checks passed)
  --              completion_prep -> walkthrough (prep checklist ticked)
  --              walkthrough -> closed          (every area approved + signed)
  return null;
end $$;

-- ---- the one way a stage ever changes ---------------------------------------
-- Internal: assumes the caller has already established who is asking. Every
-- public path (RPC, trigger, sweep) funnels through here so the event write and
-- the derived status can never be skipped.
create or replace function public.wo_set_stage(
  p_wo_id uuid, p_to public.wo_stage, p_actor_kind text, p_meta jsonb default '{}'
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_t public.wo_stage_transitions%rowtype; v_gate text;
begin
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if not found then return 'error:not_found'; end if;

  -- Asking for the stage it is already in is a no-op, not a failure: two taps
  -- on a phone with a slow network must not read as an error.
  if v_wo.stage = p_to then return 'ok:' || p_to::text; end if;

  select * into v_t from public.wo_stage_transitions
   where from_stage = v_wo.stage and to_stage = p_to;
  if not found then
    return 'error:illegal_transition:' || v_wo.stage::text || '>' || p_to::text;
  end if;

  if not (p_actor_kind = any (v_t.actors)) then
    return 'error:actor_not_allowed:' || p_actor_kind;
  end if;

  v_gate := public.wo_gate_blocked(p_wo_id, v_wo.stage, p_to);
  if v_gate is not null then return 'error:gate:' || v_gate; end if;

  update public.work_orders
     set stage = p_to,
         stage_entered_at = now(),
         status = public.wo_derive_status(p_to, issued_at),
         -- A move always clears the old blocker; whatever blocks the new stage
         -- is written by the thing that discovers it.
         blocked_reason = null
   where id = p_wo_id;

  insert into public.wo_events (work_order_id, type, from_stage, to_stage, actor, actor_kind, meta)
    values (p_wo_id, 'stage_changed', v_wo.stage, p_to, auth.uid(), p_actor_kind,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('label', v_t.label));

  return 'ok:' || p_to::text;
end $$;

-- ---- the caller-facing RPC --------------------------------------------------
-- Establishes the actor from the session — never from an argument — then hands
-- to wo_set_stage. 'system' is not reachable from here by design.
create or replace function public.wo_advance_stage(
  p_work_order_id uuid, p_to public.wo_stage, p_meta jsonb default '{}'
) returns text language plpgsql security definer set search_path = public as $$
declare v_kind text; v_cid uuid; v_wo public.work_orders%rowtype;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is not null and v_wo.contractor_id = v_cid then
      v_kind := 'contractor';
    elsif exists (
      select 1 from public.estimates e
        join public.customers c on c.id = e.customer_id
       where e.id = v_wo.estimate_id and c.profile_id = auth.uid()
    ) then
      v_kind := 'customer';
    else
      return 'error:not_yours';
    end if;
  end if;

  return public.wo_set_stage(p_work_order_id, p_to, v_kind, p_meta);
end $$;
grant execute on function public.wo_advance_stage(uuid, public.wo_stage, jsonb) to authenticated;

-- ---- the booking flow moves the stage, so it can never drift ----------------
-- cancel_booking / resolve_proposed_offer / respond_to_offer already release or
-- claim a job by writing contractor_id. Rather than reopen three working
-- functions (and risk reconstructing one of them wrongly), the stage follows the
-- offer state here. Integrity glue, not business logic.
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

-- ---- RLS, three ways --------------------------------------------------------
-- Staff everything; a contractor only the jobs assigned to them; a customer only
-- their own job. Read-only for both non-staff roles — every write is an RPC.
alter table public.wo_events            enable row level security;
alter table public.wo_stage_transitions enable row level security;

drop policy if exists wo_events_staff on public.wo_events;
create policy wo_events_staff on public.wo_events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists wo_events_contractor on public.wo_events;
create policy wo_events_contractor on public.wo_events
  for select to authenticated using (
    exists (select 1 from public.work_orders w
             where w.id = wo_events.work_order_id
               and w.contractor_id is not null
               and w.contractor_id = public.current_contractor_id())
  );

drop policy if exists wo_events_customer on public.wo_events;
create policy wo_events_customer on public.wo_events
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = wo_events.work_order_id and c.profile_id = auth.uid())
  );

-- The transition table is reference data: everyone signed in may read it (the
-- UI offers only moves that exist), nobody may write it outside a migration.
drop policy if exists wo_stage_transitions_read on public.wo_stage_transitions;
create policy wo_stage_transitions_read on public.wo_stage_transitions
  for select to authenticated using (true);

revoke insert, update, delete on public.wo_stage_transitions from authenticated;
revoke insert, update, delete on public.wo_events from authenticated;

-- Same lockdown the R2 boundary applied to status/money: the new state columns
-- are server-written only. A client UPDATE on them fails at the database.
revoke update (stage, stage_entered_at, blocked_reason) on public.work_orders from authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff, in the SQL editor:
--   select stage, status, count(*) from work_orders group by 1,2 order by 1;
--     -> every row has a stage; status matches wo_derive_status(stage, issued_at)
--   select public.wo_advance_stage('<a work order id>', 'closed');
--     -> 'error:illegal_transition:offered>closed'   (nothing changed)
--   select public.wo_advance_stage('<a pre_start wo>', 'in_progress');
--     -> 'ok:in_progress', and:
--   select type, from_stage, to_stage, actor_kind from wo_events order by created_at desc limit 1;
--     -> stage_changed | pre_start | in_progress | staff
-- As a contractor JWT (not assigned to that job):
--   select public.wo_advance_stage('<that id>', 'qa');   -> 'error:not_yours'
