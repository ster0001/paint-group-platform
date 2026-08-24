-- =============================================================================
-- Contractor payment claims (Tom, 24 Aug follow-up #2).
--
-- Contractors can now invoice AT ANY TIME — a percent of their adjusted job
-- pay or a fixed figure — not only the platform-drafted final at sign-off.
-- The rules that keep the money honest:
--
-- * ONE bound, everywhere: a claim can never take total non-draft invoicing
--   past the adjusted pay (offer + accepted additions − deductions). The
--   sign-off FINAL now drafts only the REMAINDER after claims, and shows
--   "less previously invoiced" on its face (new previously_invoiced_cents).
-- * Claims are born SUBMITTED (the contractor's act IS the submission), with
--   the same validation as the one-tap submit: entity fields, 11-digit ABN,
--   bank on file, and no credit still waiting on the PC's deduction figure.
-- * Every submitted invoice gets a PDF under the CONTRACTOR'S own details
--   (invoice TO Paint Group) — invoice_pdf_path, attach-once, same
--   discipline as customer invoices.
-- =============================================================================

alter table public.contractor_invoices
  add column if not exists invoice_pdf_path text,
  add column if not exists claim_pct numeric,
  add column if not exists previously_invoiced_cents integer not null default 0;

-- Attach-once for the contractor's own invoice PDF.
create or replace function public.contractor_invoice_attach_pdf(p_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.invoice_pdf_path is not null then return 'ok:already'; end if;
  update public.contractor_invoices set invoice_pdf_path = p_path where id = p_id;
  return 'ok:attached';
end $$;
grant execute on function public.contractor_invoice_attach_pdf(uuid, text) to authenticated, service_role;

-- Σ of everything already invoiced on a job (anything past draft).
create or replace function public.contractor_invoice_invoiced_cents(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(total_inc_cents), 0)::integer
    from public.contractor_invoices
   where work_order_id = p_work_order_id and status <> 'draft'
$$;
revoke execute on function public.contractor_invoice_invoiced_cents(uuid) from public, anon, authenticated;

-- ---- the contractor's claim -------------------------------------------------

create or replace function public.contractor_invoice_request(
  p_work_order_id uuid, p_mode text, p_value numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype; v_cid uuid;
        v_a record; v_prev integer; v_remaining integer; v_amount integer;
        v_gst integer; v_terms integer; v_id uuid;
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

  -- ⚑10: a pending manual deduction makes the adjusted pay uncertain — no
  -- claims until the PC has set the figure.
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
    v_amount := round(p_value * 100)::integer;  -- dollars in, cents stored
    if v_amount > v_remaining then return 'error:exceeds_remaining'; end if;
  else
    return 'error:bad_mode';
  end if;
  if v_amount <= 0 then return 'error:bad_amount'; end if;

  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_amount::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);

  -- Born submitted: the contractor's act IS the submission. INSERTs are not
  -- state transitions; the guard trigger still freezes it from here on.
  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents, claim_pct,
       subtotal_ex_cents, gst_cents, total_inc_cents,
       status, submitted_at, number, due_on, rcti,
       gst_registered_at_submit, entity_snapshot)
    values
      (p_work_order_id, v_cid, 'claim',
       0, 0, '[]'::jsonb,
       v_prev, case when p_mode = 'percent' then p_value end,
       v_amount - v_gst, v_gst, v_amount,
       'submitted', now(), public.ci_allocate_number(),
       (now() at time zone 'Australia/Melbourne')::date + v_terms,
       v_c.rcti_agreement_signed_at is not null,
       v_c.gst_registered,
       jsonb_build_object(
         'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
         'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', v_id, 'claim', true));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.contractor_invoice_request(uuid, text, numeric) to authenticated;

-- ---- the sign-off FINAL drafts only the remainder ---------------------------
-- BODY BASIS 20261119. Changes: subtract previously invoiced (claims), skip
-- when nothing remains, store previously_invoiced_cents.

create or replace function public.contractor_invoice_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_total integer; v_gst integer;
        v_terms integer; v_signed date; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'skip:no_contractor'; end if;
  select * into v_c from public.contractors where id = v_wo.contractor_id;

  -- A standing submitted+ FINAL means the remainder is already claimed.
  if exists (select 1 from public.contractor_invoices
              where work_order_id = p_work_order_id
                and auto_draft_source = 'signoff' and status <> 'draft') then
    return 'skip:already_submitted';
  end if;
  delete from public.contractor_invoices
   where work_order_id = p_work_order_id and status = 'draft';

  select * into v_a from public.contractor_invoice_amounts(p_work_order_id);
  v_prev := public.contractor_invoice_invoiced_cents(p_work_order_id);
  v_total := v_a.total_inc_cents - v_prev;
  if v_total <= 0 then return 'skip:nothing_remaining'; end if;

  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_total::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms  := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed
    from public.wo_signoff s where s.work_order_id = p_work_order_id;

  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents,
       subtotal_ex_cents, gst_cents, total_inc_cents,
       status, due_on, rcti)
    values
      (p_work_order_id, v_wo.contractor_id, 'signoff',
       v_a.offer_cents, v_a.additions_cents, v_a.deduction_lines,
       v_prev,
       v_total - v_gst, v_gst, v_total,
       'draft',
       coalesce(v_signed, (now() at time zone 'Australia/Melbourne')::date) + v_terms,
       v_c.rcti_agreement_signed_at is not null)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_drafted', 'system',
            jsonb_build_object('contractor_invoice_id', v_id));

  return 'ok:' || v_id::text;
