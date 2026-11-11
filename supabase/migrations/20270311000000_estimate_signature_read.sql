-- =============================================================================
-- The signed estimate (Tom, 11 Nov 2026): when a customer signs an estimate
-- and I download it from the estimates tab, I cannot see their signature.
--
-- The drawn signature has been stored on acceptance since 20260816
-- (estimates.accepted_signature, a PNG data URL written by
-- save_estimate_signature) but nothing ever read it back: get_estimate_by_token
-- does not return it and the printed estimate drew three blank lines.
--
-- 1. estimate_signature_by_token — the read of the signature for the token page,
--    name and date. Accepted estimates only; anything else (unknown token,
--    draft, sent, declined) answers null, so there is nothing to enumerate.
--    A separate function rather than a new column on get_estimate_by_token,
--    so the return type of that function (and every caller) is untouched.
-- 2. save_estimate_signature now writes only to an ACCEPTED estimate and only
--    a PNG data URL under 1 MB. It used to take any text against any token,
--    and the printed estimate now draws what it holds.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.estimate_signature_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'signature', e.accepted_signature,
           'name', e.accepted_name,
           'at', e.accepted_at)
    from public.estimates e
   where e.share_token = p_token
     and e.status = 'accepted'
   limit 1;
$$;
grant execute on function public.estimate_signature_by_token(text) to anon, authenticated;

create or replace function public.save_estimate_signature(p_token text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.estimate_status;
begin
  select id, status into v_id, v_status from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  if v_status <> 'accepted' then return 'not_accepted'; end if;
  if p_signature is null
     or left(p_signature, 22) <> 'data:image/png;base64,'
     or length(p_signature) > 1000000 then
    return 'bad_signature';
  end if;
  update public.estimates set accepted_signature = p_signature where id = v_id;
  return 'ok';
end; $$;
grant execute on function public.save_estimate_signature(text, text) to anon, authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select has_function_privilege('anon', 'public.estimate_signature_by_token(text)', 'execute')) as read_anon, true as _expect_read_anon,
  (select prosecdef from pg_proc where oid = 'public.estimate_signature_by_token(text)'::regprocedure) as read_definer, true as _expect_read_definer,
  (select has_function_privilege('anon', 'public.save_estimate_signature(text, text)', 'execute')) as save_anon, true as _expect_save_anon,
  (select pg_get_functiondef('public.save_estimate_signature(text, text)'::regprocedure) like '%not_accepted%') as save_guarded, true as _expect_save_guarded,
  (select count(*) from public.estimates where status = 'accepted') as accepted_estimates,
  (select count(*) from public.estimates where status = 'accepted' and accepted_signature is not null) as accepted_with_signature;

insert into public._prod_migrations(name) values ('20270311000000_estimate_signature_read.sql') on conflict (name) do nothing;
