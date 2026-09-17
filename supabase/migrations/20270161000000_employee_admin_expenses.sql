-- =============================================================================
-- Employed painters — Session 5: expenses only, settings, the Employee tick box,
-- and the crew's walkthrough (brief §3.6, §3.7, §3.10; rulings 4, 5, 13, 15)
--
-- 1. Compliance for employees is a white card and working-at-heights
--    (ruling 5) — two more contractor_doc_kind values, reusing the document
--    card, expiry and verification flow. Neither is a gate on anything.
-- 2. The Employee tick box (ruling 15): set_employment_type() flips one row,
--    both ways, and REFUSES with a named reason while anything in flight
--    belongs to the other type (an open offer or booking, an unpaid invoice,
--    an unpaid reimbursement, an active assignment). Closed history never
--    blocks. Logged as a contractor_event. The invite form carries the same
--    tick, so there is no separate add-employee screen.
-- 3. Expenses (ruling 13): who paid — company card (a job cost, no payout) or
--    personal (the reimbursement queue on Payables, never an invoice line).
--    Any painter on the job may claim (the crew rule, 20270159), and the
--    office marks a personal-card claim reimbursed.
-- 4. The walkthrough: any assigned painter can start Mode A and draft the
--    report — the same one-line widening as 20270159, from live definitions.
-- =============================================================================

-- ---- 1. document kinds ---------------------------------------------------------
alter type public.contractor_doc_kind add value if not exists 'white_card';
alter type public.contractor_doc_kind add value if not exists 'working_at_heights';

-- ---- 2. the invite carries the type; the tick box RPC ---------------------------
alter table public.contractor_invites
  add column if not exists employment_type text not null default 'contractor';
alter table public.contractor_invites drop constraint if exists contractor_invites_employment_type_check;
alter table public.contractor_invites
  add constraint contractor_invites_employment_type_check check (employment_type in ('contractor', 'employee'));

