-- 20270153 · a draft deposit invoice for a job that was accepted without one.
--
-- Tom, 17 Sep 2026: "please list them all as draft deposits in invoicing".
-- The Airtable import (20270152) and the Zap handover accept a signed job
-- silently and, by Tom's 16 Sep ruling, draft no deposit invoice — the
-- office records what PaintScout already collected by hand. To make that
-- bookkeeping visible, every such job gets the SAME draft deposit an online
-- acceptance would have drafted (accept_estimate, 20270149 §2): the settings
-- percentage of the accepted total, one line, drafted event, status draft.
-- A draft counts for nothing in invoice_ledger and sends nothing; the office
-- issues it and records the payment, edits the figure, or voids it.
--
-- Service role only: the import scripts call it. Idempotent — a job that
-- already has a deposit invoice of any status answers 'exists'.

create or replace function public.invoice_draft_deposit(p_estimate_id uuid, p_auto text default 'import')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_est public.estimates%rowtype; v_wo uuid; v_total integer; v_pct numeric;
  v_deposit integer; v_gst integer; v_rate numeric; v_inv uuid;
begin
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

-- Read-back: the function exists and nobody but the service role may call it.
select
  (select count(*) from pg_proc where proname = 'invoice_draft_deposit') = 1 as fn_ok,
  not has_function_privilege('authenticated', 'public.invoice_draft_deposit(uuid, text)', 'execute') as authenticated_blocked,
  not has_function_privilege('anon', 'public.invoice_draft_deposit(uuid, text)', 'execute') as anon_blocked;

insert into public._prod_migrations(name) values ('20270153000000_invoice_draft_deposit.sql') on conflict (name) do nothing;
