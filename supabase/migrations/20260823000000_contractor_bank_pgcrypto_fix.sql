-- =============================================================================
-- Fix: contractor bank RPCs could not find pgcrypto
--
-- On Supabase, pgcrypto is installed into the `extensions` schema, not `public`.
-- The Phase A migration created contractor_set_bank / contractor_get_bank with
--   set search_path = public, vault
-- which leaves `extensions` off the path, so both RPCs failed at runtime with
--   function pgp_sym_encrypt(text, text) does not exist
--
-- This recreates both functions with `extensions` on the search_path. Nothing
-- else changes — same signatures, same behaviour, same grants.
-- =============================================================================

create or replace function public.contractor_set_bank(p_bsb text, p_account text)
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_cid uuid; v_key text;
begin
  select id into v_cid from public.contractors where profile_id = auth.uid();
  if v_cid is null then raise exception 'not a contractor'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  update public.contractors
    set bank_bsb = p_bsb,
        bank_account_enc = pgp_sym_encrypt(coalesce(p_account, ''), v_key),
        bank_account_last4 = right(regexp_replace(coalesce(p_account, ''), '\D', '', 'g'), 4)
    where id = v_cid;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'bank_changed', jsonb_build_object('bsb', p_bsb, 'last4', right(regexp_replace(coalesce(p_account, ''), '\D', '', 'g'), 4)), auth.uid());
end $$;

create or replace function public.contractor_get_bank(p_contractor_id uuid default null)
returns table (bsb text, account text) language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_cid uuid; v_key text;
begin
  v_cid := coalesce(p_contractor_id, (select id from public.contractors where profile_id = auth.uid()));
  if not (public.is_staff() or v_cid = (select id from public.contractors where profile_id = auth.uid())) then
    raise exception 'not authorised'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  return query select c.bank_bsb, case when c.bank_account_enc is null then '' else pgp_sym_decrypt(c.bank_account_enc, v_key) end
    from public.contractors c where c.id = v_cid;
end $$;

grant execute on function public.contractor_set_bank(text, text) to authenticated;
grant execute on function public.contractor_get_bank(uuid) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- Signed in as a contractor, this should return no error and then show the last4:
--   select public.contractor_set_bank('063-000', '12345678');
--   select bank_bsb, bank_account_last4 from public.contractors where profile_id = auth.uid();
--   select * from public.contractor_get_bank();