drop function if exists public.create_contractor_invite(text, text, text, text, integer);
create or replace function public.create_contractor_invite(
  p_email text, p_name text default '', p_company text default '',
  p_tier text default null, p_days integer default 7, p_employment_type text default 'contractor'
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not public.is_staff() then raise exception 'not authorised'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email required'; end if;
  if coalesce(p_employment_type, 'contractor') not in ('contractor', 'employee') then raise exception 'bad employment type'; end if;

  -- Re-inviting the same person supersedes the old link rather than erroring.
  update public.contractor_invites
     set revoked_at = now()
   where lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.contractor_invites (email, name, company_name, tier, token, created_by, expires_at, employment_type)
  values (lower(trim(p_email)), coalesce(p_name, ''), coalesce(p_company, ''), p_tier,
          v_token, auth.uid(), now() + make_interval(days => greatest(1, coalesce(p_days, 7))),
          coalesce(p_employment_type, 'contractor'));

  return v_token;
end $$;
grant execute on function public.create_contractor_invite(text, text, text, text, integer, text) to authenticated;

-- 20260830 body verbatim + the employment type from the invite.
create or replace function public.redeem_contractor_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_invites%rowtype; v_uid uuid; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then return 'error:not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v from public.contractor_invites where token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v.revoked_at is not null then return 'error:revoked'; end if;
  if v.accepted_at is not null then return 'error:used'; end if;
  if v.expires_at < now() then return 'error:expired'; end if;

  -- The link is tied to the person it was sent to. Forwarding it doesn't work.
  if lower(v_email) <> lower(v.email) then return 'error:email_mismatch'; end if;

  update public.profiles
     set role = 'contractor', name = coalesce(nullif(v.name, ''), name)
   where id = v_uid;

  insert into public.contractors (profile_id, company_name, tier, active, employment_type)
  values (v_uid, coalesce(v.company_name, ''), v.tier, true, coalesce(v.employment_type, 'contractor'))
  on conflict (profile_id) do update
    set company_name = coalesce(nullif(excluded.company_name, ''), public.contractors.company_name),
        tier = coalesce(excluded.tier, public.contractors.tier),
        active = true,
        employment_type = excluded.employment_type;

  update public.contractor_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v.id;

  return 'ok';
end $$;
grant execute on function public.redeem_contractor_invite(text) to authenticated;

-- The tick box. Both directions; refuses while anything in flight belongs
-- to the other type; logs who and when; never deletes history.
create or replace function public.set_employment_type(p_contractor_id uuid, p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare v_c public.contractors%rowtype; v_ref text; v_num text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_type not in ('contractor', 'employee') then return 'error:bad_type'; end if;
  select * into v_c from public.contractors where id = p_contractor_id for update;
  if not found then return 'error:not_found'; end if;
  if v_c.employment_type = p_type then return 'ok:' || p_type; end if;

  -- contractor → employee: nothing of the contractor kind still open.
  if p_type = 'employee' then
    select w.wo_ref into v_ref from public.booking_offers o join public.work_orders w on w.id = o.work_order_id
     where o.contractor_id = p_contractor_id and o.state in ('offered', 'proposed', 'accepted')
     order by o.offered_at desc limit 1;
    if v_ref is not null then return 'conflict:open_offer:' || v_ref; end if;
  end if;

  -- employee → contractor: nothing of the employee kind still open.
  if p_type = 'contractor' then
    select w.wo_ref into v_ref from public.wo_assignments a join public.work_orders w on w.id = a.work_order_id
     where a.contractor_id = p_contractor_id and a.status <> 'released'
       and w.stage <> 'closed'
     order by a.start_date limit 1;
    if v_ref is not null then return 'conflict:active_assignment:' || v_ref; end if;
  end if;

  -- Either way: money still moving.
  select coalesce(number, 'draft') into v_num from public.contractor_invoices
   where contractor_id = p_contractor_id and status in ('submitted', 'approved')
   order by created_at desc limit 1;
  if v_num is not null then return 'conflict:unpaid_invoice:' || v_num; end if;
  if exists (select 1 from public.contractor_expenses
              where contractor_id = p_contractor_id and status = 'approved'
                and coalesce(paid_with, 'personal') = 'personal' and reimbursed_at is null) then
    return 'conflict:unpaid_expense';
  end if;

  update public.contractors set employment_type = p_type where id = p_contractor_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'employment_type_changed',
            jsonb_build_object('from', v_c.employment_type, 'to', p_type), auth.uid());
  -- Back to contractor: the offerable rule applies from this moment — no
  -- verified insurance, no offers. Re-derive rather than trust the old flag.
  perform public.contractor_recompute_offerable(p_contractor_id);
  return 'ok:' || p_type;
end $$;
grant execute on function public.set_employment_type(uuid, text) to authenticated;

-- ---- 3. expenses: who paid, and the reimbursement ----------------------------
alter table public.contractor_expenses
  add column if not exists paid_with text not null default 'personal',
  add column if not exists reimbursed_at timestamptz,
  add column if not exists reimbursed_by uuid references auth.users (id) on delete set null;
alter table public.contractor_expenses drop constraint if exists contractor_expenses_paid_with_check;
alter table public.contractor_expenses
  add constraint contractor_expenses_paid_with_check check (paid_with in ('personal', 'company_card'));
create index if not exists contractor_expenses_reimburse_idx
  on public.contractor_expenses (status, paid_with) where reimbursed_at is null;

-- Set by the claimant right after the claim (ruling 13: company card by
-- default for an employee). Only while it is still with the office.
create or replace function public.expense_set_paid_with(p_id uuid, p_paid_with text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_expenses%rowtype;
begin
  if p_paid_with not in ('personal', 'company_card') then return 'error:bad_value'; end if;
  select * into v from public.contractor_expenses where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.contractor_id is distinct from public.current_contractor_id() and not public.is_staff() then return 'error:not_yours'; end if;
  if v.status <> 'submitted' then return 'error:already_decided'; end if;
  update public.contractor_expenses set paid_with = p_paid_with where id = p_id;
  return 'ok:' || p_paid_with;
end $$;
grant execute on function public.expense_set_paid_with(uuid, text) to authenticated;

-- The office pays a personal-card claim back. Company-card claims are job
-- costs with nothing to pay out; a contractor's claims ride their invoice.
create or replace function public.expense_mark_reimbursed(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_expenses%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.contractor_expenses where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'approved' then return 'error:not_approved'; end if;
  if v.paid_with <> 'personal' then return 'error:nothing_to_pay'; end if;
  if v.reimbursed_at is not null then return 'ok:already'; end if;
  update public.contractor_expenses
     set status = 'paid', reimbursed_at = now(), reimbursed_by = auth.uid()
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'expense_reimbursed', auth.uid(), 'staff',
            jsonb_build_object('expense_id', p_id, 'amount_cents', v.amount_cents));
  return 'ok:paid';
end $$;
grant execute on function public.expense_mark_reimbursed(uuid) to authenticated;

-- ---- 4. the crew rule on expenses and the walkthrough (live definitions, one test swapped) ----

-- ---- contractor_expense_submit ----
CREATE OR REPLACE FUNCTION public.contractor_expense_submit(p_work_order_id uuid, p_category text, p_amount_cents integer, p_gst_cents integer, p_receipt_path text, p_note text DEFAULT ''::text, p_preapproval_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cid uuid; v_id uuid; v_threshold integer; v_flag boolean := false;
        v_cats jsonb; v_pre public.expense_preapprovals%rowtype;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if not public.wo_painter_on_job(p_work_order_id, v_cid) then
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
end $function$;

-- ---- expense_preapproval_request ----
CREATE OR REPLACE FUNCTION public.expense_preapproval_request(p_work_order_id uuid, p_description text, p_est_cents integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cid uuid; v_id uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if not public.wo_painter_on_job(p_work_order_id, v_cid) then
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
end $function$;

-- ---- wo_start_walkthrough_mode ----
CREATE OR REPLACE FUNCTION public.wo_start_walkthrough_mode(p_work_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_w public.work_orders%rowtype; v_cid uuid; v_token text;
begin
  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (public.wo_painter_on_job(v_w.id, v_cid))) then
    return 'error:not_yours';
  end if;
  if v_w.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '2 hours'
   where work_order_id = p_work_order_id and signed_at is null;
  if not found then return 'error:no_signoff_row'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_mode_started', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('expires_at', now() + interval '2 hours'));
  return 'ok:' || v_token;
end $function$;

-- ---- wo_generate_report_draft ----
CREATE OR REPLACE FUNCTION public.wo_generate_report_draft(p_work_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_report jsonb; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or public.wo_is_system()
          or (public.wo_painter_on_job(v_wo.id, v_cid))) then
    return 'error:not_yours';
  end if;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'draft', true,
    'generated_at', now(),
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = p_work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = p_work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = p_work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = p_work_order_id)
  ) into v_report;

  insert into public.wo_reports (work_order_id, kind, body)
    values (p_work_order_id, 'draft', v_report) returning id into v_id;

  update public.wo_signoff set report_draft_id = v_id where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor,
                                actor_kind, meta)
    values (p_work_order_id, 'report_drafted', auth.uid(),
            case when public.is_staff() then 'staff'
                 when public.wo_is_system() then 'system'
                 else 'contractor' end,
            jsonb_build_object('report_id', v_id));
  return 'ok:' || v_id;
end $function$;

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'contractor_doc_kind' and e.enumlabel in ('white_card', 'working_at_heights')) = 2 as doc_kinds,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_invites' and column_name = 'employment_type') = 1 as invite_column,
  (select count(*) from pg_proc where proname = 'create_contractor_invite') = 1 as one_invite_fn,
  (select count(*) from pg_proc where proname in ('set_employment_type', 'expense_set_paid_with', 'expense_mark_reimbursed')) = 3 as three_new_fns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_expenses'
     and column_name in ('paid_with', 'reimbursed_at', 'reimbursed_by')) = 3 as expense_columns,
  (select count(*) from pg_proc p where p.proname in ('contractor_expense_submit', 'expense_preapproval_request', 'wo_start_walkthrough_mode', 'wo_generate_report_draft')
     and p.prosrc like '%wo_painter_on_job%') = 4 as four_widened;

insert into public._prod_migrations(name) values ('20270161000000_employee_admin_expenses.sql') on conflict (name) do nothing;
