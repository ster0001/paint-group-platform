-- ============================================================================
-- Contractor expenses + staff reimbursements (Tom, 25 Aug: build 6c now,
-- snap-receipt camera later). Brief: claude-code-brief-cost-capture.md §6.
--
-- · Claims need a RECEIPT — no photo, no claim, enforced here.
-- · Over the Settings threshold ($100 default) the app wants ASK-FIRST: an
--   approved pre-approval whose cap covers the amount. Reality on site beats
--   rules — an unapproved over-threshold claim still submits, flagged amber.
-- · Approved expenses ride the contractor's NEXT invoice as clearly-labelled
--   at-cost reimbursement lines (⚑A4: GST itemised at cost, accountant to
--   confirm before the first payment run) — one payment run, no second rail.
-- · Staff "my own money" job costs record WHO to reimburse (auth.uid()).
--
-- Idempotent; safe to re-run. Ends with read-backs (house law).
-- ============================================================================

-- ---- 1. tables --------------------------------------------------------------

create table if not exists public.expense_preapprovals (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete restrict,
  contractor_id uuid not null references public.contractors (id) on delete restrict,
  description   text not null,
  est_cents     integer not null check (est_cents > 0),
  cap_cents     integer check (cap_cents > 0),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'declined')),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.contractor_expenses (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete restrict,
  contractor_id  uuid not null references public.contractors (id) on delete restrict,
  category       text not null,
  amount_cents   integer not null check (amount_cents > 0),
  gst_cents      integer not null default 0 check (gst_cents >= 0),
  receipt_path   text not null,             -- no photo, no claim
  note           text not null default '',
  preapproval_id uuid references public.expense_preapprovals (id) on delete set null,
  over_threshold_unapproved boolean not null default false,  -- the amber flag
  status         text not null default 'submitted'
                 check (status in ('submitted', 'approved', 'rejected', 'paid')),
  invoice_id     uuid references public.contractor_invoices (id) on delete set null,
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists contractor_expenses_wo_idx
  on public.contractor_expenses (work_order_id, status);
create index if not exists contractor_expenses_contractor_idx
  on public.contractor_expenses (contractor_id, created_at desc);

-- Reimbursement lines ride the invoice; kept separate from the contractor's
-- own composed lines so both render distinctly.
alter table public.contractor_invoices
  add column if not exists reimbursement_lines jsonb not null default '[]'::jsonb,
  add column if not exists reimbursement_cents integer not null default 0;

-- ---- 2. RLS -----------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['contractor_expenses', 'expense_preapprovals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (public.is_staff())$f$,
      t || '_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (contractor_id = public.current_contractor_id())$f$,
      t || '_own', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- Receipts: CONTRACTORS upload too now — the write/delete policies drop the
-- staff-only gate; the own-uid prefix is the ownership check either way.
drop policy if exists cost_docs_objects_write on storage.objects;
create policy cost_docs_objects_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cost-docs'
              and name like 'receipts/' || auth.uid()::text || '/%');
drop policy if exists cost_docs_objects_delete on storage.objects;
create policy cost_docs_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'cost-docs'
         and name like 'receipts/' || auth.uid()::text || '/%');
-- Contractors read their own receipts back (staff read policy already exists).
drop policy if exists cost_docs_objects_read_own on storage.objects;
create policy cost_docs_objects_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'cost-docs'
         and name like 'receipts/' || auth.uid()::text || '/%');

-- ---- 3. ask-first ----------------------------------------------------------

create or replace function public.expense_preapproval_request(
  p_work_order_id uuid, p_description text, p_est_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_id uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if not exists (select 1 from public.work_orders
                  where id = p_work_order_id and contractor_id = v_cid) then
    return 'error:not_yours';
  end if;
  if coalesce(trim(p_description), '') = '' then return 'error:no_description'; end if;
  if p_est_cents is null or p_est_cents <= 0 or p_est_cents > 100000000 then
    return 'error:bad_amount';
  end if;
  insert into public.expense_preapprovals (work_order_id, contractor_id, description, est_cents)
    values (p_work_order_id, v_cid, trim(p_description), p_est_cents)
    returning id into v_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'expense_preapproval_requested', auth.uid(), 'contractor',
            jsonb_build_object('preapproval_id', v_id, 'est_cents', p_est_cents));
  return 'ok:' || v_id;
