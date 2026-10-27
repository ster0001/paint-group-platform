-- 20270307 — invoice dates can sit before today (Tom, 27 Oct 2026).
--
-- Until now the Send confirm refused a due date before today (error:due_in_past)
-- and the invoice date (issued_on) was always the day the Send button was
-- pressed. Tom bills work after the fact and wants both to carry the real
-- date, so:
--   · invoice_issue takes an optional p_issued_on (a Melbourne calendar day,
--     today when absent). It may be before today, never after it.
--   · the due date on a draft may be any day; the only refusal left is a missing one.
--   · with no due date chosen, the terms count from the invoice date, not from
--     the day of the press — so a backdated invoice has a backdated due date.
-- Overdue stays what it was: isOverdue in lib/invoicing/derive.ts reads due_on.
set lock_timeout = '15s';

-- ---- 1. invoice_set_draft_due: any day --------------------------------------------------
create or replace function public.invoice_set_draft_due(p_invoice_id uuid, p_due_on date)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;           -- R13: locked once sent
  if p_due_on is null then return 'error:no_due'; end if;                  -- 20270307: before today is fine
  if v.due_on is not distinct from p_due_on then return 'ok:unchanged'; end if;
  update public.invoices set due_on = p_due_on where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'amended', 'staff',
    jsonb_build_object('what', 'due_on', 'from', v.due_on, 'to', p_due_on));
  return 'ok:due_set';
end $$;
revoke execute on function public.invoice_set_draft_due(uuid, date) from public, anon;
grant execute on function public.invoice_set_draft_due(uuid, date) to authenticated;

-- ---- 2. invoice_issue(p_invoice_id, p_issued_on) ----------------------------------------
-- The one-argument shape goes first: with both in place a one-argument call is
-- not unique. Callers inside SQL (void-and-reissue) resolve by name at run
-- time and pick up the default.
drop function if exists public.invoice_issue(uuid);

create or replace function public.invoice_issue(p_invoice_id uuid, p_issued_on date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_rate numeric; v_ex bigint; v_gst integer;
        v_total bigint; v_terms integer; v_today date; v_issued date; v_due date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  v_issued := coalesce(p_issued_on, v_today);
  if v_issued > v_today then return 'error:issued_in_future'; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);

  if v.kind in ('deposit', 'progress', 'final') then
    -- Inc-anchored: the promise is an inc-GST figure computed off the ledger.
    v_total := v.total_inc_cents;
    if v_total <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_from_inc_cents(v_total, v_rate);
    v_ex := v_total - v_gst;
  else
    -- Line-built: sum ex lines, GST once, round half-up (⚑14).
    select coalesce(sum(l.amount_ex_cents), 0) into v_ex
      from public.invoice_lines l where l.invoice_id = p_invoice_id;
    if v_ex <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_on_ex_cents(v_ex, v_rate);
    v_total := v_ex + v_gst;
  end if;

  v_terms := case when v.kind = 'final'
                  then public.invoice_setting_num('{finalTermsDays}', 7)::integer
                  else public.invoice_setting_num('{paymentTermsDays}', 7)::integer end;
  -- A due date chosen on the draft stands, whatever day it is (20270307);
  -- a missing one is the terms counted from the invoice date.
  v_due := coalesce(v.due_on, v_issued + v_terms);

  update public.invoices
     set status = 'issued',
         number = public.invoice_allocate_number(),
         issued_on = v_issued,
         due_on = v_due,
         subtotal_ex_cents = v_ex::integer,
         gst_cents = v_gst,
         total_inc_cents = v_total::integer,
         amount_cents = v_total::integer
   where id = p_invoice_id;

  perform public.invoice_event(p_invoice_id, 'issued', 'staff',
    jsonb_build_object('number', (select number from public.invoices where id = p_invoice_id),
                       'total_inc_cents', v_total, 'issued_on', v_issued, 'due_on', v_due));
  return 'ok:issued';
end $$;
revoke execute on function public.invoice_issue(uuid, date) from public, anon;
grant execute on function public.invoice_issue(uuid, date) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ----------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_issue') as issue_fns, 1 as _expect_issue_fns,
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_issue') as issue_args, 'p_invoice_id uuid, p_issued_on date' as _expect_issue_args,
  (select prosrc like '%issued_in_future%' from pg_proc where proname = 'invoice_issue' limit 1) as issue_refuses_future, true as _expect_issue_refuses_future,
  (select prosrc not like '%due_in_past%' from pg_proc where proname = 'invoice_set_draft_due' limit 1) as due_any_day, true as _expect_due_any_day,
  has_function_privilege('authenticated', 'public.invoice_issue(uuid, date)', 'execute') as issue_authenticated, true as _expect_issue_authenticated,
  has_function_privilege('anon', 'public.invoice_issue(uuid, date)', 'execute') as issue_anon, false as _expect_issue_anon,
  has_function_privilege('authenticated', 'public.invoice_set_draft_due(uuid, date)', 'execute') as due_authenticated, true as _expect_due_authenticated;

insert into public._prod_migrations(name) values ('20270307000000_invoice_date_backdate.sql') on conflict (name) do nothing;
