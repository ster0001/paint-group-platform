-- =============================================================================
-- WO completion loop, step 2 — surfaces, ticks and the photo gate
--
-- The tick list is an INDEX into the work-order document, not a second copy of
-- the scope: one row per surface, seeded from the document's own area/surface
-- grouping, carrying no money and no measurements it could contradict.
--
-- THE PHOTO GATE (§4.3) IS A SERVER RULE, NOT A UI HINT. The first tick on an
-- elevation is refused unless a `before` photo exists for that elevation. The UI
-- prompts for the photo first so nobody meets the rule as an error message, but
-- the rule itself lives here, where it cannot be skipped by calling the API
-- directly.
--
-- Tick history is wo_events rows of type 'surface_tick' — the same log the
-- console, the daily update and the completion report already read.
-- =============================================================================

-- Idempotent seeding needs a key to conflict on. surface_key is null for rows a
-- rectification adds (they have no counterpart in the document), so the index is
-- partial.
create unique index if not exists wo_surfaces_key_uidx
  on public.wo_surfaces (work_order_id, surface_key)
  where surface_key is not null;

-- ---- seeding ----------------------------------------------------------------
-- Staff only. Takes rows shaped by lib/workorder/surfaces.ts (heading,
-- headingMeta, label, surfaceKey, sort) — labels and headings only. Re-running
-- refreshes wording and order WITHOUT resetting anybody's ticks, so re-issuing a
-- work order can never wipe a day's work off a painter's phone.
create or replace function public.wo_seed_surfaces(p_work_order_id uuid, p_rows jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then return 'error:bad_rows'; end if;

  insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
  select p_work_order_id,
         r->>'heading',
         coalesce(r->>'headingMeta', ''),
         r->>'label',
         nullif(r->>'surfaceKey', ''),
         coalesce((r->>'sort')::integer, 0)
    from jsonb_array_elements(p_rows) r
   where nullif(r->>'heading', '') is not null
     and nullif(r->>'label', '') is not null
  on conflict (work_order_id, surface_key) where surface_key is not null
  do update set heading = excluded.heading,
                heading_meta = excluded.heading_meta,
                label = excluded.label,
                sort = excluded.sort;   -- state deliberately untouched

  get diagnostics v_count = row_count;
  return 'ok:' || v_count::text;
end $$;
grant execute on function public.wo_seed_surfaces(uuid, jsonb) to authenticated;

-- ---- has this elevation got its before-photo? -------------------------------
create or replace function public.wo_has_before_photo(p_work_order_id uuid, p_heading text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.wo_photos p
     where p.work_order_id = p_work_order_id
       and p.kind = 'before'
       and (p.area = p_heading
            or p.surface_id in (select id from public.wo_surfaces
                                 where work_order_id = p_work_order_id and heading = p_heading))
  );
$$;

-- ---- the tick ---------------------------------------------------------------
-- Any state to any state: a mis-tap needs an undo, and every move is logged, so
-- correcting one is honest rather than hidden. What is NOT negotiable is the
-- before-photo on the elevation's first tick.
create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  -- Ticking only makes sense while the job is being worked. QA fails and
  -- walkthrough flags both return the job to in_progress, which is exactly why
  -- rectification uses this same list rather than a parallel one.
  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- The gate: is anything on this elevation already under way?
  select not exists (
    select 1 from public.wo_surfaces
     where work_order_id = v_s.work_order_id and heading = v_s.heading and state <> 'todo'
  ) into v_first_tick;

  if v_first_tick and p_to <> 'todo'
     and not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
    return 'error:before_photo_required:' || v_s.heading;
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

-- ---- recording a photo ------------------------------------------------------
-- Called AFTER the server has validated the staged bytes (magic-byte check, the
-- remediated upload path). The path is a location in the private wo-photos
-- bucket, never a public URL.
create or replace function public.wo_record_photo(
  p_work_order_id uuid, p_kind public.wo_photo_kind, p_storage_path text,
  p_surface_id uuid default null, p_area text default '', p_caption text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if coalesce(trim(p_storage_path), '') = '' then return 'error:no_path'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  insert into public.wo_photos (work_order_id, surface_id, area, kind, storage_path, caption, taken_by)
    values (p_work_order_id, p_surface_id, coalesce(p_area, ''), p_kind, p_storage_path,
            coalesce(p_caption, ''), auth.uid())
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'photo', auth.uid(), v_kind,
            jsonb_build_object('photo_id', v_id, 'kind', p_kind::text,
                               'area', coalesce(p_area, ''), 'surface_id', p_surface_id));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_record_photo(uuid, public.wo_photo_kind, text, uuid, text, text) to authenticated;

-- ---- step 2 fills its gate --------------------------------------------------
-- Leaving in_progress now requires every surface DONE. Rectification surfaces
-- are ordinary rows in the same list, so a QA fail genuinely re-closes this gate.
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer;
begin
  if p_from = 'in_progress' and p_to in ('qa', 'completion_prep') then
    select count(*), count(*) filter (where state = 'done')
      into v_total, v_done
      from public.wo_surfaces where work_order_id = p_wo_id;

    -- No tick list at all (a job issued before step 2, or never seeded) must not
    -- become an unpassable gate — that would strand live jobs.
    if v_total > 0 and v_done < v_total then
      return (v_total - v_done)::text || ' of ' || v_total::text || ' surfaces still to tick off';
    end if;
  end if;

  -- step 3 fills: any forward move        (no variation awaiting either approval)
  -- step 5 fills: qa -> completion_prep   (all due checks passed)
  --              completion_prep -> walkthrough (prep checklist ticked)
  --              walkthrough -> closed     (every area approved + signed)
  return null;
end $$;

-- ---- Verification -----------------------------------------------------------
-- As the assigned contractor, on a job at stage in_progress with a seeded list:
--   select public.wo_tick_surface('<a surface with no before photo>', 'prepped');
--     -> 'error:before_photo_required:Front'   and the row is unchanged
--   select public.wo_record_photo('<wo id>', 'before', 'wo/<id>/front-1.jpg', null, 'Front');
--     -> 'ok:<uuid>'
--   select public.wo_tick_surface('<that surface>', 'prepped');   -> 'ok:prepped'
--   select type, meta->>'from', meta->>'to' from wo_events
--    where type = 'surface_tick' order by created_at desc limit 1;   -> todo | prepped
-- With one surface still todo:
--   select public.wo_advance_stage('<wo id>', 'completion_prep');
--     -> 'error:gate:1 of 34 surfaces still to tick off'
