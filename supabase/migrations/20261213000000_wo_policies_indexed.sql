-- =============================================================================
-- WO loop — the volume gate's RLS disease, on the loop tables this time
--
-- An authenticated user with no contractor/customer link selecting from
-- wo_events (or wo_photos) hit a 57014 statement timeout at the C1 volume
-- seed (100k events / 500k photos). The contractor/customer policies called
-- wo_is_my_job_as_contractor / wo_is_my_job_as_customer — SECURITY DEFINER,
-- evaluated PER ROW — a full scan × function call. Same disease
-- 20261130000000_member_policies_indexed.sql cured on accounts/properties.
--
-- The cure needed one more step here. The accounts fix inverted to an
-- IN-subquery, but its per-role policies still OR together, and an OR of
-- initplan-bool + hashed-subplan probes still costs ~4µs × 500k rows ≈ 3s
-- (measured on C1). The fast shape is ONE select policy whose whole qual is a
-- single IN over a plain subquery — one hashed subplan, ~0.15µs/row: the same
-- bare select measured 73ms, and a keyed read never evaluates the subplan at
-- all.
--
-- A plain subquery on work_orders inside a policy runs under the CALLER's
-- RLS (the 20261009 bug — customers may never read work_orders, contractor
-- pay is on it). So the membership list is an OWNER-RIGHTS VIEW: views with
-- security_invoker = false read their base tables as the view owner
-- (postgres), which bypasses work_orders' RLS the way the SECURITY DEFINER
-- helpers did — but stays a plain subquery the planner can flatten. The view
-- exposes ONE column, the job ids the caller may know about, and nothing
-- else; PostgREST exposing it is harmless for the same reason.
--
-- Grants audited before collapsing policies (30 Aug 2026, C1): the eight loop
-- tables and wo_qa_items give authenticated SELECT only (20261008 revoked
-- writes; everything writes via SECURITY DEFINER RPCs), so their staff
-- FOR-ALL policies gated no writes and can fold into the read policy. The
-- tables with real authenticated write grants (work_orders, wo_booking_notes,
-- wo_walkthroughs, wo_reports) KEEP their staff FOR-ALL policies.
--
-- Visibility is unchanged per role, including the two deliberate asymmetries:
-- wo_qa_items stays contractor+staff only (QA is ours — the customer never
-- sees it) and wo_reports stays customer+staff only (variation prices are
-- customer money — never the contractor's). Those two use role-specific
-- set-returning helpers, not the all-roles view.
--
-- The scalar helpers wo_is_my_job_as_contractor/_as_customer stay — still the
-- right tool for single-row checks.
-- =============================================================================

-- ---- the membership lists ----------------------------------------------------

-- Everyone's answer to "which job ids may I know about?": staff → all,
-- contractor → assigned jobs, customer → jobs on their own estimates. Scalar
-- subselects keep each per-row-free (InitPlans, once per statement).
create or replace view public.wo_visible_jobs
with (security_invoker = false) as
  select w.id from public.work_orders w
   where (select public.is_staff())
      or (w.contractor_id is not null
          and w.contractor_id = (select public.current_contractor_id()))
      or w.estimate_id in (select e.id from public.estimates e
                             join public.customers cu on cu.id = e.customer_id
                            where cu.profile_id = (select auth.uid()));

grant select on public.wo_visible_jobs to authenticated;
revoke all on public.wo_visible_jobs from anon;

-- Role-specific lists for the two asymmetric tables.
create or replace function public.wo_my_job_ids_as_contractor()
returns setof uuid language sql stable security definer set search_path = public as $$
  select w.id from public.work_orders w
   where w.contractor_id is not null
     and w.contractor_id = public.current_contractor_id()
$$;

create or replace function public.wo_my_job_ids_as_customer()
returns setof uuid language sql stable security definer set search_path = public as $$
  select w.id from public.work_orders w
    join public.estimates e on e.id = w.estimate_id
    join public.customers c on c.id = e.customer_id
   where c.profile_id = auth.uid()
$$;

grant execute on function public.wo_my_job_ids_as_contractor() to authenticated;
grant execute on function public.wo_my_job_ids_as_customer()   to authenticated;

-- ---- the eight three-way tables: one read policy each ------------------------
-- SELECT is the only privilege authenticated holds on these, so the staff
-- FOR-ALL policy folds in (staff reads ride the view's is_staff arm).
do $$
declare t text;
begin
  foreach t in array array['wo_events','wo_checklist_items','wo_surfaces','wo_photos',
                           'wo_variations','wo_updates','wo_qa_checks','wo_signoff']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_contractor', t);
    execute format('drop policy if exists %I on public.%I', t || '_customer', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated
        using (%I.work_order_id in (select id from public.wo_visible_jobs))$f$,
      t || '_read', t, t);
  end loop;
end $$;

-- ---- wo_qa_items: contractor + staff ONLY (the customer never sees QA) ------
drop policy if exists wo_qa_items_staff on public.wo_qa_items;
drop policy if exists wo_qa_items_contractor on public.wo_qa_items;
drop policy if exists wo_qa_items_read on public.wo_qa_items;
create policy wo_qa_items_read on public.wo_qa_items
  for select to authenticated
  using (
    (select public.is_staff())
    or wo_qa_items.qa_check_id in (
         select c.id from public.wo_qa_checks c
          where c.work_order_id in (select public.wo_my_job_ids_as_contractor()))
  );

-- ---- wo_walkthroughs: all three read; staff writes are real (grants) --------
drop policy if exists wo_walkthroughs_staff on public.wo_walkthroughs;
create policy wo_walkthroughs_staff on public.wo_walkthroughs
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists wo_walkthroughs_contractor on public.wo_walkthroughs;
drop policy if exists wo_walkthroughs_customer on public.wo_walkthroughs;
drop policy if exists wo_walkthroughs_member on public.wo_walkthroughs;
create policy wo_walkthroughs_member on public.wo_walkthroughs
  for select to authenticated
  using (wo_walkthroughs.work_order_id in (select id from public.wo_visible_jobs));

-- ---- wo_reports: customer + staff ONLY (variation prices are customer money);
--      staff writes are real (grants) ----------------------------------------
drop policy if exists wo_reports_staff on public.wo_reports;
create policy wo_reports_staff on public.wo_reports
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists wo_reports_customer on public.wo_reports;
create policy wo_reports_customer on public.wo_reports
  for select to authenticated
  using (wo_reports.work_order_id in (select public.wo_my_job_ids_as_customer()));

-- ---- warranties: customer + staff, select-only grants -----------------------
drop policy if exists warranties_staff on public.warranties;
drop policy if exists warranties_customer on public.warranties;
drop policy if exists warranties_read on public.warranties;
create policy warranties_read on public.warranties
  for select to authenticated
  using (
    (select public.is_staff())
    or warranties.work_order_id in (select public.wo_my_job_ids_as_customer())
  );

-- ---- staff-only loop tables: InitPlan wrap, shape unchanged -----------------
drop policy if exists wo_booking_notes_staff on public.wo_booking_notes;
create policy wo_booking_notes_staff on public.wo_booking_notes
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists wo_working_scopes_staff_read on public.wo_working_scopes;
create policy wo_working_scopes_staff_read on public.wo_working_scopes
  for select to authenticated using ((select public.is_staff()));

-- ---- work_orders itself: same per-row calls, same wrap ----------------------
-- Staff FOR-ALL stays (staff edit work_orders directly). current_contractor_id()
-- was bare (per row); wrapped it is an InitPlan and the comparison rides the
-- 20260907 contractor index.
drop policy if exists work_orders_staff on public.work_orders;
create policy work_orders_staff on public.work_orders
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists work_orders_contractor_read on public.work_orders;
create policy work_orders_contractor_read on public.work_orders
  for select to authenticated
  using (
    issued_at is not null
    and contractor_id is not null
    and contractor_id = (select public.current_contractor_id())
  );

-- wo_stage_transitions_read is `using (true)` — nothing to invert, untouched.

-- ---- read-back ---------------------------------------------------------------
-- Expect ONE row per table+policy, every row inverted=true (quals name
-- wo_visible_jobs / a wo_my_job_ids helper, or show the wrapped "(SELECT ...)"
-- InitPlan form). The eight loop tables show a single <t>_read policy.
select c.relname as tablename, p.polname,
       (   pg_get_expr(p.polqual, p.polrelid) like '%wo_visible_jobs%'
        or pg_get_expr(p.polqual, p.polrelid) like '%wo_my_job_ids%'
        or pg_get_expr(p.polqual, p.polrelid) like '%(SELECT %'
        or pg_get_expr(p.polqual, p.polrelid) like '%( SELECT %') as inverted
  from pg_policy p join pg_class c on c.oid = p.polrelid
 where c.relname in ('wo_events','wo_checklist_items','wo_surfaces','wo_photos',
                     'wo_variations','wo_updates','wo_qa_checks','wo_signoff',
                     'wo_qa_items','wo_walkthroughs','wo_reports','warranties',
                     'wo_booking_notes','wo_working_scopes','work_orders')
   and p.polname <> 'wo_stage_transitions_read'
 order by 1, 2;
