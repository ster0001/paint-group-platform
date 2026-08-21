-- =============================================================================
-- WO loop — repair the RLS policies on the loop tables
--
-- Symptom: a staff session reads ZERO rows from wo_stage_transitions, whose
-- policy is `using (true)`, while the service role sees all ten. SELECT is
-- granted (a missing grant raises 42501; we get an empty array instead), so the
-- rows are being filtered — and on a `using (true)` policy the only way that
-- happens is if the policy is not there. RLS enabled with no matching policy
-- denies every row and says nothing about it.
--
-- Rather than work out which statement went astray, this recreates every policy
-- the module needs, idempotently. Running it when they already exist is a no-op.
--
-- It ends with a listing so the result can be checked at a glance instead of
-- assumed.
-- =============================================================================

-- ---- the event log and the transition table --------------------------------
alter table public.wo_events            enable row level security;
alter table public.wo_stage_transitions enable row level security;

drop policy if exists wo_events_staff on public.wo_events;
create policy wo_events_staff on public.wo_events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists wo_events_contractor on public.wo_events;
create policy wo_events_contractor on public.wo_events
  for select to authenticated using (
    exists (select 1 from public.work_orders w
             where w.id = wo_events.work_order_id
               and w.contractor_id is not null
               and w.contractor_id = public.current_contractor_id())
  );

drop policy if exists wo_events_customer on public.wo_events;
create policy wo_events_customer on public.wo_events
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = wo_events.work_order_id and c.profile_id = auth.uid())
  );

drop policy if exists wo_stage_transitions_read on public.wo_stage_transitions;
create policy wo_stage_transitions_read on public.wo_stage_transitions
  for select to authenticated using (true);

-- ---- the seven loop tables, three ways each --------------------------------
do $$
declare t text;
begin
  foreach t in array array['wo_checklist_items','wo_surfaces','wo_photos','wo_variations',
                           'wo_updates','wo_qa_checks','wo_signoff']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format($f$create policy %I on public.%I
        for all to authenticated using (public.is_staff()) with check (public.is_staff())$f$,
      t || '_staff', t);

    execute format('drop policy if exists %I on public.%I', t || '_contractor', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (
          exists (select 1 from public.work_orders w
                   where w.id = %I.work_order_id
                     and w.contractor_id is not null
                     and w.contractor_id = public.current_contractor_id()))$f$,
      t || '_contractor', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_customer', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (
          exists (select 1 from public.work_orders w
                    join public.estimates e on e.id = w.estimate_id
                    join public.customers c on c.id = e.customer_id
                   where w.id = %I.work_order_id and c.profile_id = auth.uid()))$f$,
      t || '_customer', t, t);
  end loop;
end $$;

-- ---- warranties -------------------------------------------------------------
alter table public.warranties enable row level security;

drop policy if exists warranties_staff on public.warranties;
create policy warranties_staff on public.warranties
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists warranties_customer on public.warranties;
create policy warranties_customer on public.warranties
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = warranties.work_order_id and c.profile_id = auth.uid())
  );

-- ---- reads granted, writes still revoked ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wo_events','wo_stage_transitions','wo_checklist_items','wo_surfaces',
                           'wo_photos','wo_variations','wo_updates','wo_qa_checks','wo_signoff','warranties']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---- Verification: this should print 3 for most, 1 for the transition table --
select tablename, count(*) as policies, string_agg(policyname, ', ' order by policyname) as names
  from pg_policies
 where schemaname = 'public'
   and tablename in ('wo_events','wo_stage_transitions','wo_checklist_items','wo_surfaces',
                     'wo_photos','wo_variations','wo_updates','wo_qa_checks','wo_signoff','warranties')
 group by tablename
 order by tablename;
