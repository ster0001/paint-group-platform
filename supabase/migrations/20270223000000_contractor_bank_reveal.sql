-- =============================================================================
-- 20270223 · The office can reveal a painter's bank details (Tom, 7 Oct 2026)
--
-- "There is no way to see them." contractor_get_bank(uuid) has let staff read
-- the decrypted account since 20260822, but 20270201 (advisor hardening) listed
-- it among the internal-only helpers and revoked EXECUTE from authenticated, so
-- no session could call it — the only reader was the painter's own profile,
-- which happened to never call it either (it shows last4 from the row).
--
-- This re-grants it to signed-in users (the function's own is_staff()/self
-- check stays the gate) and makes each staff reveal leave a contractor_events
-- row ('bank_viewed', actor, last4) — a decrypted account number is looked at
-- on the record, never silently. Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.contractor_get_bank(p_contractor_id uuid default null)
returns table (bsb text, account text) language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_cid uuid; v_self uuid; v_key text; v_last4 text;
begin
  select id into v_self from public.contractors where profile_id = auth.uid();
  v_cid := coalesce(p_contractor_id, v_self);
  if v_cid is null then raise exception 'not authorised'; end if;
  if not (public.is_staff() or v_cid = v_self) then raise exception 'not authorised'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  -- A staff member looking at someone else's account number is on the record.
  if v_cid is distinct from v_self then
    select c.bank_account_last4 into v_last4 from public.contractors c where c.id = v_cid;
    insert into public.contractor_events (contractor_id, type, detail, actor)
      values (v_cid, 'bank_viewed', jsonb_build_object('last4', v_last4), auth.uid());
  end if;
  return query select c.bank_bsb, case when c.bank_account_enc is null then '' else pgp_sym_decrypt(c.bank_account_enc, v_key) end
    from public.contractors c where c.id = v_cid;
end $$;

revoke all on function public.contractor_get_bank(uuid) from public, anon;
grant execute on function public.contractor_get_bank(uuid) to authenticated;

-- ---- read-back: compare to the _expect_ column before calling this live ------
select
  has_function_privilege('authenticated', 'public.contractor_get_bank(uuid)', 'execute') as authenticated_can_get_bank, true as _expect_grant,
  has_function_privilege('anon', 'public.contractor_get_bank(uuid)', 'execute') as anon_can_get_bank, false as _expect_anon,
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contractor_get_bank') as is_definer, true as _expect_definer,
  (select position('bank_viewed' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contractor_get_bank') as logs_views, true as _expect_logs;

insert into public._prod_migrations(name) values ('20270223000000_contractor_bank_reveal.sql') on conflict (name) do nothing;