end $$;
grant execute on function public.expense_preapproval_request(uuid, text, integer) to authenticated;

create or replace function public.expense_preapproval_decide(
  p_id uuid, p_approve boolean, p_cap_cents integer default null
) returns text language plpgsql security definer set search_path = public as $$
declare v public.expense_preapprovals%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.expense_preapprovals where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'requested' then return 'error:already_decided'; end if;
  update public.expense_preapprovals
     set status = case when p_approve then 'approved' else 'declined' end,
         cap_cents = case when p_approve then coalesce(p_cap_cents, v.est_cents) end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'expense_preapproval_decided', auth.uid(), 'staff',
            jsonb_build_object('preapproval_id', p_id, 'approved', p_approve,
                               'cap_cents', coalesce(p_cap_cents, v.est_cents)));
  return 'ok:' || p_id;
end $$;
grant execute on function public.expense_preapproval_decide(uuid, boolean, integer) to authenticated;

-- ---- 4. the claim ----------------------------------------------------------

create or replace function public.contractor_expense_submit(
  p_work_order_id uuid, p_category text, p_amount_cents integer,
  p_gst_cents integer, p_receipt_path text, p_note text default '',
  p_preapproval_id uuid default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_id uuid; v_threshold integer; v_flag boolean := false;
        v_cats jsonb; v_pre public.expense_preapprovals%rowtype;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if not exists (select 1 from public.work_orders
                  where id = p_work_order_id and contractor_id = v_cid) then
    return 'error:not_yours';
  end if;

  -- No photo, no claim — and only inside the caller's own receipts prefix.
  if coalesce(trim(p_receipt_path), '') = ''
     or p_receipt_path not like 'receipts/' || auth.uid()::text || '/%' then
    return 'error:no_receipt';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    return 'error:bad_amount';
  end if;
  if p_gst_cents is null or p_gst_cents < 0 or p_gst_cents >= p_amount_cents then
    return 'error:bad_amount';
  end if;

  -- Category comes from the Settings list (⚑A5), never free text.
  select value -> 'claimableCategories' into v_cats
    from public.settings where key = 'cost_intake';
  if v_cats is null or not (v_cats ? p_category) then return 'error:bad_category'; end if;

  -- Ask-first over the threshold: an approved pre-approval whose cap covers
  -- the amount clears it; without one the claim still submits, flagged amber.
  v_threshold := public.cost_setting_num('{expenseThresholdCents}', 10000)::integer;
  if p_amount_cents > v_threshold then
    if p_preapproval_id is not null then
      select * into v_pre from public.expense_preapprovals where id = p_preapproval_id;
      if not found or v_pre.contractor_id <> v_cid
         or v_pre.work_order_id <> p_work_order_id
         or v_pre.status <> 'approved'
         or p_amount_cents > coalesce(v_pre.cap_cents, 0) then
        v_flag := true;
      end if;
    else
      v_flag := true;
    end if;
  end if;

  insert into public.contractor_expenses
      (work_order_id, contractor_id, category, amount_cents, gst_cents,
       receipt_path, note, preapproval_id, over_threshold_unapproved)
    values
      (p_work_order_id, v_cid, p_category, p_amount_cents, coalesce(p_gst_cents, 0),
       trim(p_receipt_path), coalesce(trim(p_note), ''), p_preapproval_id, v_flag)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'expense_submitted', auth.uid(), 'contractor',
            jsonb_build_object('expense_id', v_id, 'amount_cents', p_amount_cents,
                               'category', p_category, 'over_threshold_unapproved', v_flag));
  return 'ok:' || v_id;
