-- =============================================================================
-- WO loop — re-seeding must REMOVE what the scope no longer has
--
-- 20260930's wo_seed_surfaces inserted and refreshed, but never deleted. So a
-- surface staff removed from the estimate stayed on the painter's tick list for
-- ever, and the "3 surfaces · 2 coats · PG-3" heading kept counting it. Tom's
-- condition on accepting that summary line instead of the mockup's measurements
-- was precisely that the numbers look after themselves when the scope is edited
-- in the back end — so they have to.
--
-- What is removed is deliberately narrow: only rows the incoming document no
-- longer contains, that are still `todo`, and that nobody raised as
-- rectification. A surface someone has already prepped or finished is WORK THAT
-- HAPPENED; an edit to the estimate does not get to erase it from the record.
-- Those rows stay, and the removal is logged either way.
-- =============================================================================

create or replace function public.wo_seed_surfaces(p_work_order_id uuid, p_rows jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_upserted integer; v_removed integer; v_kept integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then return 'error:bad_rows'; end if;

  create temp table _seed on commit drop as
  select r->>'heading' as heading,
         coalesce(r->>'headingMeta', '') as heading_meta,
         r->>'label' as label,
         nullif(r->>'surfaceKey', '') as surface_key,
         coalesce((r->>'sort')::integer, 0) as sort
    from jsonb_array_elements(p_rows) r
   where nullif(r->>'heading', '') is not null
     and nullif(r->>'label', '') is not null;

  insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
  select p_work_order_id, heading, heading_meta, label, surface_key, sort from _seed
  on conflict (work_order_id, surface_key) where surface_key is not null
  do update set heading = excluded.heading,
                heading_meta = excluded.heading_meta,
                label = excluded.label,
                sort = excluded.sort;   -- state deliberately untouched
  get diagnostics v_upserted = row_count;

  -- Gone from the scope and never touched: drop it.
  with dropped as (
    delete from public.wo_surfaces s
     where s.work_order_id = p_work_order_id
       and s.surface_key is not null
       and s.rectification = false
       and s.state = 'todo'
       and not exists (select 1 from _seed z where z.surface_key = s.surface_key)
    returning s.id
  )
  select count(*) into v_removed from dropped;

  -- Gone from the scope but already worked: kept, and said out loud.
  select count(*) into v_kept
    from public.wo_surfaces s
   where s.work_order_id = p_work_order_id
     and s.surface_key is not null
     and s.state <> 'todo'
     and not exists (select 1 from _seed z where z.surface_key = s.surface_key);

  if v_removed > 0 or v_kept > 0 then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'surfaces_reseeded', auth.uid(), 'staff',
              jsonb_build_object('removed', v_removed, 'kept_because_worked', v_kept));
  end if;

  return 'ok:' || v_upserted::text || ':removed=' || v_removed::text || ':kept=' || v_kept::text;
end $$;
grant execute on function public.wo_seed_surfaces(uuid, jsonb) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- Edit an issued estimate: delete one untouched surface, re-issue.
--   select heading, heading_meta, label, state from wo_surfaces
--    where work_order_id = '<id>' order by sort;
--     -> the deleted surface is gone and heading_meta's count has dropped
-- Now tick a surface, delete THAT one from the estimate, re-issue:
--     -> it is still listed, and wo_events has a 'surfaces_reseeded' row with
--        kept_because_worked = 1