end $$;
revoke execute on function public.contractor_invoice_draft(uuid) from public, anon, authenticated;
grant execute on function public.contractor_invoice_draft(uuid) to service_role;

-- ---- submit recomputes with the same remainder rule -------------------------
-- BODY BASIS 20261119. Changes: subtract previously invoiced, refuse when
-- nothing remains, store previously_invoiced_cents.

create or replace function public.contractor_invoice_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_cid uuid; v_a record; v_prev integer; v_total integer; v_gst integer;
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
  v_prev := public.contractor_invoice_invoiced_cents(v_ci.work_order_id);
  v_total := v_a.total_inc_cents - v_prev;
  if v_total <= 0 then return 'error:nothing_remaining'; end if;
  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_total::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;

  update public.contractor_invoices
     set status = 'submitted', submitted_at = now(),
         number = coalesce(number, public.ci_allocate_number()),
         offer_cents = v_a.offer_cents,
         variation_delta_cents = v_a.additions_cents,
         deduction_lines = v_a.deduction_lines,
         previously_invoiced_cents = v_prev,
         total_inc_cents = v_total,
         gst_cents = v_gst,
         subtotal_ex_cents = v_total - v_gst,
         gst_registered_at_submit = v_c.gst_registered,
         entity_snapshot = jsonb_build_object(
           'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
           'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
   where id = p_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:submitted';
end $$;
grant execute on function public.contractor_invoice_submit(uuid) to authenticated;

-- ---- RCTI approve-from-draft recomputes the same way ------------------------
-- BODY BASIS 20261119. Change: the remainder rule in the RCTI branch.

create or replace function public.contractor_invoice_approve(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_total integer; v_gst integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  if v_ci.status = 'draft' then
    if not v_ci.rcti then return 'error:not_submitted'; end if;
    select * into v_c from public.contractors where id = v_ci.contractor_id;
    select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
    v_prev := public.contractor_invoice_invoiced_cents(v_ci.work_order_id);
    v_total := v_a.total_inc_cents - v_prev;
    if v_total <= 0 then return 'error:nothing_remaining'; end if;
    v_gst := case when v_c.gst_registered
                  then public.gst_from_inc_cents(v_total::bigint,
                         public.invoice_setting_num('{gstRatePct}', 10))::integer
                  else 0 end;
    update public.contractor_invoices
       set status = 'submitted', submitted_at = now(),
           number = coalesce(number, public.ci_allocate_number()),
           offer_cents = v_a.offer_cents,
           variation_delta_cents = v_a.additions_cents,
           deduction_lines = v_a.deduction_lines,
           previously_invoiced_cents = v_prev,
           total_inc_cents = v_total,
           gst_cents = v_gst,
           subtotal_ex_cents = v_total - v_gst,
           gst_registered_at_submit = v_c.gst_registered,
           entity_snapshot = jsonb_build_object(
             'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
             'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
     where id = p_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'staff',
              jsonb_build_object('contractor_invoice_id', p_id, 'rcti', true));
  elsif v_ci.status <> 'submitted' then
    return 'error:already_' || v_ci.status::text;
  end if;

  update public.contractor_invoices
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_approved', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:approved';
end $$;
grant execute on function public.contractor_invoice_approve(uuid) to authenticated;

-- ---- Verification (read this back after running) ----------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'contractor_invoices'
      and column_name in ('invoice_pdf_path','claim_pct','previously_invoiced_cents')) as ci_cols_3,
  (select count(*) from pg_proc where proname in
    ('contractor_invoice_request','contractor_invoice_attach_pdf',
     'contractor_invoice_invoiced_cents')) as new_fns_3,
  (select prosrc like '%nothing_remaining%' from pg_proc
    where proname = 'contractor_invoice_draft' limit 1) as final_drafts_remainder,
  (select prosrc like '%previously_invoiced_cents%' from pg_proc
    where proname = 'contractor_invoice_submit' limit 1) as submit_remainder,
  (select has_function_privilege('authenticated',
     'public.contractor_invoice_request(uuid, text, numeric)', 'execute')) as contractor_may_claim;
