-- =============================================================================
-- Contractor invites + staff control of account access
--
-- Until now the ONLY way a contractor account existed was a developer running a
-- script. This lets staff invite a painter and control their access afterwards.
--
-- How an invite works:
--   staff create one  -> a single-use token, valid 7 days by default
--   staff send the link however they like (text, WhatsApp, email)
--   the painter opens it, sets a password, and lands in the portal with their
--   company details already filled in
--
-- The token is BOUND TO THE INVITED EMAIL. A forwarded link cannot be claimed by
-- somebody else, because redeeming checks the signed-in address against the
-- invited one.
--
-- Two privilege holes are closed at the bottom of this file: a contractor could
-- previously set their own `active` (undoing a suspension) and their own `tier`
-- (promoting themselves into a tier staff filter and offer work by).
-- =============================================================================

create table if not exists public.contractor_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  name         text not null default '',
  company_name text not null default '',
  tier         text,
  token        text not null unique,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz
);
create index if not exists contractor_invites_email_idx on public.contractor_invites (lower(email));

-- Only ONE live invite per email, so re-inviting can't leave two valid links out.
create unique index if not exists contractor_invites_one_live
  on public.contractor_invites (lower(email))
  where accepted_at is null and revoked_at is null;

alter table public.contractor_invites enable row level security;

-- Staff only. The join page reads through a SECURITY DEFINER function instead,
-- so an un-authenticated visitor never gets a select on this table.
drop policy if exists contractor_invites_staff on public.contractor_invites;
create policy contractor_invites_staff on public.contractor_invites
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- create -----------------------------------------------------------------
create or replace function public.create_contractor_invite(
  p_email text, p_name text default '', p_company text default '',
  p_tier text default null, p_days integer default 7
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not public.is_staff() then raise exception 'not authorised'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email required'; end if;

  -- Re-inviting the same person supersedes the old link rather than erroring.
  update public.contractor_invites
     set revoked_at = now()
   where lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.contractor_invites (email, name, company_name, tier, token, created_by, expires_at)
  values (lower(trim(p_email)), coalesce(p_name, ''), coalesce(p_company, ''), p_tier,
          v_token, auth.uid(), now() + make_interval(days => greatest(1, coalesce(p_days, 7))));

  return v_token;
end $$;
grant execute on function public.create_contractor_invite(text, text, text, text, integer) to authenticated;

-- ---- preview (the join page, before anyone has signed in) --------------------
-- Returns only what the page needs to say "Paint Group invited you". Never
-- exposes the token list or anything about other invites.
create or replace function public.contractor_invite_preview(p_token text)
returns table (email text, name text, company_name text, status text)
language plpgsql security definer set search_path = public stable as $$
declare v public.contractor_invites%rowtype;
begin
  select * into v from public.contractor_invites where token = p_token;
  if not found then
    return query select ''::text, ''::text, ''::text, 'not_found'::text; return;
  end if;
  if v.revoked_at is not null then
    return query select ''::text, ''::text, ''::text, 'revoked'::text; return;
  end if;
  if v.accepted_at is not null then
    return query select v.email, v.name, v.company_name, 'used'::text; return;
  end if;
  if v.expires_at < now() then
    return query select v.email, v.name, v.company_name, 'expired'::text; return;
  end if;
  return query select v.email, v.name, v.company_name, 'valid'::text;
end $$;
grant execute on function public.contractor_invite_preview(text) to anon, authenticated;

-- ---- redeem -----------------------------------------------------------------
-- Called immediately after the invitee signs up. Promotes their profile to
-- 'contractor' and creates their contractors row with the details staff entered.
create or replace function public.redeem_contractor_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_invites%rowtype; v_uid uuid; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then return 'error:not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v from public.contractor_invites where token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v.revoked_at is not null then return 'error:revoked'; end if;
  if v.accepted_at is not null then return 'error:used'; end if;
  if v.expires_at < now() then return 'error:expired'; end if;

  -- The link is tied to the person it was sent to. Forwarding it doesn't work.
  if lower(v_email) <> lower(v.email) then return 'error:email_mismatch'; end if;

  update public.profiles
     set role = 'contractor', name = coalesce(nullif(v.name, ''), name)
   where id = v_uid;

  insert into public.contractors (profile_id, company_name, tier, active)
  values (v_uid, coalesce(v.company_name, ''), v.tier, true)
  on conflict (profile_id) do update
    set company_name = coalesce(nullif(excluded.company_name, ''), public.contractors.company_name),
        tier = coalesce(excluded.tier, public.contractors.tier),
        active = true;

  update public.contractor_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v.id;

  return 'ok';
end $$;
grant execute on function public.redeem_contractor_invite(text) to authenticated;

-- ---- staff control of an existing account -----------------------------------
create or replace function public.set_contractor_active(p_contractor_id uuid, p_active boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.contractors set active = p_active where id = p_contractor_id;
  if not found then return 'error:not_found'; end if;
  -- Suspending pulls any live offer: it would be unfair to leave a countdown
  -- running against someone who can no longer open the portal.
  if p_active = false then
    update public.booking_offers
       set state = 'withdrawn', responded_at = now()
     where contractor_id = p_contractor_id and state in ('offered', 'proposed');
  end if;
  return case when p_active then 'active' else 'suspended' end;
end $$;
grant execute on function public.set_contractor_active(uuid, boolean) to authenticated;

create or replace function public.set_contractor_tier(p_contractor_id uuid, p_tier text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.contractors set tier = nullif(trim(coalesce(p_tier, '')), '') where id = p_contractor_id;
  return 'ok';
end $$;
grant execute on function public.set_contractor_tier(uuid, text) to authenticated;

-- ---- close two privilege holes ----------------------------------------------
-- `active` and `tier` were writable by the contractor themselves, which meant a
-- suspended contractor could switch their access back on, and anyone could
-- promote their own tier — the field staff filter and assign work by. Both now
-- go through the staff RPCs above.
revoke update (active, tier) on public.contractors from authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff:  select public.create_contractor_invite('painter@example.com','Sam','Sam Painting','B');
-- Signed in as a DIFFERENT email, redeeming that token -> 'error:email_mismatch'.
-- As a contractor: update contractors set active = true where profile_id = auth.uid();
--   -> permission denied. Same for tier.
