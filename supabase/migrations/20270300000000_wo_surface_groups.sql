-- Work order UX, Step 1 (docs/briefs/claude-code-brief-work-order-ux.md §4.1, 24 Oct 2026):
-- the bulk tick of the By surface view and its undo.
--
-- One painter tap marks one SURFACE GROUP (all the walls, all the ceilings…) across
-- every room, writing exactly the per-room tick rows a loop of single ticks would
-- (ruling R4) plus one parent event, skipping rooms already at or past the target
-- (R5), refusing Painted until every room is Prepped (R3), and failing the whole
-- call on the before-photo gate exactly as the single tick does. A 6-second Undo
-- on the screen calls wo_untick_bulk, valid for 60 s and only for the same user (R6).
--
-- The GROUP of a row is resolved in ONE place: wo_surface_groups_assign, which
-- reads the frozen job sheet (the rate code of the line, else its label) through the
-- finish-standards mapping (standards_surface_codes → standards_surfaces.key →
-- surface_group_keys) and stores wo_surfaces.group_code. wo_seed_surfaces calls
-- it after every seed; this migration runs it once over every open job. Nothing
-- in TypeScript computes a group — lib/workorder/surfaceGroups.ts reads the
-- column and holds the labels, pinned to this file by surfaceGroups.test.ts.
set lock_timeout = '15s';

-- ---- 1. the groups and the key map -----------------------------------------------------------
create table if not exists public.surface_groups (
  group_code    text primary key check (group_code ~ '^[a-z_]+$'),
  wording       text not null,   -- what the customer reads (doors, frames and skirting boards)
  painter_label text not null,   -- the row on the By surface view (Doors, frames and skirting)
  sort          integer not null default 0
);
alter table public.surface_groups enable row level security;
drop policy if exists surface_groups_read on public.surface_groups;
create policy surface_groups_read on public.surface_groups
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
revoke all on public.surface_groups from anon;
revoke insert, update, delete on public.surface_groups from authenticated;
grant select on public.surface_groups to authenticated;

insert into public.surface_groups (group_code, wording, painter_label, sort) values
  ('ceilings',     'ceilings',                          'Ceilings',                 1),
  ('walls',        'walls',                             'Walls',                    2),
  ('trims',        'doors, frames and skirting boards', 'Doors, frames & skirting', 3),
  ('windows',      'windows',                           'Windows',                  4),
  ('ext_body',     'weatherboards and render',          'Weatherboards & render',   5),
  ('ext_trim',     'trims, fascias and eaves',          'Trims, fascias & eaves',   6),
  ('ext_openings', 'doors and windows',                 'Doors & windows',          7),
  ('ext_fence',    'fences and gates',                  'Fences & gates',           8)
on conflict (group_code) do update
  set wording = excluded.wording, painter_label = excluded.painter_label, sort = excluded.sort;

-- standards_surfaces.key → group (brief §4.3 and the Step 0 report §5).
create table if not exists public.surface_group_keys (
  standards_key text primary key,
  group_code    text not null references public.surface_groups (group_code) on delete cascade
);
alter table public.surface_group_keys enable row level security;
drop policy if exists surface_group_keys_read on public.surface_group_keys;
create policy surface_group_keys_read on public.surface_group_keys
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
revoke all on public.surface_group_keys from anon;
revoke insert, update, delete on public.surface_group_keys from authenticated;
grant select on public.surface_group_keys to authenticated;

insert into public.surface_group_keys (standards_key, group_code) values
  ('ceilings', 'ceilings'), ('cornices', 'ceilings'),
  ('walls', 'walls'),
  ('skirting', 'trims'), ('architraves', 'trims'), ('doors', 'trims'),
  ('windowframes', 'windows'),
  ('weatherboards', 'ext_body'), ('brick', 'ext_body'), ('render', 'ext_body'),
  ('fascias', 'ext_trim'), ('eaves', 'ext_trim'), ('strapping', 'ext_trim'), ('fretwork', 'ext_trim'),
  ('extdoors', 'ext_openings'), ('extwindows', 'ext_openings'),
  ('picket', 'ext_fence')
on conflict (standards_key) do update set group_code = excluded.group_code;

-- ---- 2. the column ---------------------------------------------------------------------------
alter table public.wo_surfaces
  add column if not exists group_code text references public.surface_groups (group_code) on delete set null;
create index if not exists wo_surfaces_group_idx
  on public.wo_surfaces (work_order_id, group_code) where group_code is not null;

