-- =============================================================================
-- WO loop — the customer could not see their own job
--
-- The loop tables' customer policy asked:
--
--   exists (select 1 from work_orders w join estimates e … join customers c …)
--
-- but a policy's subquery is ITSELF subject to RLS, and work_orders has only a
-- staff policy and a contractor policy. So the customer's own rows were
-- invisible to them — the EXISTS could never be true. The contractor path
-- happened to work only because work_orders_contractor_read exists.
--
-- The fix is not to let customers read work_orders: that table carries
-- contractor_payment_cents, which no customer may ever see. Instead the
-- ownership question moves into two SECURITY DEFINER helpers that answer it
-- without handing out the row. Policies ask the question; they no longer have
-- to be able to read the evidence.
--
-- Found by asserting reads through each role's OWN session. Every other spec
-- read back through the service key, which bypasses RLS and therefore cannot
-- tell you what a user can see.
-- =============================================================================

create or replace function public.wo_is_my_job_as_contractor(p_wo_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_orders w
     where w.id = p_wo_id
       and w.contractor_id is not null
       and w.contractor_id = public.current_contractor_id()
  );
$$;

create or replace function public.wo_is_my_job_as_customer(p_wo_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_orders w
      join public.estimates e on e.id = w.estimate_id
      join public.customers c on c.id = e.customer_id
     where w.id = p_wo_id and c.profile_id = auth.uid()
  );
$$;

grant execute on function public.wo_is_my_job_as_contractor(uuid) to authenticated;
grant execute on function public.wo_is_my_job_as_customer(uuid) to authenticated;

-- ---- rebuild the per-role policies on top of them ---------------------------
do $$
declare t text;
begin
  foreach t in array array['wo_events','wo_checklist_items','wo_surfaces','wo_photos',
                           'wo_variations','wo_updates','wo_qa_checks','wo_signoff']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_contractor', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated
        using (public.wo_is_my_job_as_contractor(%I.work_order_id))$f$,
      t || '_contractor', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_customer', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated
        using (public.wo_is_my_job_as_customer(%I.work_order_id))$f$,
      t || '_customer', t, t);
  end loop;
end $$;

drop policy if exists warranties_customer on public.warranties;
create policy warranties_customer on public.warranties
  for select to authenticated
  using (public.wo_is_my_job_as_customer(warranties.work_order_id));

-- ---- Verification -----------------------------------------------------------
-- As the customer whose estimate owns a job:
--   select count(*) from wo_updates where work_order_id = '<their job>';   -> > 0
--   select count(*) from work_orders;                                      -> 0
--     (they still cannot read the work order itself — contractor_payment_cents
--      lives there, and the helper answers the question without exposing it)
