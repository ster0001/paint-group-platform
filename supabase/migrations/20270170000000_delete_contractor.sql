-- =============================================================================
-- Remove a painter who should never have been on the list (Tom, 18 Sep 2026):
-- "be able to delete contractors from the contractor page that are unwanted."
--
-- Why this is an RPC with teeth rather than a delete button:
-- `work_orders.contractor_id` is ON DELETE **SET NULL**, and nine other tables
-- CASCADE. A plain delete on a painter with history would therefore quietly
-- strip every job they ever did of its painter, take their offers, assignments,
-- timesheets and their INSURANCE CERTIFICATES with it, and leave the labour
-- lines those timesheets posted sitting on jobs with nothing behind them.
-- None of that raises an error; the row simply disappears and the history rots.
--
-- So: delete is for a row that never did anything — a duplicate, a typo, an
-- invite that went nowhere. Anything with history is REFUSED by name, and the
-- office suspends them instead (contractors.active, already on the screen),
-- which keeps every record and stops them being offered work.
--
-- The auth login is deliberately NOT touched. Removing someone's ability to
-- sign in is a separate, heavier decision; without a contractors row they land
-- on "your account isn't set up yet" and can do nothing.
-- =============================================================================

create or replace function public.delete_contractor(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_c public.contractors%rowtype; v_ref text; v_num text; v_n integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_c from public.contractors where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  -- 1. Jobs. work_orders.contractor_id would be SET NULL — the job would lose
  --    its painter, and on an employee job that is the LEAD painter's name the
  --    customer was given.
  select w.wo_ref into v_ref from public.work_orders w
   where w.contractor_id = p_id order by w.created_at limit 1;
  if v_ref is not null then return 'conflict:jobs:' || v_ref; end if;

  -- 2. Assignments (employed painters) — would CASCADE away.
  select w.wo_ref into v_ref from public.wo_assignments a
    join public.work_orders w on w.id = a.work_order_id
   where a.contractor_id = p_id order by a.start_date limit 1;
  if v_ref is not null then return 'conflict:assignments:' || v_ref; end if;

  -- 3. Offers, past or present — the record of what they were asked to do.
  select w.wo_ref into v_ref from public.booking_offers o
    join public.work_orders w on w.id = o.work_order_id
   where o.contractor_id = p_id order by o.offered_at desc limit 1;
  if v_ref is not null then return 'conflict:offers:' || v_ref; end if;

  -- 4. Money. These three RESTRICT, so they would fail with a raw foreign-key
  --    error; name them properly instead.
  select coalesce(number, 'a draft') into v_num from public.contractor_invoices
   where contractor_id = p_id order by created_at desc limit 1;
  if v_num is not null then return 'conflict:invoice:' || v_num; end if;

  select count(*) into v_n from public.contractor_expenses where contractor_id = p_id;
  if v_n > 0 then return 'conflict:expenses:' || v_n::text; end if;

  select count(*) into v_n from public.expense_preapprovals where contractor_id = p_id;
  if v_n > 0 then return 'conflict:preapprovals:' || v_n::text; end if;

  -- 5. Hours worked — the payroll record.
  select count(*) into v_n from public.timesheet_entries where contractor_id = p_id;
  if v_n > 0 then return 'conflict:timesheets:' || v_n::text; end if;

  -- Nothing to lose: the cascades now only take this painter's own documents,
  -- events, blocked days, calendar links and cost rates, which is the point.
  --
  -- And the delete is CHECKED. A delete that matches no row removes nothing and
  -- raises nothing, so reporting success on the strength of having run it is
  -- how a row survives a "deleted" message (the same lesson as reading back a
  -- migration instead of assuming it applied).
  delete from public.contractors where id = p_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return 'error:not_deleted'; end if;
  return 'ok:' || coalesce(nullif(trim(v_c.company_name), ''), 'that painter');
end $$;
revoke execute on function public.delete_contractor(uuid) from public, anon;
grant execute on function public.delete_contractor(uuid) to authenticated;

-- ---- read-back ------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_contractor') = 1 as function_ok,
  (select p.prosrc like '%conflict:jobs:%' and p.prosrc like '%conflict:timesheets:%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_contractor') as guards_ok,
  (select p.prosrc like '%not_deleted%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_contractor') as checks_the_delete,
  not has_function_privilege('anon', 'public.delete_contractor(uuid)', 'execute') as anon_refused;

insert into public._prod_migrations(name) values ('20270170000000_delete_contractor.sql') on conflict (name) do nothing;
