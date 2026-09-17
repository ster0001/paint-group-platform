-- 18 Sep 2026 security audit — function-level hardening.
--
-- 1. contractor_invoice_attach_pdf / contractor_invoice_attach_remittance_pdf
--    were SECURITY DEFINER, granted to `authenticated`, and checked NOTHING.
--    Any signed-in principal (any contractor) could point any contractor
--    invoice's PDF or remittance at an arbitrary storage path — attach-once,
--    so unfixable in place — or probe invoice ids through the
--    not_found/already oracle. Their customer-side twin
--    (invoice_attach_pdf, 20261114) has always gated on
--    `is_staff() or auth.role() = 'service_role'`; these now match. The only
--    caller is lib/invoicing/pdf.ts through the service client, which passes.
-- 2. wo_seed_qa_items and wo_assignment_conflict had no explicit grant and
--    no revoke, so Postgres's default EXECUTE TO PUBLIC applied: any
--    authenticated user could seed canned QA rows onto any check id, or
--    read contractor booking conflicts through an RLS-bypassing definer
--    function. Both are only ever called from other SECURITY DEFINER
--    functions (wo_qa_items_on_check trigger; assign_job / reassign_dates),
--    which run as the owner, so revoking from callers changes nothing legitimate.
-- 3. company-docs: the bucket's `on conflict do update` re-pinned size and
--    MIME but not `public`; pin it false like every other private bucket.

create or replace function public.contractor_invoice_attach_pdf(p_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    return 'error:not_staff';
  end if;
  if coalesce(trim(p_path), '') = '' then return 'error:bad_path'; end if;
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.invoice_pdf_path is not null then return 'ok:already'; end if;
  update public.contractor_invoices set invoice_pdf_path = trim(p_path) where id = p_id;
  return 'ok:attached';
end $$;
revoke execute on function public.contractor_invoice_attach_pdf(uuid, text) from public, anon;
grant execute on function public.contractor_invoice_attach_pdf(uuid, text) to authenticated, service_role;

create or replace function public.contractor_invoice_attach_remittance_pdf(p_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    return 'error:not_staff';
  end if;
  if coalesce(trim(p_path), '') = '' then return 'error:bad_path'; end if;
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.remittance_pdf_path is not null then return 'ok:already'; end if;
  update public.contractor_invoices set remittance_pdf_path = trim(p_path) where id = p_id;
  return 'ok:attached';
end $$;
revoke execute on function public.contractor_invoice_attach_remittance_pdf(uuid, text) from public, anon;
grant execute on function public.contractor_invoice_attach_remittance_pdf(uuid, text) to authenticated, service_role;

revoke execute on function public.wo_seed_qa_items(uuid) from public, anon, authenticated;
revoke execute on function public.wo_assignment_conflict(uuid, date, date, uuid) from public, anon, authenticated;

update storage.buckets set public = false where id = 'company-docs' and public = true;

-- ---- read-back -------------------------------------------------------------------------
select
  (select prosrc like '%not_staff%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_invoice_attach_pdf') as attach_pdf_guarded,
  (select prosrc like '%not_staff%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_invoice_attach_remittance_pdf') as attach_remittance_guarded,
  not has_function_privilege('authenticated', 'public.wo_seed_qa_items(uuid)', 'execute') as seed_qa_revoked,
  not has_function_privilege('authenticated', 'public.wo_assignment_conflict(uuid, date, date, uuid)', 'execute') as conflict_revoked,
  (select not public from storage.buckets where id = 'company-docs') as company_docs_private;

insert into public._prod_migrations(name) values ('20270167000000_security_hardening_function_guards.sql') on conflict (name) do nothing;
