-- =============================================================================
-- The job sheet reads the ticks, not the frozen copy of the scope
--
-- `wo_snapshot` carries a `status` on every surface. It is written once, when
-- the order is issued, and never again — so the job sheet at /w/<token> says
-- "Not started" over an elevation the painter finished last week. The truth
-- lives in `wo_surfaces.state`, which the tick list writes.
--
-- The token route is ANON: it holds no session, so it cannot read wo_surfaces
-- (RLS scopes that to staff, the assigned contractor and the job's customer).
-- This is the same shape as get_work_order_by_token — a security-definer read,
-- keyed by the share token, for ISSUED orders only, returning nothing but a
-- surface key and its state. No money, no names, no measurements: there is
-- nothing here a contractor's own job sheet does not already show.
-- =============================================================================

create or replace function public.get_work_order_ticks_by_token(p_token text)
returns table (surface_key text, state public.wo_surface_state)
language sql security definer set search_path = public as $$
  select s.surface_key, s.state
    from public.wo_surfaces s
    join public.work_orders w on w.id = s.work_order_id
   where w.share_token = p_token
     and w.issued_at is not null
     and s.surface_key is not null;
$$;

grant execute on function public.get_work_order_ticks_by_token(text) to anon, authenticated;

-- ---- Verification -----------------------------------------------------------
-- Reads back what this file just made. A migration "running" is not the same as
-- its statements applying — check the output says one row, not zero.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_may_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'get_work_order_ticks_by_token';

-- Then, with a real issued work order's token:
--   select * from public.get_work_order_ticks_by_token('<share_token>');
-- -> one row per surface, and a surface the painter has ticked reads 'done'.
