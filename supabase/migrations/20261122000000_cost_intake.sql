-- ============================================================================
-- Cost capture 6a — one pipeline, four doors (cost_intake)
-- Brief: docs/briefs/claude-code-brief-cost-capture.md (§1–§5, §8 6a) +
--        docs/briefs/claude-code-brief-invoicing-payments.md §6.5.
--
-- The AI reads, a human confirms, the ledger records. Nothing becomes a cost
-- row without a staff confirm (⚑A1/⚑19 auto-confirm is OFF and deliberately
-- NOT implemented — the accuracy readout earns it later); unreadable documents
-- fail loudly into the queue (extract_status 'failed'), never silently to $0;
-- duplicates are flagged, never written twice.
--
-- Idempotent; safe to re-run. Ends with read-backs (house law).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The job code — work_orders.job_no (⚑A3/⚑21: order reference "PG-0087")
--
-- wo_ref is a random token; suppliers can't quote it on an order. job_no is a
-- small sequential integer, backfilled oldest-first so existing jobs read
-- chronologically, defaulted for every future WO. Display form is
-- 'PG-' || lpad(job_no, 4, '0') — formatting lives in lib/costs, never here.
-- ----------------------------------------------------------------------------

create sequence if not exists public.job_no_seq;

alter table public.work_orders add column if not exists job_no integer;

do $$
begin
  if exists (select 1 from public.work_orders where job_no is null) then
    with ordered as (
      select id,
             row_number() over (order by created_at, id) as rn,
             coalesce((select max(job_no) from public.work_orders where job_no is not null), 0) as base
        from public.work_orders
       where job_no is null
    )
    update public.work_orders w
       set job_no = o.base + o.rn
      from ordered o
     where o.id = w.id;
  end if;
  perform setval('public.job_no_seq',
                 coalesce((select max(job_no) from public.work_orders), 0) + 1,
                 false);
end $$;

alter table public.work_orders alter column job_no set default nextval('public.job_no_seq');
alter table public.work_orders alter column job_no set not null;
create unique index if not exists work_orders_job_no_key on public.work_orders (job_no);

-- ----------------------------------------------------------------------------
-- 2. cost_intake — every cost enters here, whatever the door
-- ----------------------------------------------------------------------------

create table if not exists public.cost_intake (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null
                      check (source in ('email', 'photo', 'contractor', 'airtable', 'manual')),
  message_id          text unique,              -- email/airtable idempotency key
  raw_doc_path        text,                     -- cost-docs bucket path (the source document)
  from_email          text not null default '', -- sender (vendor memory learns the domain)
  subject             text not null default '',
  -- What the reader proposed. Shape: {supplier, abn, invoice_no, invoice_date,
  -- subtotal_ex_cents, gst_cents, total_cents, order_ref, address_text,
  -- job_hints[], confidence:{field: 0..1}}. AI proposes only — these figures
  -- are never final until a person confirms (same provenance discipline as
  -- the plan reader: ai_extracted until human_confirmed).
  extracted           jsonb not null default '{}'::jsonb,
  extract_status      text not null default 'pending'
                      check (extract_status in ('pending', 'extracted', 'failed')),
  model               text,
  prompt_version      text,
  input_tokens        integer,
  output_tokens       integer,
  cost_cents          integer,
  proposed_vendor_id  uuid references public.vendors (id) on delete set null,
  proposed_wo_id      uuid references public.work_orders (id) on delete set null,
  match_reason        text not null default 'none'
                      check (match_reason in ('order_ref', 'address', 'vendor_memory', 'none')),
  status              text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'rejected', 'duplicate')),
  duplicate_of        uuid references public.cost_intake (id) on delete set null,
  -- Proposed vs confirmed IS the accuracy readout (§2.1): the delta between
  -- proposed_wo_id/proposed_vendor_id and these two is the evidence for ⚑A1.
  confirmed_wo_id     uuid references public.work_orders (id) on delete set null,
  confirmed_vendor_id uuid references public.vendors (id) on delete set null,
  confirmed_by        uuid references auth.users (id) on delete set null,
  confirmed_at        timestamptz,              -- decision time (confirm, reject OR dismiss)
  resulting_type      text check (resulting_type in ('job_cost', 'material_cost')),
  resulting_id        uuid,
  created_at          timestamptz not null default now()
);

