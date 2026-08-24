-- =====================================================================
-- Invoicing Step 3 — PDF storage, attach guards, and the customer token read.
-- Brief: docs/briefs/claude-code-brief-invoicing-payments.md §6.7, §8 Step 3.
-- Requires 20261111–20261113 (all run live 24 Aug).
--
--   1. Private `invoice-docs` bucket (PDFs: invoices now; receipts too;
--      credit notes/remittances in later steps). No client access at all —
--      files are written server-side with the service key and read through
--      short-lived signed URLs the server mints. Creating a bucket is half
--      the job (house lesson) — here the OTHER half is deliberately "no
--      storage policies": nothing but the service role can touch it.
--   2. invoice_attach_pdf / payment_attach_receipt_pdf — pdf_path writes
--      once, ever. Regeneration after issue is refused HERE, not just
--      unlinked in code (the 20261112 trigger already refuses UPDATEs that
--      change a set pdf_path; this keeps the honest path single-shot too).
--   3. invoice_by_token — the estimate-token pattern: one token, ONE
--      invoice's customer-safe payload, or nothing. No margin, no
--      contractor money, no other invoice's numbers beyond the named
--      "previously invoiced" references on a final.
-- =====================================================================

-- ---- 1. the private bucket ------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-docs', 'invoice-docs', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- 2. attach-once guards ------------------------------------------------

create or replace function public.invoice_attach_pdf(p_invoice_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    return 'error:not_staff';
  end if;
  if coalesce(trim(p_path), '') = '' then return 'error:bad_path'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'draft' then return 'error:not_issued'; end if;
  if v.pdf_path is not null then return 'error:pdf_immutable'; end if;
  update public.invoices set pdf_path = trim(p_path) where id = p_invoice_id;
  return 'ok:attached';
end $$;

grant execute on function public.invoice_attach_pdf(uuid, text) to authenticated, service_role;

create or replace function public.payment_attach_receipt_pdf(p_payment_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.payments%rowtype;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    return 'error:not_staff';
  end if;
  if coalesce(trim(p_path), '') = '' then return 'error:bad_path'; end if;
  select * into v from public.payments where id = p_payment_id for update;
  if not found then return 'error:not_found'; end if;
  if v.receipt_pdf_path is not null then return 'error:pdf_immutable'; end if;
  update public.payments set receipt_pdf_path = trim(p_path) where id = p_payment_id;
  return 'ok:attached';
end $$;

grant execute on function public.payment_attach_receipt_pdf(uuid, text) to authenticated, service_role;

-- ---- 3. the token read ----------------------------------------------------

-- One token → one invoice's customer-safe document, as jsonb. Null for an
-- unknown token OR a draft (the link only means something once issued) —
-- the route turns null into a 404, never a 403. Void/written-off render
-- with their status so a stale link explains itself instead of lying.
create or replace function public.invoice_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.invoices%rowtype; v_led record; v_snap jsonb; v_prev text;
begin
  select * into v from public.invoices where token = p_token;
  if not found then return null; end if;
  -- Drafts exist only for STAFF eyes ("Preview as customer" during the final
  -- check, §7.3) — for anyone else an unissued invoice simply doesn't exist.
  if v.status = 'draft' and not public.is_staff() then return null; end if;

  select e.sent_snapshot into v_snap from public.estimates e where e.id = v.estimate_id;
  select * into v_led from public.invoice_ledger(v.estimate_id);

  select string_agg(i.number || ' ' || initcap(i.kind::text), ', ' order by i.issued_on)
    into v_prev
    from public.invoices i
   where i.estimate_id = v.estimate_id and i.id <> v.id
     and i.status not in ('draft', 'void') and i.number is not null;

  return jsonb_build_object(
    'number', v.number,
    'kind', v.kind::text,
    'status', v.status::text,
    'issued_on', v.issued_on,
    'due_on', v.due_on,
    'subtotal_ex_cents', v.subtotal_ex_cents,
    'gst_cents', v.gst_cents,
    'total_inc_cents', v.total_inc_cents,
    'has_pdf', v.pdf_path is not null,
    'billed_to', (select coalesce(e.accepted_name, '') from public.estimates e where e.id = v.estimate_id),
    'job_address', coalesce(v_snap->>'jobAddress', ''),
    'job_title', coalesce(v_snap->>'jobTitle', ''),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'description', l.description,
               'amount_ex_cents', l.amount_ex_cents,
               'source', l.source,
               'qty', l.qty,
               'approved_on', (select vv.customer_responded_at::date
                                 from public.wo_variations vv
                                where l.source = 'variation' and vv.id::text = l.source_ref)
             ) order by l.sort), '[]'::jsonb)
        from public.invoice_lines l where l.invoice_id = v.id
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'amount_cents', p.amount_cents,
               'surcharge_cents', p.surcharge_cents,
               'method', p.method,
               'paid_on', p.paid_on,
               'receipt_number', p.receipt_number
             ) order by p.created_at), '[]'::jsonb)
        from public.payments p where p.invoice_id = v.id and p.status = 'succeeded'
    ),
    'paid_cents', (
      select coalesce(sum(p.amount_cents), 0)
        from public.payments p where p.invoice_id = v.id and p.status = 'succeeded'
    ),
    'adjusted_contract_cents', case when v.kind = 'final' then v_led.adjusted_contract_cents end,
    -- Once this final is issued it is itself inside ledger.invoiced — back it out.
    'previously_invoiced_cents', case when v.kind = 'final'
                                      then greatest(v_led.invoiced_cents - v.total_inc_cents, 0) end,
    'previous_numbers', case when v.kind = 'final' then coalesce(v_prev, '') end,
    'entity', (select value from public.settings where key = 'invoicing_entity'),
    'bank', (select value from public.settings where key = 'invoicing_bank')
  );
end $$;

grant execute on function public.invoice_by_token(text) to anon, authenticated;

-- ---- readback -------------------------------------------------------------
-- Expect: the bucket, private, pdf-only.
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'invoice-docs';
-- Expect 3 functions, all security definer.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('invoice_attach_pdf', 'payment_attach_receipt_pdf', 'invoice_by_token')
 order by p.proname;
-- Expect zero storage policies naming invoice-docs (service-only bucket).
select count(*) as invoice_docs_policies
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and coalesce(qual, '') || coalesce(with_check, '') like '%invoice-docs%';