-- ---- 3. the one resolver ---------------------------------------------------------------------
-- The same precedence as lib/standards/model.ts resolveSurface: the rate code of the line,
-- else its label as a rate code, else its label as a surface name; a code that exists
-- on both sides of the card (the three window codes) is told apart by the side of the area,
-- else by the side the other lines of the area agree on, else interior. Rows with
-- no surface_key (rectification, variation additions) are never grouped. Helper:
-- called by wo_seed_surfaces and by this migration; no grant.
create or replace function public.wo_surface_groups_assign(p_work_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; v_ver uuid; v_n integer := 0;
begin
  select wo_snapshot into v_snap from public.work_orders where id = p_work_order_id;
  if v_snap is null then return 0; end if;
  select id into v_ver from public.standards_versions where published_at is not null
   order by version_no desc limit 1;
  if v_ver is null then return 0; end if;

  with doc as (
    select s->>'key' as surface_key,
           lower(trim(coalesce(s->>'code', ''))) as code,
           lower(trim(coalesce(s->>'label', ''))) as label,
           nullif(a->>'side', '') as side,
           a->>'id' as area_id
      from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb)) a
      cross join lateral jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s
     where nullif(s->>'key', '') is not null
  ),
  lines as (
    select * from doc
    union all
    -- a keyed row the frozen document no longer carries (re-issued, healed, or a
    -- document frozen without lines): its own label is all there is to go on
    select w.surface_key, '' as code, lower(trim(w.label)) as label, null::text as side, w.heading as area_id
      from public.wo_surfaces w
     where w.work_order_id = p_work_order_id and w.surface_key is not null
       and not exists (select 1 from doc d where d.surface_key = w.surface_key)
  ),
  cand as (
    select l.surface_key, l.area_id, l.side, ss.key as std_key, ss.side as std_side,
           least(
             case when l.code <> '' and exists (select 1 from public.standards_surface_codes c
                     where c.surface_id = ss.id and lower(trim(c.substrate_code)) = l.code) then 1 end,
             case when l.label <> '' and exists (select 1 from public.standards_surface_codes c
                     where c.surface_id = ss.id and lower(trim(c.substrate_code)) = l.label) then 2 end,
             case when l.label <> '' and lower(trim(ss.name)) = l.label then 3 end) as rank
      from lines l
      join public.standards_surfaces ss on ss.version_id = v_ver
  ),
  best as (
    select * from (
      select c.*, min(c.rank) over (partition by c.surface_key) as best_rank
        from cand c where c.rank is not null) x
     where x.rank = x.best_rank
  ),
  counts as (select surface_key, count(*) as n from best group by surface_key),
  leaning as (
    -- the side the OTHER unambiguous lines of an area agree on
    select b.surface_key,
           (select case when count(distinct b2.std_side) = 1 then min(b2.std_side) end
              from best b2 join counts c2 on c2.surface_key = b2.surface_key and c2.n = 1
             where b2.area_id = b.area_id and b2.surface_key <> b.surface_key) as inferred
      from best b group by b.surface_key, b.area_id
  ),
  pick as (
    select distinct on (b.surface_key) b.surface_key, b.std_key
      from best b
      join counts c on c.surface_key = b.surface_key
      left join leaning le on le.surface_key = b.surface_key
     order by b.surface_key,
              case when c.n = 1 then 0
                   when b.std_side = coalesce(b.side, le.inferred, 'interior') then 0 else 1 end,
              b.std_key
  )
  update public.wo_surfaces w
     set group_code = k.group_code
    from public.wo_surfaces w2
    left join pick p on p.surface_key = w2.surface_key
    left join public.surface_group_keys k on k.standards_key = p.std_key
   where w.id = w2.id
     and w2.work_order_id = p_work_order_id
     and w2.surface_key is not null
     and w.group_code is distinct from k.group_code;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---- 4. the seeder assigns groups after every seed -------------------------------------------
-- 20270193 body verbatim + the one perform before the return.
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

  -- Work order UX Step 1: every seeded row learns its customer group here, and only here.
  perform public.wo_surface_groups_assign(p_work_order_id);

  return 'ok:' || v_upserted::text || ':removed=' || v_removed::text || ':kept=' || v_kept::text;
end $$;
grant execute on function public.wo_seed_surfaces(uuid, jsonb) to authenticated;

