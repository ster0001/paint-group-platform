-- =============================================================================
-- Approved variations become tick items (Tom, 23 Sep 2026: "make the
-- variations tick items").
--
-- Until now an approved addition was a card and a line on the job sheet; the
-- painter's tick list — the thing progress, the before-photo gate and the
-- stage gate all read — still ended at the frozen scope. Now the moment a
-- variation with site work is approved, its rows land in wo_surfaces:
--
--   * a revision-builder addition carries its rows on priced_inputs.surfaces
--     (key "areaId:surfaceId", heading, label — the same shape the seeder
--     takes; lib/revision/diff.ts writes them), one tick row each, grouped
--     under the area's heading exactly as the original scope is;
--   * a contractor-raised (or quick-priced) variation has no keys — it becomes
--     ONE row under the heading "Variations", labelled with the painter's own
--     words, keyed 'variation:<id>' so a re-run cannot duplicate it;
--   * a row struck earlier by a signed credit and now added back is UN-struck,
--     never duplicated (the (work_order_id, surface_key) index is the guard);
--   * no site hours (est_hours 0/null — invoice drift, internal money-only
--     rows) → no tick row; a credit never adds rows (it strikes, 20261116).
--
-- One implementation, a trigger: every path that approves a variation — the
-- customer's signature, the office's internal approval, the employee
-- auto-apply — goes through the same status change, so none can forget.
-- added_by_variation marks the rows, and wo_seed_surfaces keeps them across a
-- re-issue the way it keeps rectification and struck rows.
--
-- Converges on re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the mark ---------------------------------------------------------------
alter table public.wo_surfaces
  add column if not exists added_by_variation uuid references public.wo_variations (id) on delete set null;
create index if not exists wo_surfaces_added_by_variation_idx
  on public.wo_surfaces (added_by_variation) where added_by_variation is not null;

-- ---- 2. apply one variation's rows -----------------------------------------------
create or replace function public.wo_apply_variation_surfaces(p_variation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_rows jsonb; v_sort integer; v_n integer := 0; v_r jsonb;
        v_key text; v_heading text; v_label text;
begin
  select * into v_v from public.wo_variations where id = p_variation_id;
  if not found then return 0; end if;
  if coalesce(v_v.credit, false) then return 0; end if;                 -- a credit strikes, never adds
  if v_v.status not in ('customer_approved', 'contractor_accepted') then return 0; end if;
  if coalesce(v_v.est_hours, 0) <= 0 then return 0; end if;             -- no site work, nothing to tick

  v_rows := coalesce(v_v.priced_inputs -> 'surfaces', '[]'::jsonb);
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
    -- No keyed rows (raised on site, quick-priced): one row in the painter's words.
    v_rows := jsonb_build_array(jsonb_build_object(
      'key', 'variation:' || v_v.id::text,
      'heading', 'Variations',
      'label', coalesce(nullif(trim(v_v.comment), ''), initcap(replace(v_v.category, '_', ' ')))));
  end if;

  select coalesce(max(sort), -1) + 1 into v_sort
    from public.wo_surfaces where work_order_id = v_v.work_order_id;

  for v_r in select * from jsonb_array_elements(v_rows) loop
    v_key := nullif(trim(coalesce(v_r ->> 'key', '')), '');
    v_heading := nullif(trim(coalesce(v_r ->> 'heading', '')), '');
    v_label := nullif(trim(coalesce(v_r ->> 'label', '')), '');
    if v_key is null or v_heading is null or v_label is null then continue; end if;

    insert into public.wo_surfaces
        (work_order_id, heading, heading_meta, label, surface_key, sort, added_by_variation)
      values
        (v_v.work_order_id, v_heading, 'Added by variation', v_label, v_key, v_sort, v_v.id)
      on conflict (work_order_id, surface_key) where surface_key is not null
      do update set removed_from_scope = false,          -- added back after a strike
                    removed_by_variation = null,
                    added_by_variation = coalesce(wo_surfaces.added_by_variation, excluded.added_by_variation),
                    heading = excluded.heading,
                    label = excluded.label;               -- state deliberately untouched
    v_sort := v_sort + 1;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'surfaces_added_by_variation', 'system',
              jsonb_build_object('variation_id', v_v.id, 'rows', v_n, 'hours', v_v.est_hours));
  end if;
  return v_n;
end $$;
revoke all on function public.wo_apply_variation_surfaces(uuid) from public, anon, authenticated;

-- ---- 3. the trigger: every approval path, one implementation ---------------------
create or replace function public.wo_variation_tick_rows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('customer_approved', 'contractor_accepted')
     and (old.status is distinct from 'customer_approved' and old.status is distinct from 'contractor_accepted') then
    perform public.wo_apply_variation_surfaces(new.id);
  end if;
  return new;
end $$;

drop trigger if exists wo_variations_tick_rows on public.wo_variations;
create trigger wo_variations_tick_rows
  after update of status on public.wo_variations
  for each row execute function public.wo_variation_tick_rows();

-- A variation born approved (the office's verbal override / drift path inserts
-- customer_approved directly) — the insert arm.
create or replace function public.wo_variation_tick_rows_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.wo_apply_variation_surfaces(new.id);
  return new;
end $$;

drop trigger if exists wo_variations_tick_rows_insert on public.wo_variations;
create trigger wo_variations_tick_rows_insert
  after insert on public.wo_variations
  for each row when (new.status in ('customer_approved', 'contractor_accepted'))
  execute function public.wo_variation_tick_rows_insert();

-- ---- 4. a re-issue keeps them ----------------------------------------------------
-- 20261116 body verbatim + one line in the delete: a row a variation added is
-- not "gone from the scope" because the frozen document never had it.
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

  -- Gone from the scope and never touched: drop it. A struck row is kept — it
  -- documents the signed removal. A row a variation added is kept — the
  -- document never carried it, the customer's signature did.
  with dropped as (
    delete from public.wo_surfaces s
     where s.work_order_id = p_work_order_id
       and s.surface_key is not null
       and s.rectification = false
       and s.removed_from_scope = false
       and s.added_by_variation is null
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

-- ---- 5. backfill: approved additions on OPEN jobs that have no rows yet ---------
-- Guarded: only variations with site hours, only jobs not closed, only where
-- nothing has been added for that variation. Idempotent by construction.
do $$
declare v record; v_n integer;
begin
  for v in
    select x.id
      from public.wo_variations x
      join public.work_orders w on w.id = x.work_order_id
     where x.status in ('customer_approved', 'contractor_accepted')
       and not coalesce(x.credit, false)
       and coalesce(x.est_hours, 0) > 0
       and w.stage <> 'closed'
       and not exists (select 1 from public.wo_surfaces s where s.added_by_variation = x.id)
  loop
    v_n := public.wo_apply_variation_surfaces(v.id);
  end loop;
end $$;

-- ---- Read-back: compare each column to its _expect_ before calling this live ----
select
  (select count(*) from information_schema.columns
     where table_name = 'wo_surfaces' and column_name = 'added_by_variation')
    as mark_col, 1 as _expect_mark_col,
  (select count(*) from pg_proc where proname in
     ('wo_apply_variation_surfaces', 'wo_variation_tick_rows', 'wo_variation_tick_rows_insert'))
    as fns, 3 as _expect_fns,
  (select count(*) from pg_trigger where tgname in ('wo_variations_tick_rows', 'wo_variations_tick_rows_insert') and not tgisinternal)
    as triggers, 2 as _expect_triggers,
  (select prosrc like '%added_by_variation is null%' from pg_proc where proname = 'wo_seed_surfaces' limit 1)
    as reseed_keeps_added, true as _expect_reseed_keeps_added,
  (select not has_function_privilege('anon', 'public.wo_apply_variation_surfaces(uuid)', 'execute'))
    as apply_is_internal, true as _expect_apply_is_internal,
  (select count(*) from public.wo_surfaces where added_by_variation is not null)
    as rows_added_so_far, '>= 0 (backfill count, informational)' as _expect_rows_added_so_far;

insert into public._prod_migrations(name) values ('20270193000000_variation_tick_rows.sql') on conflict (name) do nothing;
