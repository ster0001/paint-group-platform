-- =============================================================================
-- The completion report, readable by the customer who signed it.
--
-- The ⚑10 email says "your completion report and warranty details are here"
-- and links to /s/<token> — which, until now, rendered a thank-you line and
-- nothing else. This is the read RPC that makes the email's promise true.
--
-- Customer token only, and only once signed: the DRAFT is previewed through
-- the walkthrough flow itself; the permanent record exists after signing.
-- The session token deliberately does not work here — it died at signing.
-- =============================================================================

create or replace function public.wo_report_by_token(p_token text)
returns table (report jsonb, warranty_starts date, warranty_ends date, warranty_years integer)
language sql security definer set search_path = public as $$
  select s.report, w.starts_on, w.ends_on, w.years
    from public.wo_signoff s
    left join public.warranties w on w.work_order_id = s.work_order_id
   where s.customer_token = p_token
     and s.signed_at is not null
     and s.report is not null
   limit 1;
$$;
grant execute on function public.wo_report_by_token(text) to anon, authenticated;

-- Verification: expect one row (security_definer = true).
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'wo_report_by_token';
