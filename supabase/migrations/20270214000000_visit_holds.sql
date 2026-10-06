-- =============================================================================
-- Visit holds and text codes (visit booking addendum A, S3 — 6 Oct 2026).
--
-- A customer picks a slot; the server HOLDS it for ten minutes and texts a
-- 6-digit code; the customer enters the code; the server confirms in one
-- transaction. Two customers can never hold or book the same slot (§4.3).
--
--   visit_holds       — one row per hold. Live = released_at null and
--                       confirmed_visit_id null; expiry is a time. The code is
--                       stored HASHED; five wrong attempts end the hold; three
--                       resends per hold.
--   visit_code_sends  — one row per code texted, for the per-mobile and per-IP
--                       limits (section 8, test 11). A fact table, nothing more.
--
-- Nothing in the browser touches these tables: the server action calls the
-- RPCs with the service role, and the RPCs are granted to service_role only.
-- Staff can read them (the Diary and the queue), never write.
--
-- The confirm RPC is the last line of defence: under an advisory lock per
-- estimator-day it re-checks the full 90-minute run against confirmed visits
-- (test 19), the far-edge pairing (R18, test 13) and one active wizard visit
-- per estimate, then inserts the `visits` row — whose trigger writes the
-- crm_events entry. The availability rules proper (§4.2) are re-run in
-- TypeScript by the same server action just before this call; the database
-- holds the invariants a race could break.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. holds ------------------------------------------------------------------
create table if not exists public.visit_holds (
  id                 uuid primary key default gen_random_uuid(),
  estimate_id        uuid not null references public.estimates (id) on delete cascade,
  estimator_id       uuid not null references public.profiles (id) on delete cascade,
  starts_at          timestamptz not null,
  slot_minutes       smallint not null default 90 check (slot_minutes between 15 and 480),
  visit_minutes      smallint not null default 60 check (visit_minutes between 15 and 480),
  zone               text not null check (zone in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5')),
  far_edge           boolean not null default false,
  -- E.164, the number the code went to.
  mobile             text not null check (mobile ~ '^\+[0-9]{7,15}$'),
  code_hash          text not null,
  attempts           smallint not null default 0,
  resends            smallint not null default 0,
  expires_at         timestamptz not null,
  ip_hash            text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  confirmed_visit_id uuid references public.visits (id) on delete set null,
  released_at        timestamptz,
  release_reason     text
);
-- One LIVE hold per slot per estimator — the race between two customers is settled here.
create unique index if not exists visit_holds_live_slot
  on public.visit_holds (estimator_id, starts_at) where released_at is null and confirmed_visit_id is null;
-- One live hold per estimate.
create unique index if not exists visit_holds_live_estimate
  on public.visit_holds (estimate_id) where released_at is null and confirmed_visit_id is null;
create index if not exists visit_holds_estimator_idx on public.visit_holds (estimator_id, starts_at);

alter table public.visit_holds enable row level security;
drop policy if exists visit_holds_staff_read on public.visit_holds;
create policy visit_holds_staff_read on public.visit_holds
  for select to authenticated using ((select public.is_staff()));
revoke all on public.visit_holds from anon;
revoke insert, update, delete on public.visit_holds from authenticated;
grant select on public.visit_holds to authenticated;

-- ---- 2. code sends (limits) ------------------------------------------------------
create table if not exists public.visit_code_sends (
  id      uuid primary key default gen_random_uuid(),
  hold_id uuid references public.visit_holds (id) on delete cascade,
  mobile  text not null,
  ip_hash text,
  sent_at timestamptz not null default now()
);
create index if not exists visit_code_sends_mobile_idx on public.visit_code_sends (mobile, sent_at);
create index if not exists visit_code_sends_ip_idx on public.visit_code_sends (ip_hash, sent_at);

alter table public.visit_code_sends enable row level security;
drop policy if exists visit_code_sends_staff_read on public.visit_code_sends;
create policy visit_code_sends_staff_read on public.visit_code_sends
  for select to authenticated using ((select public.is_staff()));
revoke all on public.visit_code_sends from anon;
revoke insert, update, delete on public.visit_code_sends from authenticated;
grant select on public.visit_code_sends to authenticated;

-- ---- 3. the RPCs — service_role only ------------------------------------------------

-- Place a hold. Returns {status: ok|taken|held, id, expires_at}.
create or replace function public.visit_hold_place(
  p_estimate uuid, p_estimator uuid, p_starts timestamptz, p_slot_minutes int, p_visit_minutes int,
  p_zone text, p_far_edge boolean, p_mobile text, p_code_hash text, p_hold_minutes int, p_ip_hash text, p_user uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_expires timestamptz; v_block_end timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_estimator::text || '|' || to_char(p_starts at time zone 'UTC', 'YYYYMMDD')));
  v_block_end := p_starts + make_interval(mins => p_slot_minutes);
  -- Expired holds on this slot are released; this estimate's own live hold is replaced.
  update public.visit_holds set released_at = now(), release_reason = 'expired'
    where estimator_id = p_estimator and starts_at = p_starts and released_at is null and confirmed_visit_id is null and expires_at < now();
  update public.visit_holds set released_at = now(), release_reason = 'replaced'
    where estimate_id = p_estimate and released_at is null and confirmed_visit_id is null;
  if exists (select 1 from public.visits v where v.staff_id = p_estimator and v.status = 'booked'
               and v.starts_at < v_block_end and v.starts_at + make_interval(mins => p_slot_minutes) > p_starts) then
    return jsonb_build_object('status', 'taken');
  end if;
  if exists (select 1 from public.visit_holds h where h.estimator_id = p_estimator and h.starts_at = p_starts
               and h.released_at is null and h.confirmed_visit_id is null) then
    return jsonb_build_object('status', 'held');
  end if;
  v_expires := now() + make_interval(mins => greatest(2, p_hold_minutes));
  begin
    insert into public.visit_holds (estimate_id, estimator_id, starts_at, slot_minutes, visit_minutes, zone, far_edge, mobile, code_hash, expires_at, ip_hash, created_by)
    values (p_estimate, p_estimator, p_starts, p_slot_minutes, p_visit_minutes, p_zone, p_far_edge, p_mobile, p_code_hash, v_expires, p_ip_hash, p_user)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('status', 'held');
  end;
  insert into public.visit_code_sends (hold_id, mobile, ip_hash) values (v_id, p_mobile, p_ip_hash);
  return jsonb_build_object('status', 'ok', 'id', v_id, 'expires_at', v_expires);