end $$;
grant execute on function public.contractor_expense_submit(uuid, text, integer, integer, text, text, uuid)
  to authenticated;

create or replace function public.contractor_expense_decide(p_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_expenses%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.contractor_expenses where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'submitted' then return 'error:already_decided'; end if;
  update public.contractor_expenses
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'expense_decided', auth.uid(), 'staff',
            jsonb_build_object('expense_id', p_id, 'approved', p_approve));
  return 'ok:' || p_id;
end $$;
grant execute on function public.contractor_expense_decide(uuid, boolean) to authenticated;

-- ---- 5. reimbursements ride the invoice ------------------------------------
-- The invoice guard (20261119) forbids touching money fields once status is
-- 'submitted' — so reimbursements must ride in the SAME write that creates or
-- submits the invoice. The sweep therefore only COLLECTS (and locks) the
-- approved, un-invoiced expenses; each caller folds the totals into its one
-- money write, then links the expense rows to the invoice id it now has.

drop function if exists public.contractor_expense_attach(uuid);

create or replace function public.contractor_expense_sweep(
  p_work_order_id uuid, p_contractor_id uuid,
  out r_lines jsonb, out r_cents integer, out r_gst integer, out r_ids uuid[]
) language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r_lines := '[]'::jsonb; r_cents := 0; r_gst := 0; r_ids := '{}';
  for r in select * from public.contractor_expenses
            where work_order_id = p_work_order_id
              and contractor_id = p_contractor_id
              and status = 'approved' and invoice_id is null
            order by created_at
            for update
  loop
    r_lines := r_lines || jsonb_build_object(
      'label', 'Reimbursement — ' || replace(r.category, '_', ' ') ||
               case when r.note <> '' then ': ' || r.note else '' end,
      'cents', r.amount_cents, 'gst_cents', r.gst_cents, 'expense_id', r.id);
    r_cents := r_cents + r.amount_cents;
    r_gst := r_gst + r.gst_cents;
    r_ids := r_ids || r.id;
  end loop;
end $$;
revoke execute on function public.contractor_expense_sweep(uuid, uuid) from public, anon, authenticated;

-- Reimbursements are at-cost pass-throughs, not payment against the agreed
-- job amount — the claimable remainder must not shrink by them.
create or replace function public.contractor_invoice_invoiced_cents(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(total_inc_cents - coalesce(reimbursement_cents, 0)), 0)::integer
    from public.contractor_invoices
   where work_order_id = p_work_order_id and status <> 'draft'
$$;

