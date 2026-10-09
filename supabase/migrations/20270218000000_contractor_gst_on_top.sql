-- =============================================================================
-- Contractor invoices: GST goes ON TOP of the offered amount (Tom, 7 Oct 2026).
--
-- The offered amount on a job (hours × rate, e.g. 38.5 h × $65 = $2,502.50)
-- is EX GST. Every contractor-invoice writer backed GST out of it instead
-- (gst_from_inc_cents), so a GST-registered painter was paid $2,502.50 with
-- $227.50 of it called GST — short by $250.25 on that example. Not registered
-- = the net amount only, unchanged.
--
-- One new column — claimed_ex_cents, the ex-GST work figure this invoice
-- claims against the agreed job amount — so "what remains to invoice" is a
-- straight sum that no longer depends on the GST status at the time. Every
-- writer sets it; the guard freezes it with the rest of the money columns;
-- contractor_invoice_invoiced_cents sums it.
--
-- Rewrites (each from its live body, the GST derivation and the new column the
-- only changes): contractor_invoice_draft (20270165), _request and _submit
-- (20261127), _approve (20261121). Submit regains the remainder rule that the
-- 20261127 rewrite dropped (its 20261121 basis subtracted previously
-- invoiced; the expenses rewrite started from 20261119 and lost it).
--
-- Then a backfill of EVERY existing row, drafts through paid: the stored
-- work figure is re-read as ex GST and GST added on top. Reimbursements
-- (at-cost expenses, inc GST with their own GST) are untouched. Idempotent —
-- a row with claimed_ex_cents already set is skipped. The read-back lists
-- every row it changed with the extra now owed on anything already paid.
--
-- Converges on a re-run. Paste starts with the lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the column ----------------------------------------------------------
alter table public.contractor_invoices
  add column if not exists claimed_ex_cents integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contractor_invoices_claimed_ex_nonneg') then
    alter table public.contractor_invoices
      add constraint contractor_invoices_claimed_ex_nonneg check (claimed_ex_cents >= 0);
  end if;
end $$;

-- ---- 2. the guard freezes it too (20261119 body + one line) ------------------
create or replace function public.contractor_invoice_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and current_user <> 'service_role' then
      raise exception 'only draft contractor invoices can be deleted';
    end if;
    return old;
  end if;

  if current_user = 'service_role' then return new; end if;

  if new.status is distinct from old.status then
    if not ( (old.status = 'draft'     and new.status = 'submitted')
          or (old.status = 'submitted' and new.status = 'approved')
          or (old.status = 'approved'  and new.status = 'paid')
          -- ⚑9 RCTI: the platform issues on the contractor's behalf.
          or (old.status = 'draft'     and new.status = 'approved' and old.rcti) ) then
      raise exception 'contractor invoice cannot move % -> %', old.status, new.status;
    end if;
  end if;

  -- Frozen once it stops being a draft (the transition row itself may write
  -- the submit-time recompute, which is why the check is on OLD status).
  if old.status <> 'draft' and (
       new.offer_cents           is distinct from old.offer_cents
    or new.variation_delta_cents is distinct from old.variation_delta_cents
    or new.deduction_lines       is distinct from old.deduction_lines
    or new.subtotal_ex_cents     is distinct from old.subtotal_ex_cents
    or new.gst_cents             is distinct from old.gst_cents
    or new.total_inc_cents       is distinct from old.total_inc_cents
    or new.claimed_ex_cents      is distinct from old.claimed_ex_cents
    or new.number                is distinct from old.number
    or new.entity_snapshot       is distinct from old.entity_snapshot ) then
    raise exception 'a submitted contractor invoice is immutable';
  end if;

  return new;
end $$;

-- ---- 3. what has been claimed = Σ claimed_ex_cents ---------------------------
create or replace function public.contractor_invoice_invoiced_cents(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(claimed_ex_cents), 0)::integer
    from public.contractor_invoices
   where work_order_id = p_work_order_id and status <> 'draft'
$$;

