-- =============================================================================
-- Addendum A3 — the job sheet shows the strike.
--
-- A signed credit marks wo_surfaces.removed_from_scope (20261116) and the
-- portal/console tick lists render it struck-through. The anon job sheet at
-- /w/<token> reads ticks through get_work_order_ticks_by_token, which only
-- returned (surface_key, state) — so a struck surface still looked like plain
-- "Not started" work. Add the flag. Return type changes, so drop first (exact
-- signature — no overload ghosts). Still no money, no names, no measurements.
-- =============================================================================

drop function if exists public.get_work_order_ticks_by_token(text);
create function public.get_work_order_ticks_by_token(p_token text)
returns table (surface_key text, state public.wo_surface_state, removed boolean)
language sql security definer set search_path = public as $$
  select s.surface_key, s.state, s.removed_from_scope
    from public.wo_surfaces s
    join public.work_orders w on w.id = s.work_order_id
   where w.share_token = p_token
     and w.issued_at is not null
     and s.surface_key is not null;
$$;

grant execute on function public.get_work_order_ticks_by_token(text) to anon, authenticated;

-- ---- Verification -----------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute') as anon_may_execute,
       p.prosrc like '%removed_from_scope%' as returns_removed
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'get_work_order_ticks_by_token';
