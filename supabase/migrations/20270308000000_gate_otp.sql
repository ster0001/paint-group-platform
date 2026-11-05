-- The wizard gate one-time code (Tom, 5 Nov 2026: Add OTP to the gate for
-- customers to put in their mobile number and they have to input the code to
-- get the price).
--
-- One table, three definer functions, no grants: everything runs through the
-- service client from /api/wizard/otp/* and /api/wizard/submit. A customer
-- reads none of it (RLS on, no policies — the service role bypasses RLS), and
-- the plain code is never stored: the row carries a salted hash, exactly like
-- visit_holds.code_hash (20270214).
--
--   wizard_otp_codes      one row per code texted: who (the anonymous wizard
--                         user), the mobile as ten digits, the hash, when it
--                         expires (10 minutes), how many wrong tries (5 ends it),
--                         when it was consumed (= the mobile is verified for
--                         this draft, for 24 hours).
--   wizard_otp_send       the limits, then the row: 3 sends per mobile per hour,
--                         60 s between sends, 30 per IP per hour; an already
--                         verified mobile answers status verified and texts nothing.
--   wizard_otp_verify     the latest live code, the hash compared, the attempt
--                         counted — one transaction.
--   wizard_otp_verified   is this mobile verified for this user? (the submit
--                         the submit route check: 409 otp_required without it)
--
-- Converges on a re-run. Paste starts with the lock timeout; read the read-back
-- row against its _expect_ values before anything depends on it.
set lock_timeout = '15s';

create table if not exists public.wizard_otp_codes (
  id           uuid primary key default gen_random_uuid(),
  -- the anonymous auth user the wizard already creates; the row goes with them
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- ten digits, 04xxxxxxxx — never spaces, never +61
  mobile       text not null check (mobile ~ '^04[0-9]{8}$'),
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     smallint not null default 0 check (attempts >= 0),
  consumed_at  timestamptz,
  ip_hash      text,
  created_at   timestamptz not null default now()
);
create index if not exists wizard_otp_codes_mobile_idx on public.wizard_otp_codes (mobile, created_at);
create index if not exists wizard_otp_codes_user_idx on public.wizard_otp_codes (user_id, mobile, created_at);
create index if not exists wizard_otp_codes_ip_idx on public.wizard_otp_codes (ip_hash, created_at);

-- RLS on, NO policies: the service role is the only reader and writer.
alter table public.wizard_otp_codes enable row level security;
revoke all on public.wizard_otp_codes from public, anon, authenticated;

-- ---- the functions: service_role only (default privileges since 20270201; made explicit) ----

create or replace function public.wizard_otp_verified(p_user uuid, p_mobile text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wizard_otp_codes
     where user_id = p_user and mobile = p_mobile
       and consumed_at is not null and consumed_at > now() - interval '24 hours'
  );
$$;
revoke execute on function public.wizard_otp_verified(uuid, text) from public, anon, authenticated;

-- Returns {status: verified | too_soon (wait_s) | limited (wait_s) | ok (id, expires_at)}.
create or replace function public.wizard_otp_send(p_user uuid, p_mobile text, p_code_hash text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_recent int; v_oldest timestamptz; v_last timestamptz; v_ip int; v_id uuid; v_expires timestamptz;
begin
  if public.wizard_otp_verified(p_user, p_mobile) then
    return jsonb_build_object('status', 'verified');
  end if;
  -- one mobile at a time: the counts are read and the row written under the same lock
  perform pg_advisory_xact_lock(hashtext('wizard_otp:' || p_mobile));
  select count(*), min(created_at), max(created_at) into v_recent, v_oldest, v_last
    from public.wizard_otp_codes where mobile = p_mobile and created_at > now() - interval '1 hour';
  if v_last is not null and v_last > now() - interval '60 seconds' then
    return jsonb_build_object('status', 'too_soon', 'wait_s', ceil(extract(epoch from (v_last + interval '60 seconds' - now()))));
  end if;
  if v_recent >= 3 then
    return jsonb_build_object('status', 'limited', 'wait_s', ceil(extract(epoch from (v_oldest + interval '1 hour' - now()))));
  end if;
  if p_ip_hash is not null then
    select count(*) into v_ip from public.wizard_otp_codes where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_ip >= 30 then
      return jsonb_build_object('status', 'limited', 'wait_s', 3600);
    end if;
  end if;
  -- a new code replaces any live one for this user and mobile
  update public.wizard_otp_codes set expires_at = now()
    where user_id = p_user and mobile = p_mobile and consumed_at is null and expires_at > now();
  v_expires := now() + interval '10 minutes';
  insert into public.wizard_otp_codes (user_id, mobile, code_hash, expires_at, ip_hash)
    values (p_user, p_mobile, p_code_hash, v_expires, p_ip_hash) returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id, 'expires_at', v_expires);
end $$;
revoke execute on function public.wizard_otp_send(uuid, text, text, text) from public, anon, authenticated;

-- Returns {status: ok | wrong (attempts_left) | ended | expired | none}.
create or replace function public.wizard_otp_verify(p_user uuid, p_mobile text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.wizard_otp_codes;
begin
  select * into r from public.wizard_otp_codes
    where user_id = p_user and mobile = p_mobile and consumed_at is null
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status', 'none'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  if r.code_hash <> p_code_hash then
    update public.wizard_otp_codes set attempts = attempts + 1 where id = r.id;
    if r.attempts + 1 >= 5 then
      update public.wizard_otp_codes set expires_at = now() where id = r.id;
      return jsonb_build_object('status', 'ended');
    end if;
    return jsonb_build_object('status', 'wrong', 'attempts_left', 5 - (r.attempts + 1));
  end if;
  update public.wizard_otp_codes set consumed_at = now(), attempts = attempts + 1 where id = r.id;
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.wizard_otp_verify(uuid, text, text) from public, anon, authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ----------------------------------
select
  (select relrowsecurity from pg_class where oid = 'public.wizard_otp_codes'::regclass) as rls_on, true as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wizard_otp_codes') as policies, 0 as _expect_policies,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'wizard_otp_codes' and indexname like 'wizard_otp_codes_%') as indexes, 3 as _expect_indexes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wizard_otp_send', 'wizard_otp_verify', 'wizard_otp_verified')) as fns, 3 as _expect_fns,
  has_table_privilege('anon', 'public.wizard_otp_codes', 'select') as anon_reads, false as _expect_anon_reads,
  has_table_privilege('authenticated', 'public.wizard_otp_codes', 'select') as authenticated_reads, false as _expect_authenticated_reads,
  has_function_privilege('anon', 'public.wizard_otp_send(uuid, text, text, text)', 'execute') as send_anon, false as _expect_send_anon,
  has_function_privilege('authenticated', 'public.wizard_otp_send(uuid, text, text, text)', 'execute') as send_authenticated, false as _expect_send_authenticated,
  has_function_privilege('authenticated', 'public.wizard_otp_verify(uuid, text, text)', 'execute') as verify_authenticated, false as _expect_verify_authenticated,
  has_function_privilege('service_role', 'public.wizard_otp_verify(uuid, text, text)', 'execute') as verify_service, true as _expect_verify_service;

insert into public._prod_migrations(name) values ('20270308000000_gate_otp.sql') on conflict (name) do nothing;
