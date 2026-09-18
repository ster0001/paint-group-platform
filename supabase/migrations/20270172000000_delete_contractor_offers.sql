-- =============================================================================
-- Removing a demo painter that a DECLINED OFFER had locked on the system
-- (Tom, 18 Sep 2026): "they are not required on the system anymore and can be
-- deleted" — refused with "They have been offered WO-OVERLAP2, and that record
-- stays."
--
-- WO-OVERLAP2 is leftover test data (supabase/fixes/revert-forgery-test-
-- acceptance.sql lists it by name), so a painter was undeletable for ever
-- because of a job that was never real.
--
-- The guard was too wide. Its reason is that deleting a painter with HISTORY
-- silently damages records that outlive them: `work_orders.contractor_id` is
-- ON DELETE SET NULL, so their jobs would lose their painter, and nine tables
-- CASCADE. An offer they were sent and did NOT accept is not one of those
-- records — the job it was for either went to someone else or is still waiting,
-- and it keeps its own event trail either way. Nothing is stranded.
--
-- So offers now block only when one was ACCEPTED. Everything else is unchanged:
-- a job of theirs, an assignment, an invoice, an expense, a pre-approval or an
-- hour on a timesheet still refuses by name, and the office suspends instead.
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

  -- 2. Assignments (employed painters) — would CASCADE away. A released one
  --    still counts: it is the record that they were once on that job.
  select w.wo_ref into v_ref from public.wo_assignments a
    join public.work_orders w on w.id = a.work_order_id
   where a.contractor_id = p_id order by a.start_date limit 1;
  if v_ref is not null then return 'conflict:assignments:' || v_ref; end if;

  -- 3. An ACCEPTED offer — they took the job on, which is history worth keeping
  --    even if the work order has since moved on. An offer they declined, let
  --    lapse, or that was withdrawn is NOT: the job keeps its own event trail,
  --    so nothing is stranded by the offer row going with them (Tom, 18 Sep).
  select w.wo_ref into v_ref from public.booking_offers o
    join public.work_orders w on w.id = o.work_order_id
   where o.contractor_id = p_id and o.state = 'accepted'
   order by o.offered_at desc limit 1;
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
  -- events, blocked days, calendar links, cost rates and the offers they never
  -- accepted, which is the point.
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
  (select p.prosrc like '%o.state = ''accepted''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_contractor') as only_accepted_offers_block,
  (select p.prosrc like '%conflict:jobs:%' and p.prosrc like '%conflict:timesheets:%'
     and p.prosrc like '%conflict:assignments:%' and p.prosrc like '%not_deleted%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_contractor') as other_guards_intact,
  not has_function_privilege('anon', 'public.delete_contractor(uuid)', 'execute') as anon_refused,
  -- How many painters this frees up, purely so the number is visible.
  (select count(*) from public.contractors c
    where not exists (select 1 from public.work_orders w where w.contractor_id = c.id)
      and not exists (select 1 from public.wo_assignments a where a.contractor_id = c.id)
      and not exists (select 1 from public.booking_offers o where o.contractor_id = c.id and o.state = 'accepted')
      and exists (select 1 from public.booking_offers o where o.contractor_id = c.id)) as painters_freed;

insert into public._prod_migrations(name) values ('20270172000000_delete_contractor_offers.sql') on conflict (name) do nothing;