-- Hook into both submit paths (recreated with the sweep folded in).
-- contractor_invoice_request: identical to 20261126 + reimbursements.
create or replace function public.contractor_invoice_request(
  p_work_order_id uuid, p_mode text, p_value numeric,
  p_lines jsonb default null, p_invoice_date date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype; v_cid uuid;
        v_a record; v_prev integer; v_remaining integer; v_amount integer;
        v_gst integer; v_terms integer; v_id uuid; v_reimb record;
        v_line jsonb; v_sum bigint := 0; v_n integer := 0; v_today date;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  select * into v_c from public.contractors where id = v_cid;

  if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
  if coalesce(trim(v_c.address), '') = '' then return 'error:profile_incomplete:address'; end if;
  if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then
    return 'error:profile_incomplete:abn';
  end if;
  if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then
    return 'error:profile_incomplete:bank';
  end if;

  if exists (select 1 from public.wo_variations v
              where v.work_order_id = p_work_order_id
                and v.credit and v.needs_manual_deduction and v.deduction_cents is null
                and v.status in ('customer_approved', 'contractor_accepted')) then
    return 'error:deduction_pending';
  end if;

  select * into v_a from public.contractor_invoice_amounts(p_work_order_id);
  v_prev := public.contractor_invoice_invoiced_cents(p_work_order_id);
  v_remaining := v_a.total_inc_cents - v_prev;
  if v_remaining <= 0 then return 'error:nothing_remaining'; end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_amount := least(round(v_a.total_inc_cents * p_value / 100.0)::integer, v_remaining);
  elsif p_mode = 'fixed' then
    if p_value is null or p_value <= 0 then return 'error:bad_amount'; end if;
    v_amount := round(p_value * 100)::integer;
    if v_amount > v_remaining then return 'error:exceeds_remaining'; end if;
  else
    return 'error:bad_mode';
  end if;
  if v_amount <= 0 then return 'error:bad_amount'; end if;

  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then return 'error:bad_lines'; end if;
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_n := v_n + 1;
      if v_n > 12 then return 'error:bad_lines'; end if;
      if coalesce(trim(v_line ->> 'label'), '') = '' or length(v_line ->> 'label') > 200 then
        return 'error:bad_lines';
      end if;
      if (v_line ->> 'cents') !~ '^[0-9]+$' or (v_line ->> 'cents')::bigint <= 0 then
        return 'error:bad_lines';
      end if;
      v_sum := v_sum + (v_line ->> 'cents')::bigint;
    end loop;
    if v_n = 0 then return 'error:bad_lines'; end if;
    if v_sum <> v_amount then return 'error:lines_mismatch'; end if;
  end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if p_invoice_date is not null and abs(p_invoice_date - v_today) > 31 then
    return 'error:bad_date';
  end if;

  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_amount::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);

  -- Approved expenses ride along as at-cost reimbursement lines (6c) —
  -- folded into the insert itself: the guard freezes money fields once born.
  select * into v_reimb from public.contractor_expense_sweep(p_work_order_id, v_cid);

  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents, claim_pct,
       subtotal_ex_cents, gst_cents, total_inc_cents,
       reimbursement_lines, reimbursement_cents,
       status, submitted_at, number, due_on, rcti,
       gst_registered_at_submit, entity_snapshot,
       lines, invoice_date)
    values
      (p_work_order_id, v_cid, 'claim',
       0, 0, '[]'::jsonb,
       v_prev, case when p_mode = 'percent' then p_value end,
       (v_amount + v_reimb.r_cents) - (v_gst + v_reimb.r_gst),
       v_gst + v_reimb.r_gst, v_amount + v_reimb.r_cents,
       v_reimb.r_lines, v_reimb.r_cents,
       'submitted', now(), public.ci_allocate_number(),
       coalesce(p_invoice_date, v_today) + v_terms,
       v_c.rcti_agreement_signed_at is not null,
       v_c.gst_registered,
       jsonb_build_object(
         'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
         'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4),
       coalesce(p_lines, '[]'::jsonb), coalesce(p_invoice_date, v_today))
    returning id into v_id;

  update public.contractor_expenses set invoice_id = v_id
   where id = any(v_reimb.r_ids);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', v_id, 'claim', true,
                               'lines', v_n, 'invoice_date', coalesce(p_invoice_date, v_today)));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.contractor_invoice_request(uuid, text, numeric, jsonb, date)
  to authenticated;

