-- =============================================================================
-- Employed painters — Session 7: no contractor invoice for an employee's job.
--
-- Sign-off (and completion after rectification) call contractor_invoice_draft
-- to draft the painter's RCTI. The lead of an employee job IS
-- work_orders.contractor_id, so the loop spec found a draft invoice for an
-- employee — money that would have sat on Payables for payroll to pay twice.
-- Live definition, one guard added after the contractor is read.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.contractor_invoice_draft(p_work_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_total integer; v_gst integer;
        v_terms integer; v_signed date; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'skip:no_contractor'; end if;
  select * into v_c from public.contractors where id = v_wo.contractor_id;
  -- Employed painters (S7): an employee is paid through payroll — never an
  -- RCTI. Found by the employee loop spec: sign-off drafted one for the lead.
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
end $function$;

revoke execute on function public.contractor_invoice_draft(uuid) from public, anon, authenticated;
grant execute on function public.contractor_invoice_draft(uuid) to service_role;

select
  (select p.prosrc like '%skip:employee%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_invoice_draft') as employee_guard_ok;

insert into public._prod_migrations(name) values ('20270165000000_no_rcti_for_employees.sql') on conflict (name) do nothing;