end $$;

-- A new code on a live hold. Returns ok|limit|ended.
create or replace function public.visit_hold_resend(p_hold uuid, p_code_hash text, p_ip_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare h public.visit_holds;
begin
  select * into h from public.visit_holds where id = p_hold for update;
  if not found or h.released_at is not null or h.confirmed_visit_id is not null or h.expires_at < now() then return 'ended'; end if;
  if h.resends >= 3 then return 'limit'; end if;
  update public.visit_holds set code_hash = p_code_hash, resends = resends + 1, attempts = 0 where id = p_hold;
  insert into public.visit_code_sends (hold_id, mobile, ip_hash) values (p_hold, h.mobile, p_ip_hash);
  return 'ok';
end $$;

create or replace function public.visit_hold_release(p_hold uuid, p_reason text)
returns void language sql security definer set search_path = public as $$
  update public.visit_holds set released_at = now(), release_reason = coalesce(p_reason, 'released')
    where id = p_hold and released_at is null and confirmed_visit_id is null;
$$;

-- Confirm: the code, then the invariants, then the visit — one transaction.
-- Returns {status: booked|wrong|ended|expired|missing|unavailable|already_booked, visit_id?, attempts_left?}.
create or replace function public.visit_hold_confirm(
  p_hold uuid, p_code_hash text, p_account uuid, p_property uuid, p_far_pairs jsonb,
  p_customer_name text, p_customer_phone text, p_address text, p_suburb text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare h public.visit_holds; v_id uuid; v_ends timestamptz; v_block_end timestamptz; pair jsonb; v_other text;
begin
  select * into h from public.visit_holds where id = p_hold for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if h.confirmed_visit_id is not null then return jsonb_build_object('status', 'booked', 'visit_id', h.confirmed_visit_id); end if;
  if h.released_at is not null then return jsonb_build_object('status', 'ended'); end if;
  if h.expires_at < now() then
    update public.visit_holds set released_at = now(), release_reason = 'expired' where id = p_hold;
    return jsonb_build_object('status', 'expired');
  end if;
  if h.code_hash <> p_code_hash then
    update public.visit_holds set attempts = attempts + 1 where id = p_hold;
    if h.attempts + 1 >= 5 then
      update public.visit_holds set released_at = now(), release_reason = 'too_many_attempts' where id = p_hold;
      return jsonb_build_object('status', 'ended');
    end if;
    return jsonb_build_object('status', 'wrong', 'attempts_left', 5 - (h.attempts + 1));
  end if;

  perform pg_advisory_xact_lock(hashtext(h.estimator_id::text || '|' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDD')));
  v_block_end := h.starts_at + make_interval(mins => h.slot_minutes);
  v_ends := h.starts_at + make_interval(mins => h.visit_minutes);

  -- One active visit per estimate (S3).
  if exists (select 1 from public.visits v where v.estimate_id = h.estimate_id and v.status = 'booked') then
    update public.visit_holds set released_at = now(), release_reason = 'already_booked' where id = p_hold;
    return jsonb_build_object('status', 'already_booked');
  end if;
  -- The full run must be clear of confirmed visits (test 19: the block is the slot, not the visit).
  if exists (select 1 from public.visits v where v.staff_id = h.estimator_id and v.status = 'booked'
               and v.starts_at < v_block_end and v.starts_at + make_interval(mins => h.slot_minutes) > h.starts_at) then
    update public.visit_holds set released_at = now(), release_reason = 'slot_taken' where id = p_hold;
    return jsonb_build_object('status', 'unavailable');
  end if;
  -- R18: a far-edge visit next to a confirmed far-edge visit in a paired zone (test 13).
  if h.far_edge then
    for pair in select value from jsonb_array_elements(coalesce(p_far_pairs, '[]'::jsonb)) loop
      v_other := case when pair ->> 0 = h.zone then pair ->> 1 when pair ->> 1 = h.zone then pair ->> 0 else null end;
      if v_other is not null and exists (
        select 1 from public.visits v where v.staff_id = h.estimator_id and v.status = 'booked' and v.far_edge and v.zone = v_other
          and (v.starts_at = v_block_end or v.starts_at + make_interval(mins => h.slot_minutes) = h.starts_at)
      ) then
        update public.visit_holds set released_at = now(), release_reason = 'far_edge' where id = p_hold;
        return jsonb_build_object('status', 'unavailable');
      end if;
    end loop;
  end if;

  begin
    insert into public.visits (account_id, property_id, estimate_id, staff_id, starts_at, ends_at, kind, status, source,
                               address, suburb, customer_name, customer_phone, zone, far_edge, created_by)
    values (p_account, p_property, h.estimate_id, h.estimator_id, h.starts_at, v_ends, 'quote', 'booked', 'wizard',
            p_address, p_suburb, p_customer_name, p_customer_phone, h.zone, h.far_edge, h.created_by)
    returning id into v_id;
  exception when exclusion_violation then
    update public.visit_holds set released_at = now(), release_reason = 'slot_taken' where id = p_hold;
    return jsonb_build_object('status', 'unavailable');
  end;
  update public.visit_holds set confirmed_visit_id = v_id where id = p_hold;
  return jsonb_build_object('status', 'booked', 'visit_id', v_id);
end $$;

revoke all on function public.visit_hold_place(uuid, uuid, timestamptz, int, int, text, boolean, text, text, int, text, uuid) from public, anon, authenticated;
revoke all on function public.visit_hold_resend(uuid, text, text) from public, anon, authenticated;
revoke all on function public.visit_hold_release(uuid, text) from public, anon, authenticated;
revoke all on function public.visit_hold_confirm(uuid, text, uuid, uuid, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.visit_hold_place(uuid, uuid, timestamptz, int, int, text, boolean, text, text, int, text, uuid) to service_role;
grant execute on function public.visit_hold_resend(uuid, text, text) to service_role;
grant execute on function public.visit_hold_release(uuid, text) to service_role;
grant execute on function public.visit_hold_confirm(uuid, text, uuid, uuid, jsonb, text, text, text, text) to service_role;

-- ---- 4. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('visit_holds', 'visit_code_sends')) as policies,
  2 as _expect_policies,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('visit_holds_live_slot', 'visit_holds_live_estimate')) as live_indexes,
  2 as _expect_live_indexes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('visit_hold_place', 'visit_hold_resend', 'visit_hold_release', 'visit_hold_confirm')) as rpcs,
  4 as _expect_rpcs,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name like 'visit_hold_%' and grantee in ('anon', 'authenticated')) as rpc_grants_to_users,
  0 as _expect_rpc_grants_to_users,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and table_name in ('visit_holds', 'visit_code_sends')) as anon_grants,
  0 as _expect_anon_grants;

insert into public._prod_migrations(name) values ('20270214000000_visit_holds.sql') on conflict (name) do nothing;