-- ---- 4. the auto-draft (20270165 body) --------------------------------------
create or replace function public.contractor_invoice_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_ex integer; v_gst integer;
        v_terms integer; v_signed date; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'skip:no_contractor'; end if;
  select * into v_c from public.contractors where id = v_wo.contractor_id;
  -- Employed painters (S7): an employee is paid through payroll — never an RCTI.
  if v_c.employment_type = 'employee' then return 'skip:employee'; end if;

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
  v_ex := v_a.total_inc_cents - v_prev;            -- the agreed figure is EX GST
  if v_ex <= 0 then return 'skip:nothing_remaining'; end if;

  -- GST on top when registered; the net amount only when not.
  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_ex::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms  := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed
    from public.wo_signoff s where s.work_order_id = p_work_order_id;

  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents,
       claimed_ex_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
       status, due_on, rcti)
    values
      (p_work_order_id, v_wo.contractor_id, 'signoff',
       v_a.offer_cents, v_a.additions_cents, v_a.deduction_lines,
       v_prev,
       v_ex, v_ex, v_gst, v_ex + v_gst,
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

-- ---- 5. a payment claim (20261127 body) -------------------------------------
-- p_value is a percent of the agreed EX-GST figure, or EX-GST dollars; the
-- contractor's own lines sum to that ex figure. GST (when registered) and
-- approved reimbursements ride on top.
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
  v_remaining := v_a.total_inc_cents - v_prev;     -- ex GST, like the offer
  if v_remaining <= 0 then return 'error:nothing_remaining'; end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_amount := least(round(v_a.total_inc_cents * p_value / 100.0)::integer, v_remaining);
  elsif p_mode = 'fixed' then
    if p_value is null or p_value <= 0 then return 'error:bad_amount'; end if;
    v_amount := round(p_value * 100)::integer;  -- ex-GST dollars in, cents stored
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

  -- GST on top when registered; the net amount only when not.
  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_amount::bigint,
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
       claimed_ex_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
       reimbursement_lines, reimbursement_cents,
       status, submitted_at, number, due_on, rcti,
       gst_registered_at_submit, entity_snapshot,
       lines, invoice_date)
    values
      (p_work_order_id, v_cid, 'claim',
       0, 0, '[]'::jsonb,
       v_prev, case when p_mode = 'percent' then p_value end,
       v_amount,
       v_amount + (v_reimb.r_cents - v_reimb.r_gst),
       v_gst + v_reimb.r_gst,
       v_amount + v_gst + v_reimb.r_cents,
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

-- ---- 6. submit (20261127 body + the 20261121 remainder rule restored) --------
create or replace function public.contractor_invoice_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_cid uuid; v_a record; v_prev integer; v_ex integer; v_gst integer; v_reimb record;
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
  v_ex := v_a.total_inc_cents - v_prev;            -- the agreed figure is EX GST
  if v_ex <= 0 then return 'error:nothing_remaining'; end if;

  -- GST on top when registered; the net amount only when not.
  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_ex::bigint,
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
         previously_invoiced_cents = v_prev,
         claimed_ex_cents = v_ex,
         subtotal_ex_cents = v_ex + (v_reimb.r_cents - v_reimb.r_gst),
         gst_cents = v_gst + v_reimb.r_gst,
         total_inc_cents = v_ex + v_gst + v_reimb.r_cents,
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

-- ---- 7. RCTI approve-from-draft (20261121 body) -----------------------------
create or replace function public.contractor_invoice_approve(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_ex integer; v_gst integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  if v_ci.status = 'draft' then
    if not v_ci.rcti then return 'error:not_submitted'; end if;
    select * into v_c from public.contractors where id = v_ci.contractor_id;
    select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
    v_prev := public.contractor_invoice_invoiced_cents(v_ci.work_order_id);
    v_ex := v_a.total_inc_cents - v_prev;          -- the agreed figure is EX GST
    if v_ex <= 0 then return 'error:nothing_remaining'; end if;
    -- GST on top when registered; the net amount only when not.
    v_gst := case when v_c.gst_registered
                  then public.gst_on_ex_cents(v_ex::bigint,
                         public.invoice_setting_num('{gstRatePct}', 10))::integer
                  else 0 end;
    update public.contractor_invoices
       set status = 'submitted', submitted_at = now(),
           number = coalesce(number, public.ci_allocate_number()),
           offer_cents = v_a.offer_cents,
           variation_delta_cents = v_a.additions_cents,
           deduction_lines = v_a.deduction_lines,
           previously_invoiced_cents = v_prev,
           claimed_ex_cents = v_ex,
           subtotal_ex_cents = v_ex,
           gst_cents = v_gst,
           total_inc_cents = v_ex + v_gst,
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

-- ---- 8. backfill every existing invoice -------------------------------------
-- The stored work figure (total − reimbursements) was the agreed EX-GST amount
-- read as inc. Re-read it as ex; GST on top where the row was registered
-- (pinned at submit; a draft follows the contractor's current flag). The
-- reimbursement part keeps exactly the GST it carried. Rows already carrying
-- claimed_ex_cents are skipped, so this converges on a re-run.
--
-- The guard refuses money changes on a submitted row for anyone but
-- service_role — the SQL editor is `postgres` — so it steps aside for the
-- backfill only. The old totals are kept on each row for the read-back and
-- the top-up list, then dropped at the end.
alter table public.contractor_invoices disable trigger contractor_invoices_guard;

alter table public.contractor_invoices
  add column if not exists _gst_backfill_old_total integer;

with src as (
  select ci.id,
         ci.total_inc_cents - coalesce(ci.reimbursement_cents, 0)            as work_ex,
         coalesce(ci.reimbursement_cents, 0)                                 as r_cents,
         case when ci.status = 'draft' then c.gst_registered
              else coalesce(ci.gst_registered_at_submit, false) end          as registered,
         public.invoice_setting_num('{gstRatePct}', 10)                      as rate
    from public.contractor_invoices ci
    join public.contractors c on c.id = ci.contractor_id
   where ci.claimed_ex_cents = 0 and ci.total_inc_cents > 0
),
calc as (
  select s.id, s.work_ex, s.r_cents,
         -- the reimbursement GST is whatever was stored beyond the old work GST
         greatest(ci.gst_cents - case when s.registered
                                      then public.gst_from_inc_cents(s.work_ex::bigint, s.rate) else 0 end, 0) as r_gst,
         case when s.registered then public.gst_on_ex_cents(s.work_ex::bigint, s.rate) else 0 end as work_gst
    from src s join public.contractor_invoices ci on ci.id = s.id
)
update public.contractor_invoices ci
   set _gst_backfill_old_total = ci.total_inc_cents,
       claimed_ex_cents  = c.work_ex,
       subtotal_ex_cents = c.work_ex + (c.r_cents - c.r_gst),
       gst_cents         = c.work_gst + c.r_gst,
       total_inc_cents   = c.work_ex + c.work_gst + c.r_cents
  from calc c
 where ci.id = c.id;

alter table public.contractor_invoices enable trigger contractor_invoices_guard;

-- ---- 9. read back: every row the backfill changed ---------------------------
-- `top_up_owed` is the GST now owed on a row that was ALREADY PAID at the old
-- figure — pay the difference and keep this list. Drafts/submitted/approved
-- rows simply carry the corrected total from here.
select ci.number, ci.status::text as status,
       ci.entity_snapshot ->> 'company_name' as company,
       w.wo_ref,
       ci._gst_backfill_old_total                     as old_total_cents,
       ci.claimed_ex_cents                            as work_ex_cents,
       ci.gst_cents, ci.total_inc_cents,
       ci.total_inc_cents - ci._gst_backfill_old_total as change_cents,
       case when ci.status = 'paid'
            then ci.total_inc_cents - ci._gst_backfill_old_total else 0 end as top_up_owed_cents
  from public.contractor_invoices ci
  join public.work_orders w on w.id = ci.work_order_id
 where ci._gst_backfill_old_total is not null
 order by ci.status, ci.number;

-- Totals, including the rows that did not move (not registered).
select count(*) filter (where _gst_backfill_old_total is not null)                        as backfilled_rows,
       count(*) filter (where total_inc_cents <> _gst_backfill_old_total)                 as rows_changed,
       coalesce(sum(total_inc_cents - _gst_backfill_old_total)
                filter (where status = 'paid'), 0)                                        as paid_top_up_cents,
       count(*) filter (where claimed_ex_cents = 0 and total_inc_cents > 0)               as _expect_0_unfilled,
       count(*) filter (where total_inc_cents <> subtotal_ex_cents + gst_cents)           as _expect_0_totals_disagree
  from public.contractor_invoices;

alter table public.contractor_invoices drop column if exists _gst_backfill_old_total;

-- ---- 10. verification of the definitions ------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'contractor_invoices'
       and column_name = 'claimed_ex_cents')                                                as _expect_1_column,
  (select p.prosrc like '%claimed_ex_cents%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_invoice_guard')                 as _expect_t_guard,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('contractor_invoice_draft', 'contractor_invoice_request',
                         'contractor_invoice_submit', 'contractor_invoice_approve')
       and p.prosrc like '%gst_on_ex_cents%'
       and p.prosrc not like '%gst_from_inc_cents%')                                       as _expect_4_on_top,
  (select p.prosrc like '%sum(claimed_ex_cents)%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_invoice_invoiced_cents')        as _expect_t_invoiced,
  (select tgenabled from pg_trigger where tgname = 'contractor_invoices_guard')             as _expect_O_guard_enabled;

insert into public._prod_migrations(name) values ('20270218000000_contractor_gst_on_top.sql') on conflict (name) do nothing;
