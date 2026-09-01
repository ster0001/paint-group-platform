-- Tom's 1 Sep batch, invoice items:
--   (a) the DEPOSIT (and progress) invoice shows the remaining amount payable —
--       invoice_by_token gains the ledger context for those kinds, which was
--       final-only since 20261114. The sheet renders "Contract total" and
--       "Remaining payable after this deposit — not due yet".
--   (b) the "Painting · Plastering · Restoration" tagline comes OFF the
--       invoice header — the seeded settings value is blanked (the field
--       stays in Settings → Invoicing for a future tagline; blank renders
--       nothing).
--
-- Body copied faithfully from 20261114000000_invoice_pdf_token.sql — the only
-- changes are the three case-gated context fields at the bottom widening from
-- kind = 'final' to kind in ('final','deposit','progress').

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
    -- Deposit/progress carry the same ledger context as the final so the
    -- customer document can say what remains payable (Tom, 1 Sep).
    'adjusted_contract_cents', case when v.kind in ('final', 'deposit', 'progress') then v_led.adjusted_contract_cents end,
    -- Once this invoice is issued it is itself inside ledger.invoiced — back it out.
    'previously_invoiced_cents', case when v.kind in ('final', 'deposit', 'progress')
                                      then greatest(v_led.invoiced_cents - v.total_inc_cents, 0) end,
    'previous_numbers', case when v.kind in ('final', 'deposit', 'progress') then coalesce(v_prev, '') end,
    'entity', (select value from public.settings where key = 'invoicing_entity'),
    'bank', (select value from public.settings where key = 'invoicing_bank')
  );
end $$;

grant execute on function public.invoice_by_token(text) to anon, authenticated;

-- (b) blank the seeded tagline — only if it still holds the seeded value, so a
-- deliberately-set custom tagline is never clobbered.
update public.settings
   set value = jsonb_set(value, '{brandSub}', '""'::jsonb)
 where key = 'invoicing_entity'
   and value->>'brandSub' = 'Painting · Plastering · Restoration';

-- ---- readback -------------------------------------------------------------
-- Expect: one row, secdef true; brand_sub empty string (or your own custom text).
select p.prosecdef as security_definer,
       (select value->>'brandSub' from public.settings where key = 'invoicing_entity') as brand_sub
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'invoice_by_token';