-- ---- 5. the bulk tick ------------------------------------------------------------------------
-- Returns jsonb: {ok, parent_event_id, count, surface_ids} or {error}. Per changed row the
-- SAME update and the SAME surface_tick event wo_tick_surface writes (meta gains
-- bulk_event_id), then one surface_group_ticked parent carrying the child ids.
create or replace function public.wo_tick_surface_group(p_work_order_id uuid, p_group_code text, p_to public.wo_surface_state)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_parent uuid; v_r record; v_eid uuid;
        v_child_ids uuid[] := '{}'; v_surface_ids uuid[] := '{}'; v_all_done boolean;
        v_order text[] := array['todo', 'prepped', 'done'];
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  -- The actor rules of wo_tick_surface, word for word.
  if public.is_staff() then
    v_kind := 'staff';
  elsif public.wo_worker_on_job(v_wo.id) then
    v_kind := 'worker';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return jsonb_build_object('error', 'not_yours'); end if;
    v_kind := 'contractor';
  end if;

  if v_wo.stage <> 'in_progress' then
    return jsonb_build_object('error', 'not_in_progress:' || v_wo.stage::text);
  end if;
  -- A bulk tap only moves work forward; going back is a per-room decision.
  if p_to not in ('prepped', 'done') then return jsonb_build_object('error', 'bad_target'); end if;

  if not exists (select 1 from public.wo_surfaces s
                  where s.work_order_id = p_work_order_id and s.group_code = p_group_code
                    and not coalesce(s.removed_from_scope, false)) then
    return jsonb_build_object('error', 'no_rows');
  end if;

  -- R3: Painted waits until every room of this surface is at least Prepped.
  if p_to = 'done' and exists (select 1 from public.wo_surfaces s
                                where s.work_order_id = p_work_order_id and s.group_code = p_group_code
                                  and not coalesce(s.removed_from_scope, false) and s.state = 'todo') then
    return jsonb_build_object('error', 'not_all_prepped');
  end if;

  -- The before-photo gate, once for the job (20270207): if any row that would move
  -- asks for photos and the job has none, the whole call fails and nothing is written.
  if exists (select 1 from public.wo_surfaces s
              where s.work_order_id = p_work_order_id and s.group_code = p_group_code
                and not coalesce(s.removed_from_scope, false)
                and array_position(v_order, s.state::text) < array_position(v_order, p_to::text)
                and not coalesce(s.photos_optional, false))
     and not public.wo_has_job_photo(p_work_order_id, 'before') then
    return jsonb_build_object('error', 'before_photo_required:job');
  end if;

  v_parent := gen_random_uuid();
  for v_r in
    select s.* from public.wo_surfaces s
     where s.work_order_id = p_work_order_id and s.group_code = p_group_code
       and not coalesce(s.removed_from_scope, false)
       and array_position(v_order, s.state::text) < array_position(v_order, p_to::text)   -- R5
     order by s.sort
       for update
  loop
    update public.wo_surfaces set state = p_to, state_changed_at = now() where id = v_r.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'surface_tick', auth.uid(), v_kind,
              jsonb_build_object('surface_id', v_r.id, 'heading', v_r.heading, 'label', v_r.label,
                                 'from', v_r.state::text, 'to', p_to::text, 'bulk_event_id', v_parent))
      returning id into v_eid;
    v_child_ids := v_child_ids || v_eid;
    v_surface_ids := v_surface_ids || v_r.id;
  end loop;

  -- Every room already there: not an error, nothing written, nothing to undo.
  if coalesce(array_length(v_child_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'parent_event_id', null, 'count', 0, 'surface_ids', '[]'::jsonb);
  end if;

  insert into public.wo_events (id, work_order_id, type, actor, actor_kind, meta)
    values (v_parent, p_work_order_id, 'surface_group_ticked', auth.uid(), v_kind,
            jsonb_build_object('group_code', p_group_code, 'target_state', p_to::text,
                               'count', array_length(v_child_ids, 1),
                               'child_event_ids', to_jsonb(v_child_ids), 'surface_ids', to_jsonb(v_surface_ids)));

  -- Dashboard 0c, as the single tick does: the tick that finishes the JOB is one row, once.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = p_work_order_id
         and not coalesce(removed_from_scope, false) and state <> 'done'
    ) into v_all_done;
    if v_all_done and not exists (
      select 1 from public.wo_events where work_order_id = p_work_order_id and type = 'all_surfaces_done'
    ) then
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (p_work_order_id, 'all_surfaces_done', auth.uid(), v_kind,
                jsonb_build_object('last_surface_id', v_surface_ids[array_length(v_surface_ids, 1)], 'bulk_event_id', v_parent));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'parent_event_id', v_parent, 'count', array_length(v_child_ids, 1),
                            'surface_ids', to_jsonb(v_surface_ids));