-- The queue: pending cards + undismissed duplicate flags.
create index if not exists cost_intake_queue_idx
  on public.cost_intake (created_at desc)
  where status in ('pending', 'duplicate') and confirmed_at is null;
-- The accuracy readout scans the last 30 days of decided rows.
create index if not exists cost_intake_decided_idx
  on public.cost_intake (confirmed_at desc)
  where confirmed_at is not null;

-- ----------------------------------------------------------------------------
-- 3. Vendor memory + destination-table extensions
-- ----------------------------------------------------------------------------

-- Once a sender is confirmed, future mail prefills (§2.1b). extraction_hints
-- are optional staff-set per-vendor reading notes injected into the extraction
-- prompt for that vendor only (e.g. {"invoice_no_label": "Docket #"}).
alter table public.vendors
  add column if not exists sender_domains   text[] not null default '{}',
  add column if not exists extraction_hints jsonb  not null default '{}'::jsonb;

alter table public.job_costs
  add column if not exists paid_with    text not null default 'account'
                           check (paid_with in ('company_card', 'personal', 'account')),
  add column if not exists reimburse_to uuid references auth.users (id) on delete set null,
  add column if not exists intake_id    uuid references public.cost_intake (id) on delete set null,
  add column if not exists invoice_no   text not null default '',
  add column if not exists invoice_date date,
  add column if not exists approved_at  timestamptz,
  add column if not exists approved_by  uuid references auth.users (id) on delete set null;

alter table public.material_costs
  add column if not exists intake_id uuid references public.cost_intake (id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. RLS — staff read; every write is an RPC (house law, same loop as core)
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['cost_intake']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (public.is_staff())$f$,
      t || '_staff', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. cost-docs bucket — the raw documents (private; staff read via signed URL)
--    Path contract: bills/{yyyy-mm}/{key}/…  = service-role writes (webhooks);
--                   receipts/{userId}/…      = staff signed uploads (manual/6b).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cost-docs', 'cost-docs', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
              'application/json', 'text/plain', 'text/html', 'message/rfc822'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cost_docs_objects_read on storage.objects;
create policy cost_docs_objects_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cost-docs' and public.is_staff());

drop policy if exists cost_docs_objects_write on storage.objects;
create policy cost_docs_objects_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cost-docs' and public.is_staff()
              and name like 'receipts/' || auth.uid()::text || '/%');

drop policy if exists cost_docs_objects_delete on storage.objects;
create policy cost_docs_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'cost-docs' and public.is_staff()
         and name like 'receipts/' || auth.uid()::text || '/%');

-- ----------------------------------------------------------------------------
-- 6. Settings — every ⚑ a Settings value with the brief's default
-- ----------------------------------------------------------------------------

insert into public.settings (key, value) values
  ('cost_intake', jsonb_build_object(
    'duplicateWindowDays', 7,        -- the same-total-same-sender window
    'autoConfirmExactRef', false,    -- ⚑A1/⚑19 — OFF; readout earns it later
    'expenseThresholdCents', 10000,  -- ⚑A5/⚑23 — contractor ask-first over $100 (6c)
    'claimableCategories', jsonb_build_array(
      'materials_topup', 'sundries', 'parking', 'tip_fees', 'other')
  ))
on conflict (key) do nothing;

