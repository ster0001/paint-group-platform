-- =============================================================================
-- Phase B: a signed-in contractor can see their own issued work orders
--
-- Until now `work_orders` was staff-only RLS, so the ONLY way a contractor could
-- reach a job was the anonymous /w/<share_token> link. That works, but it means
-- the portal's Jobs tab has nothing to show and a lost link is a lost job.
--
-- This adds a SELECT policy scoped to the contractor the work order is actually
-- assigned to, and only once it has been ISSUED — a draft work order is staff's
-- working copy and must stay invisible.
--
-- What a contractor can see is still the contractor-safe artifact: wo_snapshot
-- is built by buildWorkOrderDoc() and never contains customer pricing, margin,
-- surname or email. contractor_payment_cents is THEIR pay, which the spec says
-- belongs on the work order.
--
-- Read-only on purpose. Ticking surfaces off is Phase 2 of the work-order work;
-- no INSERT/UPDATE/DELETE policy is granted here.
-- =============================================================================

-- ---- per-area finish level ---------------------------------------------------
-- The estimate carries ONE level of finish (it prices the whole job), but the
-- spec wants a chip per area too — e.g. PG-3 throughout with PG-4 in the living
-- room. Staff set the exceptions on the work order; anything not listed inherits
-- the job's level. Shape: { "<areaId>": "PG-4" }.
alter table public.work_orders
  add column if not exists area_finish jsonb not null default '{}'::jsonb;

drop policy if exists work_orders_contractor_read on public.work_orders;
create policy work_orders_contractor_read on public.work_orders
  for select to authenticated
  using (
    issued_at is not null
    and contractor_id is not null
    and contractor_id = public.current_contractor_id()
  );

-- Same for the per-surface table, so the Phase 2 tick-off UI has a read path
-- ready and the join doesn't silently return nothing.
drop policy if exists work_order_surfaces_contractor_read on public.work_order_surfaces;
create policy work_order_surfaces_contractor_read on public.work_order_surfaces
  for select to authenticated
  using (
    work_order_id in (
      select id from public.work_orders
      where issued_at is not null and contractor_id = public.current_contractor_id()
    )
  );

-- Let a contractor stamp "I've seen it" on their own job. The existing
-- record_work_order_view(token) is token-based for the public link; this is the
-- signed-in equivalent and cannot touch anyone else's row.
create or replace function public.contractor_mark_wo_viewed(p_work_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.work_orders
     set viewed_at = now()
   where id = p_work_order_id
     and issued_at is not null
     and contractor_id = public.current_contractor_id()
     and viewed_at is null;
end $$;

grant execute on function public.contractor_mark_wo_viewed(uuid) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- Signed in as the assigned contractor:
--   select wo_ref, status from public.work_orders;   -- their issued jobs only
-- Signed in as a DIFFERENT contractor: the same query must return zero rows.
-- A draft (issued_at is null) work order must be invisible to both.
