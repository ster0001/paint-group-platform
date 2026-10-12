-- 20270255 · Pause/Resume reminders through an RPC, and close three definer
-- functions any signed-in user could call (Payments merge prework, 12 Oct 2026).
--
-- 1. Pause/Resume reminders never worked. `pauseRemindersAction` updated
--    `invoices.chase_hold_reason` straight from the staff session, but UPDATE
--    on invoices was revoked from authenticated in 20261112 (money changes are
--    RPC-only), so every press answered permission denied. It is now
--    `invoice_set_chase_hold`: staff only, open invoices only, kind 'office'.
--    A call-back hold (20270226) is not the office's to lift here — it clears
--    when the call back closes.
--
-- 2. `invoice_draft_deposit` (20270153) was meant for the service role, but the
--    20270201 hardening re-granted EXECUTE to authenticated on every definer
--    function that lacked it, and the function itself checks nobody. Any
--    signed-in customer or contractor could draft a deposit on any accepted
--    estimate. It now refuses anyone but the service role or staff, and the
--    authenticated grant is revoked again.
--
-- 3. `contractor_invoice_attach_pdf` and `contractor_invoice_attach_remittance_pdf`
--    are only ever called with the service client (lib/invoicing/pdf.ts) but
--    were executable by any signed-in user, who could set a PDF path on any
--    contractor invoice that had none. Revoked. The trigger function
--    `contractor_invoice_bonus_paid` loses its stray anon/authenticated grant.
--
-- Converges on a re-run: create or replace, revokes, grants.
set lock_timeout = '15s';

-- ---- 1. invoice_set_chase_hold ---------------------------------------------------
create or replace function public.invoice_set_chase_hold(p_invoice_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if length(coalesce(v_reason, '')) > 300 then return 'error:reason_too_long'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then return 'error:not_open'; end if;

  if v_reason is null then
    if v.chase_hold_reason is null then return 'ok:already_running'; end if;
    if v.chase_hold_kind = 'call_back' then return 'error:call_back_hold'; end if;
    update public.invoices set chase_hold_reason = null, chase_hold_kind = null where id = p_invoice_id;
    perform public.invoice_event(p_invoice_id, 'reminders_resumed', 'staff', '{}'::jsonb);
    return 'ok:resumed';
  end if;

  if v.chase_hold_kind = 'call_back' then return 'error:call_back_hold'; end if;
  update public.invoices set chase_hold_reason = v_reason, chase_hold_kind = 'office' where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'reminders_paused', 'staff', jsonb_build_object('reason', v_reason));
  return 'ok:paused';
end $$;
revoke execute on function public.invoice_set_chase_hold(uuid, text) from public, anon;
grant execute on function public.invoice_set_chase_hold(uuid, text) to authenticated;

-- ---- 2. invoice_draft_deposit: service role or staff only ---------------------------
-- Body as 20270153, with the guard as its first statement.
create or replace function public.invoice_draft_deposit(p_estimate_id uuid, p_auto text default 'import')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_est public.estimates%rowtype; v_wo uuid; v_total integer; v_pct numeric;
  v_deposit integer; v_gst integer; v_rate numeric; v_inv uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_est from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  if v_est.status <> 'accepted' then return 'error:not_accepted'; end if;
  if exists (select 1 from public.invoices where estimate_id = p_estimate_id and kind = 'deposit') then
    return 'exists';
  end if;

  v_total := coalesce(v_est.accepted_total_cents, v_est.total_cents, 0);
  if v_total <= 0 then return 'error:no_total'; end if;
  v_pct := coalesce((v_est.sent_snapshot->>'depositPct')::numeric,
                    public.invoice_setting_num('{depositPct}', 10));
  v_deposit := greatest(round(v_total * v_pct / 100.0)::integer, 0);
  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_gst := public.gst_from_inc_cents(v_deposit::bigint, v_rate);
  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;

  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents, token)
    values (p_estimate_id, v_est.customer_id, v_wo, 'deposit', 'draft',
            v_deposit, v_deposit - v_gst, v_gst, v_deposit, public.invoice_new_token())
    returning id into v_inv;

  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, gst_cents)
    values (v_inv, 0, 'manual',
            'Deposit — ' || public.invoice_pct_text(v_pct) || '% of the contract price, payable on acceptance',
            v_deposit - v_gst, v_gst);

  perform public.invoice_event(v_inv, 'drafted', 'system',
    jsonb_build_object('auto', p_auto, 'deposit_pct', v_pct, 'total_inc_cents', v_deposit));
  return 'drafted';
end; $$;
revoke execute on function public.invoice_draft_deposit(uuid, text) from public, anon, authenticated;

-- ---- 3. service-client-only helpers and a trigger function ---------------------------
revoke execute on function public.contractor_invoice_attach_pdf(uuid, text) from public, anon, authenticated;
revoke execute on function public.contractor_invoice_attach_remittance_pdf(uuid, text) from public, anon, authenticated;
revoke execute on function public.contractor_invoice_bonus_paid() from public, anon, authenticated;

-- ---- read-back: compare every value to its _expect_ ---------------------------------
select
  has_function_privilege('authenticated', 'public.invoice_set_chase_hold(uuid, text)', 'execute') as chase_hold_authenticated, true as _expect_chase_hold_authenticated,
  has_function_privilege('anon', 'public.invoice_set_chase_hold(uuid, text)', 'execute') as chase_hold_anon, false as _expect_chase_hold_anon,
  has_function_privilege('authenticated', 'public.invoice_draft_deposit(uuid, text)', 'execute') as draft_deposit_authenticated, false as _expect_draft_deposit_authenticated,
  (select position('service_role' in prosrc) > 0 from pg_proc where proname = 'invoice_draft_deposit') as draft_deposit_guarded, true as _expect_draft_deposit_guarded,
  has_function_privilege('authenticated', 'public.contractor_invoice_attach_pdf(uuid, text)', 'execute') as ci_pdf_authenticated, false as _expect_ci_pdf_authenticated,
  has_function_privilege('authenticated', 'public.contractor_invoice_attach_remittance_pdf(uuid, text)', 'execute') as ci_rem_authenticated, false as _expect_ci_rem_authenticated,
  has_function_privilege('anon', 'public.contractor_invoice_bonus_paid()', 'execute') as bonus_trigger_anon, false as _expect_bonus_trigger_anon;

insert into public._prod_migrations(name) values ('20270255000000_invoice_chase_hold_rpc_definer_guards.sql') on conflict (name) do nothing;