create or replace function public.cost_setting_num(p_path text[], p_default numeric)
returns numeric language sql stable as
$$ select coalesce((select nullif(value #>> p_path, '') from public.settings
                     where key = 'cost_intake')::numeric, p_default) $$;

-- ----------------------------------------------------------------------------
-- 7. The idempotency door — same 3-state shape as stripe_event_insert.
--    'new' = process; 'retry' = seen but extraction never finished — run it
--    again; 'done' = extraction complete, acknowledge and stop. Each answer
--    carries the intake id: 'new:<uuid>'.
-- ----------------------------------------------------------------------------

create or replace function public.cost_intake_insert(
  p_message_id text, p_source text, p_raw_doc_path text,
  p_from_email text, p_subject text
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_extract text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'cost_intake_service_only';
  end if;
  if coalesce(trim(p_message_id), '') = '' then return 'error:no_message_id'; end if;
  if p_source not in ('email', 'airtable', 'photo', 'contractor') then
    return 'error:bad_source';
  end if;

  insert into public.cost_intake (source, message_id, raw_doc_path, from_email, subject)
    values (p_source, p_message_id, nullif(trim(coalesce(p_raw_doc_path, '')), ''),
            lower(coalesce(p_from_email, '')), coalesce(p_subject, ''))
    on conflict (message_id) do nothing;
  if found then
    select id into v_id from public.cost_intake where message_id = p_message_id;
    return 'new:' || v_id;
  end if;

  select id, extract_status into v_id, v_extract
    from public.cost_intake where message_id = p_message_id;
  return case when v_extract = 'pending' then 'retry:' || v_id
              else 'done:' || v_id end;
end $$;

revoke execute on function public.cost_intake_insert(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cost_intake_insert(text, text, text, text, text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 8. Extraction lands + the duplicate guard (one guard, every door)
--
-- Guard rules (§2.1): (a) same vendor + invoice number, or (b) same total +
-- same invoice date + same sender domain within the Settings window → status
-- 'duplicate', duplicate_of set, and NO cost row is ever written from it
-- unless a person explicitly confirms.
-- ----------------------------------------------------------------------------

create or replace function public.cost_intake_set_extraction(
  p_id uuid, p_extract_status text, p_extracted jsonb,
  p_model text, p_prompt_version text,
  p_input_tokens integer, p_output_tokens integer, p_cost_cents integer,
  p_proposed_wo uuid, p_proposed_vendor uuid, p_match_reason text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v public.cost_intake%rowtype;
  v_dup uuid;
  v_invoice_no text; v_supplier text; v_total bigint; v_date date; v_domain text;
  v_window numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'cost_intake_service_only';
  end if;
  select * into v from public.cost_intake where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  -- Never touch a decided row (confirm/reject wins over a late re-delivery).
  if v.confirmed_at is not null then return 'error:already_decided'; end if;
  if p_extract_status not in ('extracted', 'failed') then return 'error:bad_status'; end if;
  if p_match_reason is not null
     and p_match_reason not in ('order_ref', 'address', 'vendor_memory', 'none') then
    return 'error:bad_match_reason';
  end if;

  update public.cost_intake
     set extracted          = coalesce(p_extracted, '{}'::jsonb),
         extract_status     = p_extract_status,
         model              = p_model,
         prompt_version     = p_prompt_version,
         input_tokens       = p_input_tokens,
         output_tokens      = p_output_tokens,
         cost_cents         = p_cost_cents,
         proposed_wo_id     = p_proposed_wo,
         proposed_vendor_id = p_proposed_vendor,
         match_reason       = coalesce(p_match_reason, 'none')
   where id = p_id;

  if p_extract_status = 'failed' then return 'ok:failed'; end if;

  v_invoice_no := nullif(trim(coalesce(p_extracted ->> 'invoice_no', '')), '');
  v_supplier   := lower(nullif(trim(coalesce(p_extracted ->> 'supplier', '')), ''));
  v_total      := nullif(p_extracted ->> 'total_cents', '')::bigint;
  v_date       := nullif(p_extracted ->> 'invoice_date', '')::date;
  v_domain     := lower(split_part(v.from_email, '@', 2));
  v_window     := public.cost_setting_num('{duplicateWindowDays}', 7);

  -- (a) same vendor + invoice number, across every door
  if v_invoice_no is not null then
    select ci.id into v_dup from public.cost_intake ci
     where ci.id <> p_id
       and ci.status <> 'rejected'
       and lower(coalesce(ci.extracted ->> 'invoice_no', '')) = lower(v_invoice_no)
       and ((p_proposed_vendor is not null and ci.proposed_vendor_id = p_proposed_vendor)
            or (p_proposed_vendor is not null and ci.confirmed_vendor_id = p_proposed_vendor)
            or (v_supplier is not null
                and lower(coalesce(ci.extracted ->> 'supplier', '')) = v_supplier))
     order by ci.created_at
     limit 1;
  end if;

  -- (b) same total + same invoice date + same sender domain, within the window
  if v_dup is null and v_total is not null and v_date is not null and v_domain <> '' then
    select ci.id into v_dup from public.cost_intake ci
     where ci.id <> p_id
       and ci.status <> 'rejected'
       and nullif(ci.extracted ->> 'total_cents', '')::bigint = v_total
       and nullif(ci.extracted ->> 'invoice_date', '')::date = v_date
       and lower(split_part(ci.from_email, '@', 2)) = v_domain
       and ci.created_at > now() - make_interval(days => v_window::int)
     order by ci.created_at
     limit 1;
  end if;

  if v_dup is not null then
    update public.cost_intake
       set status = 'duplicate', duplicate_of = v_dup
     where id = p_id;
    return 'ok:duplicate';
  end if;

  return 'ok:pending';
end $$;

revoke execute on function public.cost_intake_set_extraction(
  uuid, text, jsonb, text, text, integer, integer, integer, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cost_intake_set_extraction(
  uuid, text, jsonb, text, text, integer, integer, integer, uuid, uuid, text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 9. Confirm — the ONLY way a queue document becomes a cost row.
--    Writes the destination with the document attached, learns vendor memory,
--    and keeps proposed-vs-confirmed for the accuracy readout.
-- ----------------------------------------------------------------------------

create or replace function public.cost_intake_confirm(
  p_id uuid, p_destination text, p_wo uuid,
  p_vendor uuid, p_vendor_name text, p_category public.job_cost_category,
  p_description text, p_amount_ex_cents integer, p_gst_cents integer,
  p_invoice_no text, p_invoice_date date,
  p_estimate_line_ref text, p_paid_with text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v public.cost_intake%rowtype;
  v_vendor uuid; v_vendor_name text; v_domain text; v_dest uuid;
  v_total bigint;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.cost_intake where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  -- A flagged duplicate may still be confirmed — that is a human decision,
  -- logged as such; only an already-decided row refuses.
  if v.confirmed_at is not null or v.status in ('confirmed', 'rejected') then
    return 'error:already_decided';
  end if;
  if p_destination not in ('job_cost', 'material_cost') then return 'error:bad_destination'; end if;
  -- No cost row exists without a source document attached (accept criterion).
  if coalesce(trim(v.raw_doc_path), '') = '' then return 'error:no_document'; end if;
  if coalesce(p_amount_ex_cents, 0) < 0 or coalesce(p_gst_cents, 0) < 0 then
    return 'error:bad_amount';
  end if;
  v_total := coalesce(p_amount_ex_cents, 0)::bigint + coalesce(p_gst_cents, 0)::bigint;
  if v_total <= 0 or v_total > 100000000 then return 'error:bad_amount'; end if;
  if p_paid_with is not null and p_paid_with not in ('company_card', 'personal', 'account') then
    return 'error:bad_paid_with';
  end if;

  -- Vendor: use the given one, or create from the name.
  v_vendor := p_vendor;
  if v_vendor is null and coalesce(trim(p_vendor_name), '') <> '' then
    select id into v_vendor from public.vendors
     where lower(name) = lower(trim(p_vendor_name)) limit 1;
    if v_vendor is null then
      insert into public.vendors (name, default_category)
        values (trim(p_vendor_name), coalesce(p_category, 'other'))
        returning id into v_vendor;
    end if;
  end if;

  -- Vendor memory learns: sender domain + default category (§2.1b).
  v_domain := lower(split_part(v.from_email, '@', 2));
  if v_vendor is not null then
    update public.vendors
       set sender_domains = case
             when v_domain <> '' and not (v_domain = any (sender_domains))
             then sender_domains || v_domain else sender_domains end,
           default_category = coalesce(p_category, default_category)
     where id = v_vendor;
  end if;

  if p_destination = 'job_cost' then
    if p_wo is null then return 'error:no_job'; end if;
    insert into public.job_costs
      (work_order_id, vendor_id, category, description,
       amount_ex_cents, gst_cents, doc_path, estimate_line_ref,
       status, recorded_by, paid_with, intake_id, invoice_no, invoice_date)
    values
      (p_wo, v_vendor, coalesce(p_category, 'other'), coalesce(trim(p_description), ''),
       coalesce(p_amount_ex_cents, 0), coalesce(p_gst_cents, 0), v.raw_doc_path,
       nullif(trim(coalesce(p_estimate_line_ref, '')), ''),
       'recorded', auth.uid(), coalesce(p_paid_with, 'account'),
       p_id, coalesce(trim(p_invoice_no), ''), p_invoice_date)
    returning id into v_dest;
  else
    -- material_cost: p_wo may be null — that IS the unmatched queue.
    insert into public.material_costs
      (work_order_id, supplier, order_ref, address_text, amount_cents,
       invoice_date, source, matched_by, matched_at, intake_id)
    values
      (p_wo,
       coalesce(nullif(trim(coalesce(p_vendor_name, '')), ''),
                v.extracted ->> 'supplier', ''),
       coalesce(v.extracted ->> 'order_ref', ''),
       coalesce(v.extracted ->> 'address_text', ''),
       v_total::integer, coalesce(p_invoice_date,
                                  nullif(v.extracted ->> 'invoice_date', '')::date),
       case when v.source in ('airtable', 'email') then v.source else 'manual' end,
       case when p_wo is null then null else 'manual' end,
       case when p_wo is null then null else now() end,
       p_id)
    returning id into v_dest;
  end if;

  update public.cost_intake
     set status = 'confirmed',
         confirmed_wo_id = p_wo,
         confirmed_vendor_id = v_vendor,
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         resulting_type = p_destination,
         resulting_id = v_dest
   where id = p_id;

  return 'ok:' || v_dest;
end $$;

grant execute on function public.cost_intake_confirm(
  uuid, text, uuid, uuid, text, public.job_cost_category,
  text, integer, integer, text, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Reject / dismiss — a duplicate stays labelled duplicate; anything else
--     becomes rejected. Either way the card leaves the queue, decided + logged.
-- ----------------------------------------------------------------------------

create or replace function public.cost_intake_reject(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.cost_intake%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.cost_intake where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  if v.confirmed_at is not null or v.status in ('confirmed', 'rejected') then
    return 'error:already_decided';
  end if;
  update public.cost_intake
     set status = case when v.status = 'duplicate' then 'duplicate' else 'rejected' end,
         confirmed_by = auth.uid(),
         confirmed_at = now()
   where id = p_id;
  return 'ok:' || p_id;
end $$;

grant execute on function public.cost_intake_reject(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Manual door — staff records a vendor cost directly (§6.4). Same
--     pipeline: a confirmed intake row is written alongside, so provenance
--     and the duplicate guard see every door. Document required.
-- ----------------------------------------------------------------------------

create or replace function public.job_cost_record(
  p_wo uuid, p_vendor uuid, p_vendor_name text, p_category public.job_cost_category,
  p_description text, p_amount_ex_cents integer, p_gst_cents integer,
  p_doc_path text, p_estimate_line_ref text, p_paid_with text,
  p_invoice_no text, p_invoice_date date
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid; v_intake uuid; v_dest uuid; v_total bigint;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_wo is null then return 'error:no_job'; end if;
  -- No cost row without a source document; manual docs ride the staff prefix.
  if coalesce(trim(p_doc_path), '') = '' or p_doc_path not like 'receipts/%' then
    return 'error:no_document';
  end if;
  if coalesce(p_amount_ex_cents, 0) < 0 or coalesce(p_gst_cents, 0) < 0 then
    return 'error:bad_amount';
  end if;
  v_total := coalesce(p_amount_ex_cents, 0)::bigint + coalesce(p_gst_cents, 0)::bigint;
  if v_total <= 0 or v_total > 100000000 then return 'error:bad_amount'; end if;
  if p_paid_with is not null and p_paid_with not in ('company_card', 'personal', 'account') then
    return 'error:bad_paid_with';
  end if;

  v_vendor := p_vendor;
  if v_vendor is null and coalesce(trim(p_vendor_name), '') <> '' then
    select id into v_vendor from public.vendors
     where lower(name) = lower(trim(p_vendor_name)) limit 1;
    if v_vendor is null then
      insert into public.vendors (name, default_category)
        values (trim(p_vendor_name), coalesce(p_category, 'other'))
        returning id into v_vendor;
    end if;
  end if;

  -- The duplicate guard, manual flavour: refuse loudly instead of flagging.
  if coalesce(trim(p_invoice_no), '') <> '' and v_vendor is not null
     and exists (select 1 from public.job_costs jc
                  where jc.vendor_id = v_vendor
                    and lower(jc.invoice_no) = lower(trim(p_invoice_no))) then
    return 'error:duplicate';
  end if;

  insert into public.cost_intake
    (source, raw_doc_path, extracted, extract_status, status,
     confirmed_wo_id, confirmed_vendor_id, confirmed_by, confirmed_at)
  values
    ('manual', trim(p_doc_path),
     jsonb_build_object('supplier', coalesce(trim(p_vendor_name), ''),
                        'invoice_no', coalesce(trim(p_invoice_no), ''),
                        'invoice_date', p_invoice_date,
                        'total_cents', v_total),
     'extracted', 'confirmed', p_wo, v_vendor, auth.uid(), now())
  returning id into v_intake;

  insert into public.job_costs
    (work_order_id, vendor_id, category, description,
     amount_ex_cents, gst_cents, doc_path, estimate_line_ref,
     status, recorded_by, paid_with, intake_id, invoice_no, invoice_date)
  values
    (p_wo, v_vendor, coalesce(p_category, 'other'), coalesce(trim(p_description), ''),
     coalesce(p_amount_ex_cents, 0), coalesce(p_gst_cents, 0), trim(p_doc_path),
     nullif(trim(coalesce(p_estimate_line_ref, '')), ''),
     'recorded', auth.uid(), coalesce(p_paid_with, 'account'),
     v_intake, coalesce(trim(p_invoice_no), ''), p_invoice_date)
  returning id into v_dest;

  update public.cost_intake
     set resulting_type = 'job_cost', resulting_id = v_dest where id = v_intake;

  return 'ok:' || v_dest;
end $$;

grant execute on function public.job_cost_record(
  uuid, uuid, text, public.job_cost_category, text, integer, integer,
  text, text, text, text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. The recorded → approved → paid march (job costs)
-- ----------------------------------------------------------------------------

create or replace function public.job_cost_approve(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.job_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.job_costs where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  if v.status <> 'recorded' then return 'error:bad_state'; end if;
  update public.job_costs
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_id;
  return 'ok:' || p_id;
end $$;

grant execute on function public.job_cost_approve(uuid) to authenticated;

create or replace function public.job_cost_mark_paid(p_id uuid, p_paid_on date)
returns text language plpgsql security definer set search_path = public as $$
declare v public.job_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.job_costs where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  if v.status <> 'approved' then return 'error:bad_state'; end if;
  update public.job_costs
     set status = 'paid',
         paid_at = coalesce(p_paid_on::timestamptz, now())
   where id = p_id;
  return 'ok:' || p_id;
end $$;

grant execute on function public.job_cost_mark_paid(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. Materials unmatched queue — one-tap assign
-- ----------------------------------------------------------------------------

create or replace function public.material_cost_assign(p_id uuid, p_wo uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.material_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_wo is null then return 'error:no_job'; end if;
  select * into v from public.material_costs where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  if v.work_order_id is not null then return 'error:already_matched'; end if;
  update public.material_costs
     set work_order_id = p_wo, matched_by = 'manual', matched_at = now()
   where id = p_id;
  return 'ok:' || p_id;
end $$;

grant execute on function public.material_cost_assign(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 14. The Airtable transition door (⚑A2) — writes THROUGH the pipeline:
--     an intake row for provenance + the cross-door duplicate guard, then the
--     material_costs upsert (idempotent by airtable_record_id). This door is
--     the safety net that behaves like today's sync — it auto-confirms, but a
--     cross-door duplicate parks as a flag instead of a second cost row.
-- ----------------------------------------------------------------------------

create or replace function public.material_cost_sync_airtable(
  p_record_id text, p_supplier text, p_brand text, p_order_ref text,
  p_address text, p_amount_cents integer, p_invoice_date date,
  p_raw_doc_path text, p_proposed_wo uuid, p_match_reason text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_msg text; v_intake uuid; v_dest uuid; v_dup uuid; v_window numeric;
  v_supplier text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'cost_intake_service_only';
  end if;
  if coalesce(trim(p_record_id), '') = '' then return 'error:no_record_id'; end if;
  if coalesce(p_amount_cents, 0) <= 0 or p_amount_cents > 100000000 then
    return 'error:bad_amount';
  end if;
  if p_match_reason is not null
     and p_match_reason not in ('order_ref', 'address', 'vendor_memory', 'none') then
    return 'error:bad_match_reason';
  end if;

  -- Idempotent by record id, both layers.
  select id into v_dest from public.material_costs
   where airtable_record_id = trim(p_record_id);
  if v_dest is not null then return 'ok:already'; end if;

  v_msg := 'airtable:' || trim(p_record_id);
  v_supplier := lower(trim(coalesce(p_supplier, '')));
  v_window := public.cost_setting_num('{duplicateWindowDays}', 7);

  insert into public.cost_intake (source, message_id, raw_doc_path, extracted, extract_status)
    values ('airtable', v_msg, nullif(trim(coalesce(p_raw_doc_path, '')), ''),
            jsonb_build_object('supplier', coalesce(trim(p_supplier), ''),
                               'order_ref', coalesce(trim(p_order_ref), ''),
                               'address_text', coalesce(trim(p_address), ''),
                               'total_cents', p_amount_cents,
                               'invoice_date', p_invoice_date),
            'extracted')
    on conflict (message_id) do nothing;
  select id into v_intake from public.cost_intake where message_id = v_msg;
  -- A replayed record whose material row was flagged duplicate: stay a no-op.
  if not found then return 'error:not_found'; end if;
  if exists (select 1 from public.cost_intake
              where id = v_intake and (confirmed_at is not null or status = 'duplicate')) then
    return 'ok:already';
  end if;

  -- Cross-door duplicate guard: same supplier + total + invoice date already
  -- seen through another door within the window → flag, write no cost row.
  if v_supplier <> '' and p_invoice_date is not null then
    select ci.id into v_dup from public.cost_intake ci
     where ci.id <> v_intake
       and ci.status <> 'rejected'
       and lower(coalesce(ci.extracted ->> 'supplier', '')) = v_supplier
       and nullif(ci.extracted ->> 'total_cents', '')::bigint = p_amount_cents::bigint
       and nullif(ci.extracted ->> 'invoice_date', '')::date = p_invoice_date
       and ci.created_at > now() - make_interval(days => v_window::int)
     order by ci.created_at
     limit 1;
  end if;
  if v_dup is not null then
    update public.cost_intake
       set status = 'duplicate', duplicate_of = v_dup,
           proposed_wo_id = p_proposed_wo,
           match_reason = coalesce(p_match_reason, 'none')
     where id = v_intake;
    return 'ok:duplicate';
  end if;

  insert into public.material_costs
    (work_order_id, supplier, brand, order_ref, address_text, amount_cents,
     invoice_date, source, airtable_record_id, matched_by, matched_at, intake_id)
  values
    (p_proposed_wo, coalesce(trim(p_supplier), ''), coalesce(trim(p_brand), ''),
     coalesce(trim(p_order_ref), ''), coalesce(trim(p_address), ''),
     p_amount_cents, p_invoice_date, 'airtable', trim(p_record_id),
     case when p_proposed_wo is null then null else 'auto' end,
     case when p_proposed_wo is null then null else now() end,
     v_intake)
  returning id into v_dest;

  update public.cost_intake
     set status = 'confirmed',
         proposed_wo_id = p_proposed_wo,
         confirmed_wo_id = p_proposed_wo,
         match_reason = coalesce(p_match_reason, 'none'),
         confirmed_at = now(),
         resulting_type = 'material_cost',
         resulting_id = v_dest
   where id = v_intake;

  return 'ok:' || v_dest;
end $$;

revoke execute on function public.material_cost_sync_airtable(
  text, text, text, text, text, integer, date, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.material_cost_sync_airtable(
  text, text, text, text, text, integer, date, text, uuid, text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 15. Read-backs — what this migration just made (house law: read, not assume)
-- ----------------------------------------------------------------------------

-- Expect: 0 (every work order has a job number)
select count(*) as job_no_missing_backfill from public.work_orders where job_no is null;

-- Expect: cost_intake with rowsecurity true
select relname, relrowsecurity from pg_class
 where relname = 'cost_intake' and relnamespace = 'public'::regnamespace;

-- Expect: 9 functions, all security definer
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('cost_intake_insert', 'cost_intake_set_extraction',
                     'cost_intake_confirm', 'cost_intake_reject',
                     'job_cost_record', 'job_cost_approve',
                     'job_cost_mark_paid', 'material_cost_assign',
                     'material_cost_sync_airtable')
 order by p.proname;

-- Expect: the private bucket with its mime list
select id, public, file_size_limit from storage.buckets where id = 'cost-docs';

-- Expect: 3 policies on storage.objects for cost-docs
select polname from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'cost_docs%'
 order by polname;

-- Expect: the settings row with autoConfirmExactRef false
select key, value ->> 'autoConfirmExactRef' as auto_confirm,
       value ->> 'duplicateWindowDays' as window_days
  from public.settings where key = 'cost_intake';