-- contractor_invoice_submit: 20261119's body + reimbursements folded into
-- the submit-time recompute (the ONE write the guard still allows).
create or replace function public.contractor_invoice_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_cid uuid; v_a record; v_gst integer; v_reimb record;
begin
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if v_cid is null or v_ci.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  if v_ci.status <> 'draft' then return 'error:already_' || v_ci.status::text; end if;

  select * into v_c from public.contractors where id = v_ci.contractor_id;
  if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
  if coalesce(trim(v_c.address), '') = '' then return 'error:profile_incomplete:address'; end if;
  if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then
    return 'error:profile_incomplete:abn';
  end if;
  if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then
    return 'error:profile_incomplete:bank';
  end if;

  if exists (select 1 from public.wo_variations v
              where v.work_order_id = v_ci.work_order_id
                and v.credit and v.needs_manual_deduction and v.deduction_cents is null
                and v.status in ('customer_approved', 'contractor_accepted')) then
    return 'error:deduction_pending';
  end if;

  select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_a.total_inc_cents::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;

  -- Approved expenses ride along as at-cost reimbursement lines (6c).
  select * into v_reimb from public.contractor_expense_sweep(v_ci.work_order_id, v_ci.contractor_id);

  update public.contractor_invoices
     set status = 'submitted', submitted_at = now(),
         number = coalesce(number, public.ci_allocate_number()),
         offer_cents = v_a.offer_cents,
         variation_delta_cents = v_a.additions_cents,
         deduction_lines = v_a.deduction_lines,
         total_inc_cents = v_a.total_inc_cents + v_reimb.r_cents,
         gst_cents = v_gst + v_reimb.r_gst,
         subtotal_ex_cents = (v_a.total_inc_cents + v_reimb.r_cents) - (v_gst + v_reimb.r_gst),
         reimbursement_lines = v_reimb.r_lines,
         reimbursement_cents = v_reimb.r_cents,
         gst_registered_at_submit = v_c.gst_registered,
         entity_snapshot = jsonb_build_object(
           'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
           'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
   where id = p_id;

  update public.contractor_expenses set invoice_id = p_id
   where id = any(v_reimb.r_ids);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:submitted';
end $$;
grant execute on function public.contractor_invoice_submit(uuid) to authenticated;

-- Paid invoice pays its expenses (and the remittance itemises them).
create or replace function public.contractor_invoice_mark_paid(
  p_id uuid, p_reference text default '', p_paid_on date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.status <> 'approved' then return 'error:not_approved'; end if;

  update public.contractor_invoices
     set status = 'paid',
         paid_at = coalesce(p_paid_on::timestamptz, now()),
         bank_reference = coalesce(trim(p_reference), ''),
         remittance_number = coalesce(remittance_number, public.remittance_allocate_number())
   where id = p_id;

  -- The expenses this invoice carried are now reimbursed.
  update public.contractor_expenses set status = 'paid'
   where invoice_id = p_id and status = 'approved';

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_paid', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:paid';
end $$;
grant execute on function public.contractor_invoice_mark_paid(uuid, text, date) to authenticated;

-- ---- 6. staff "my own money" records WHO to reimburse ----------------------
-- Same signature as 20261122 — only the reimburse_to line is new.

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
     status, recorded_by, paid_with, reimburse_to, intake_id, invoice_no, invoice_date)
  values
    (p_wo, v_vendor, coalesce(p_category, 'other'), coalesce(trim(p_description), ''),
     coalesce(p_amount_ex_cents, 0), coalesce(p_gst_cents, 0), trim(p_doc_path),
     nullif(trim(coalesce(p_estimate_line_ref, '')), ''),
     'recorded', auth.uid(), coalesce(p_paid_with, 'account'),
     -- "My own money" means MINE — the recorder is who gets reimbursed.
     case when p_paid_with = 'personal' then auth.uid() end,
     v_intake, coalesce(trim(p_invoice_no), ''), p_invoice_date)
  returning id into v_dest;

  update public.cost_intake
     set resulting_type = 'job_cost', resulting_id = v_dest where id = v_intake;

  return 'ok:' || v_dest;
end $$;

-- ---- read-backs -------------------------------------------------------------

-- Expect: both tables with rowsecurity true
select relname, relrowsecurity from pg_class
 where relname in ('contractor_expenses', 'expense_preapprovals')
   and relnamespace = 'public'::regnamespace order by relname;

-- Expect: 5 functions, all security definer (attach is GONE — replaced by sweep)
select p.proname, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('expense_preapproval_request', 'expense_preapproval_decide',
                     'contractor_expense_submit', 'contractor_expense_decide',
                     'contractor_expense_sweep', 'contractor_expense_attach')
 order by p.proname;

-- Expect: reimbursement columns present
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'contractor_invoices'
   and column_name in ('reimbursement_lines', 'reimbursement_cents') order by column_name;

-- Expect: 4 cost_docs policies incl. read_own (write/delete no longer staff-gated)
select polname from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'cost_docs%'
 order by polname;
