-- =============================================================================
-- Constraints on what may be written - the remainder of audit finding C4
--
-- Money and state already go through validated server functions (R2, R2b, R3).
-- What was left is the ordinary editable data, where RLS decides WHICH ROWS a
-- person may touch but nothing decides WHAT they may put in them. A contractor
-- can set their crew size to 99,000 or an insurance certificate to expire in
-- 2099, entirely within policy.
--
-- These go in the database rather than in a server action on purpose. The
-- standard says the database is the last line of defence, and unlike a route,
-- a CHECK cannot be gone around by anyone holding the anon key and curl.
--
-- Nothing here should ever fire for a person using the actual screens: the
-- limits are far outside any real value. They exist for the request that did
-- not come from the screens.
-- =============================================================================

-- ---- 1. crew size -----------------------------------------------------------
-- The portal already clamps 1..99 in the browser; this is the same rule where
-- it cannot be edited out.
alter table public.contractors drop constraint if exists contractors_crew_size_sane;
alter table public.contractors add constraint contractors_crew_size_sane
  check (crew_size is null or (crew_size >= 1 and crew_size <= 99));

-- ---- 2. free-text fields can't be used as storage ---------------------------
-- An unbounded text column on a table anyone signed-in can write to is a place
-- to park a megabyte. These lengths are generous for their actual contents.
alter table public.contractors drop constraint if exists contractors_text_lengths;
alter table public.contractors add constraint contractors_text_lengths
  check (
    coalesce(length(company_name), 0) <= 120
    and coalesce(length(abn), 0) <= 20
    and coalesce(length(address), 0) <= 300
    and coalesce(length(invoice_prefix), 0) <= 8
    and coalesce(length(bank_bsb), 0) <= 10
  );

alter table public.contractor_documents drop constraint if exists contractor_documents_text_lengths;
alter table public.contractor_documents add constraint contractor_documents_text_lengths
  check (coalesce(length(name), 0) <= 200 and coalesce(length(file_url), 0) <= 400);

-- ---- 3. a certificate cannot expire in 2099 ---------------------------------
-- Has to be a trigger, not a CHECK: a CHECK may only call immutable functions,
-- and "ten years from now" moves. Uploading an ALREADY-expired certificate
-- stays legal - that is a real thing people do, and the compliance rule handles
-- it by refusing to make them offerable.
create or replace function public.contractor_doc_expiry_sane()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.expires_on is not null then
    if new.expires_on > current_date + interval '10 years' then
      raise exception 'expiry date is too far in the future';
    end if;
    if new.expires_on < current_date - interval '20 years' then
      raise exception 'expiry date is implausibly old';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists contractor_doc_expiry_sane_t on public.contractor_documents;
create trigger contractor_doc_expiry_sane_t
  before insert or update of expires_on on public.contractor_documents
  for each row execute function public.contractor_doc_expiry_sane();

-- ---- 4. invite lifetimes ----------------------------------------------------
-- p_days came straight from the caller with only a lower bound, so an invite
-- could be minted to last 3,650 days. Unchanged otherwise.
create or replace function public.create_contractor_invite(
  p_email text, p_name text default '', p_company text default '',
  p_tier text default null, p_days integer default 7
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_days integer;
begin
  if not public.is_staff() then raise exception 'not authorised'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email required'; end if;
  if position('@' in p_email) = 0 then raise exception 'that is not an email address'; end if;
  if length(trim(p_email)) > 200 then raise exception 'email is too long'; end if;

  -- A month is already generous for "come and join up".
  v_days := least(30, greatest(1, coalesce(p_days, 7)));

  update public.contractor_invites
     set revoked_at = now()
   where lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.contractor_invites (email, name, company_name, tier, token, created_by, expires_at)
  values (lower(trim(p_email)), left(coalesce(p_name, ''), 120), left(coalesce(p_company, ''), 120), p_tier,
          v_token, auth.uid(), now() + make_interval(days => v_days));

  return v_token;
end $$;
grant execute on function public.create_contractor_invite(text, text, text, text, integer) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As a contractor, each of these must now be refused:
--   update contractors set crew_size = 99000 where profile_id = auth.uid();
--   insert into contractor_documents (contractor_id, kind, expires_on) values (..., '2099-01-01');
-- And as staff, an invite asked to last 3650 days must come back lasting 30:
--   select expires_at from contractor_invites order by created_at desc limit 1;