end $$;
grant execute on function public.wo_tick_surface_group(uuid, text, public.wo_surface_state) to authenticated;

-- ---- 6. the undo -----------------------------------------------------------------------------
-- Reverts the rows a bulk tap wrote — only rows still where that tap left them, only within
-- 60 s, only for the user who tapped. Each reverted row gets the surface_tick the painter
-- would have written tapping it back by hand (so the draft update of the day re-reads correctly),
-- then one surface_group_untick parent. Events are never deleted; all_surfaces_done, once
-- written, stays (the rule of the single tick).
create or replace function public.wo_untick_bulk(p_parent_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p public.wo_events%rowtype; v_c public.wo_events%rowtype; v_sid uuid; v_n integer := 0; v_sids uuid[] := '{}';
begin
  select * into v_p from public.wo_events where id = p_parent_event_id and type = 'surface_group_ticked';
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_p.actor is distinct from auth.uid() then return jsonb_build_object('error', 'not_yours'); end if;
  if v_p.created_at < now() - interval '60 seconds' then return jsonb_build_object('error', 'too_late'); end if;
  if exists (select 1 from public.wo_events e
              where e.work_order_id = v_p.work_order_id and e.type = 'surface_group_untick'
                and e.meta->>'parent_event_id' = p_parent_event_id::text) then
    return jsonb_build_object('ok', true, 'already', true, 'count', 0, 'surface_ids', '[]'::jsonb);
  end if;

  for v_c in
    select e.* from public.wo_events e
     where e.id in (select (jsonb_array_elements_text(v_p.meta->'child_event_ids'))::uuid)
     order by e.created_at
  loop
    v_sid := (v_c.meta->>'surface_id')::uuid;
    update public.wo_surfaces
       set state = (v_c.meta->>'from')::public.wo_surface_state, state_changed_at = now()
     where id = v_sid and state::text = v_c.meta->>'to';
    if found then
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_p.work_order_id, 'surface_tick', auth.uid(), v_p.actor_kind,
                jsonb_build_object('surface_id', v_sid, 'heading', v_c.meta->>'heading', 'label', v_c.meta->>'label',
                                   'from', v_c.meta->>'to', 'to', v_c.meta->>'from',
                                   'undo_of', v_c.id, 'bulk_event_id', p_parent_event_id));
      v_n := v_n + 1;
      v_sids := v_sids || v_sid;
    end if;
  end loop;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_p.work_order_id, 'surface_group_untick', auth.uid(), v_p.actor_kind,
            jsonb_build_object('parent_event_id', p_parent_event_id, 'group_code', v_p.meta->>'group_code',
                               'count', v_n, 'surface_ids', to_jsonb(v_sids)));

  return jsonb_build_object('ok', true, 'count', v_n, 'surface_ids', to_jsonb(v_sids));
end $$;
grant execute on function public.wo_untick_bulk(uuid) to authenticated;

-- ---- 7. backfill every open job, then read back — compare to the _expect_ values -----------
with backfill as (
  select public.wo_surface_groups_assign(w.id) as n
    from public.work_orders w
   where w.issued_at is not null and w.stage <> 'closed'
)
select
  (select count(*) from public.surface_groups) as groups, 8 as _expect_groups,
  (select count(*) from public.surface_group_keys) as keys, 17 as _expect_keys,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('wo_surface_groups_assign', 'wo_tick_surface_group', 'wo_untick_bulk')) as fns, 3 as _expect_fns,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema = 'public' and grantee = 'authenticated'
       and routine_name in ('wo_tick_surface_group', 'wo_untick_bulk', 'wo_seed_surfaces')) as grants, 3 as _expect_grants,
  (select count(*) from pg_policies where tablename in ('surface_groups', 'surface_group_keys')) as policies, 2 as _expect_policies,
  (select coalesce(sum(n), 0) from backfill) as rows_grouped_now,
  (select count(*) from public.wo_surfaces where group_code is not null) as rows_with_group;

insert into public._prod_migrations(name) values ('20270300000000_wo_surface_groups.sql') on conflict (name) do nothing;
