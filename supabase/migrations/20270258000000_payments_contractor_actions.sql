-- 20270258 · Payments merge Step 5 — the Contractors block (payments-merge brief §4.5).
--
-- ADDITIVE ONLY: one nullable column, three new functions, and a `create or
-- replace` of the contractor_invoices guard whose only change is two step-backs
-- that ONLY the Undo functions can take.
--
--   · Approve is one press with Undo (contractor_invoice_unapprove: approved →
--     submitted, within 10 minutes, before it is paid).
--   · ✓ Paid is one press with Undo (contractor_invoice_unpay: paid → approved,
--     within 10 minutes, before the remittance has gone). The expenses the
--     invoice carried go back to approved. A BONUS invoice is not undone here:
--     painter_bonuses has one writer (CLAUDE.md "one evaluator, one writer").
--   · The remittance email waits for the Undo window, like the customer receipt
--     (⚑P2): contractor_invoice_claim_remittance stamps remittance_sent_at just
--     before it goes; Undo is refused once stamped. Nothing moves money — the
--     platform records (existing ruling).
--
-- The guard's step-backs require `app.ci_undo = 'on'`, set transaction-locally
-- (set_config(..., true)) by the two Undo functions alone — no other writer,
-- staff session or RPC can move a contractor invoice backwards.
-- Converges on a re-run.
set lock_timeout = '15s';

alter table public.contractor_invoices add column if not exists remittance_sent_at timestamptz;
comment on column public.contractor_invoices.remittance_sent_at is
  'Payments merge Step 5: claimed just before the remittance email goes (contractor_invoice_claim_remittance). Undo of the payment is refused once set.';

-- ---- the guard: the 20261119 body, plus the Undo step-backs -------------------------------
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
          or (old.status = 'draft'     and new.status = 'approved' and old.rcti)
          -- 20270258: Undo of a one-press Approve / Paid, and only from the Undo functions.
          or (old.status = 'approved'  and new.status = 'submitted' and coalesce(current_setting('app.ci_undo', true), '') = 'on')
          or (old.status = 'paid'      and new.status = 'approved'  and coalesce(current_setting('app.ci_undo', true), '') = 'on') ) then
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

-- ---- Undo an Approve --------------------------------------------------------------------------
create or replace function public.contractor_invoice_unapprove(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'approved' then return 'error:not_approved'; end if;
  if v.approved_at is null or v.approved_at < now() - interval '10 minutes' then return 'error:undo_expired'; end if;
  perform set_config('app.ci_undo', 'on', true);
  update public.contractor_invoices set status = 'submitted', approved_at = null, approved_by = null where id = p_id;
  perform set_config('app.ci_undo', 'off', true);
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'contractor_invoice_approval_undone', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id, 'reason', 'undo'));
  return 'ok:submitted';
end $$;
revoke execute on function public.contractor_invoice_unapprove(uuid) from public, anon;
grant execute on function public.contractor_invoice_unapprove(uuid) to authenticated;

-- ---- Undo a Paid --------------------------------------------------------------------------------
create or replace function public.contractor_invoice_unpay(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'paid' then return 'error:not_paid'; end if;
  if v.auto_draft_source = 'bonus' then return 'error:bonus_undo'; end if;
  if v.remittance_sent_at is not null then return 'error:remittance_sent'; end if;
  if not exists (select 1 from public.wo_events e
                  where e.type = 'contractor_invoice_paid' and e.meta->>'contractor_invoice_id' = p_id::text
                    and e.created_at >= now() - interval '10 minutes') then
    return 'error:undo_expired';
  end if;
  perform set_config('app.ci_undo', 'on', true);
  -- remittance_number is kept: a re-pay reuses it (mark_paid coalesces), so no number is burnt.
  update public.contractor_invoices set status = 'approved', paid_at = null, bank_reference = '' where id = p_id;
  perform set_config('app.ci_undo', 'off', true);
  update public.contractor_expenses set status = 'approved' where invoice_id = p_id and status = 'paid';
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v.work_order_id, 'contractor_invoice_payment_undone', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id, 'reason', 'undo'));
  return 'ok:approved';
end $$;
revoke execute on function public.contractor_invoice_unpay(uuid) from public, anon;
grant execute on function public.contractor_invoice_unpay(uuid) to authenticated;

-- ---- the remittance waits for the Undo window ------------------------------------------------------
create or replace function public.contractor_invoice_claim_remittance(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return 'error:service_only'; end if;
  update public.contractor_invoices set remittance_sent_at = now()
   where id = p_id and status = 'paid' and remittance_sent_at is null;
  get diagnostics v_n = row_count;
  return case when v_n = 1 then 'ok:claimed' else 'ok:not_claimed' end;
end $$;
revoke execute on function public.contractor_invoice_claim_remittance(uuid) from public, anon, authenticated;

-- ---- read-back --------------------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_invoices' and column_name = 'remittance_sent_at')::int as remittance_column, 1 as _expect_remittance_column,
  (select position('app.ci_undo' in prosrc) > 0 from pg_proc where proname = 'contractor_invoice_guard') as guard_undo_branch, true as _expect_guard_undo_branch,
  (select position('immutable' in prosrc) > 0 from pg_proc where proname = 'contractor_invoice_guard') as guard_keeps_freeze, true as _expect_guard_keeps_freeze,
  has_function_privilege('authenticated', 'public.contractor_invoice_unapprove(uuid)', 'execute') as unapprove_auth, true as _expect_unapprove_auth,
  has_function_privilege('authenticated', 'public.contractor_invoice_unpay(uuid)', 'execute') as unpay_auth, true as _expect_unpay_auth,
  has_function_privilege('authenticated', 'public.contractor_invoice_claim_remittance(uuid)', 'execute') as claim_auth, false as _expect_claim_auth,
  has_function_privilege('anon', 'public.contractor_invoice_unpay(uuid)', 'execute') as unpay_anon, false as _expect_unpay_anon;

insert into public._prod_migrations(name) values ('20270258000000_payments_contractor_actions.sql') on conflict (name) do nothing;
