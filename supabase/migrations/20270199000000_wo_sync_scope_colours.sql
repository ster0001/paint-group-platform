-- =============================================================================
-- Colours chosen in the revision working scope reach the job (Tom, 24 Sep
-- 2026: "if colours are added in the revise scope section, after a client has
-- accepted a job, this needs to be updated on the client's profile, as well as
-- for the contractor so it is fully transparent for everybody").
--
-- The customer's Colours tab, the painter's job sheet and the PC Materials
-- card all read work_orders.wo_snapshot (materials + per-surface colour) and
-- the work_orders.colours mirror. The revision builder edits the WORKING
-- SCOPE (wo_working_scopes.working_state) and nothing carried a colour from
-- there to the snapshot — the same gap the level of finish had (20270188) and
-- the contractor rate had (20270194). The builder now saves its computed job
-- sheet on the working state (working_state.woDoc, the shape acceptance
-- freezes) and this RPC folds the COLOUR fields of that sheet into the live
-- snapshot after every save — never money, never scope:
--
--   · a material row already on the sheet (matched by colourKey, else by the
--     bare product while its colour was TBC) takes the working scope's colour
--     name, swatch and colour-match; a named colour is CONFIRMED (the office
--     chose it on an accepted job), a blank one is TBC;
--   · a product×colour new to the sheet is added ONLY when a surface carrying
--     it is on the job already (in the snapshot's areas, or a tick row a
--     signed variation added) — a colour for an unsigned addition waits;
--   · every snapshot surface takes its working-scope twin's colour (by key);
--   · work_orders.colours mirrors name/hex/status per key (the wo_set_material
--     shape), so both readers agree.
--
-- Staff only; a closed job's sheet is final. Idempotent.
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_sync_scope_colours(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype; v_doc jsonb; v_mats jsonb; v_areas jsonb; v_colours jsonb;
  v_m jsonb; v_key text; v_name text; v_hex text; v_match jsonb; v_status text;
  v_idx integer; v_old jsonb; v_changed text[] := '{}'; v_added text[] := '{}';
  v_on_job boolean; v_new jsonb;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select w.* into v_wo
    from public.wo_working_scopes s join public.work_orders w on w.id = s.work_order_id
   where s.estimate_id = p_estimate_id
   for update of w;
  if not found then return 'ok:no_scope'; end if;
  if v_wo.stage = 'closed' then return 'ok:closed'; end if;

  select working_state -> 'woDoc' into v_doc from public.wo_working_scopes where estimate_id = p_estimate_id;
  if v_doc is null or jsonb_typeof(v_doc) <> 'object' then return 'ok:no_doc'; end if;
  if v_wo.wo_snapshot is null or jsonb_typeof(v_wo.wo_snapshot) <> 'object' then return 'ok:no_snapshot'; end if;

  v_mats := coalesce(v_wo.wo_snapshot -> 'materials', '[]'::jsonb);
  v_areas := coalesce(v_wo.wo_snapshot -> 'areas', '[]'::jsonb);
  v_colours := coalesce(v_wo.colours, '{}'::jsonb);

  -- ---- materials -------------------------------------------------------------------
  for v_m in select x from jsonb_array_elements(coalesce(v_doc -> 'materials', '[]'::jsonb)) x
  loop
    if coalesce(v_m ->> 'product', '') = '' then continue; end if;
    v_key := coalesce(v_m ->> 'colourKey', v_m ->> 'product');
    v_name := coalesce(v_m ->> 'colourName', '');
    v_hex := coalesce(v_m ->> 'colourHex', '');
    v_match := v_m -> 'colourMatch';
    v_status := case when v_name <> '' then 'confirmed' else 'tbc' end;

    -- The row on the sheet: same key, else the same product still TBC
    -- (pre-split documents, or a colour decided for the first time).
    select i - 1 into v_idx
      from jsonb_array_elements(v_mats) with ordinality t(m, i)
     where coalesce(m ->> 'colourKey', m ->> 'product') = v_key
     limit 1;
    if v_idx is null then
      select i - 1 into v_idx
        from jsonb_array_elements(v_mats) with ordinality t(m, i)
       where m ->> 'product' = v_m ->> 'product' and coalesce(m ->> 'colourName', '') = ''
       limit 1;
    end if;

    if v_idx is not null then
      v_old := v_mats -> v_idx;
      if coalesce(v_old ->> 'colourName', '') is distinct from v_name
         or coalesce(v_old ->> 'colourHex', '') is distinct from v_hex
         or coalesce(v_old -> 'colourMatch', 'null'::jsonb) is distinct from coalesce(v_match, 'null'::jsonb)
         or coalesce(v_old ->> 'colourKey', '') is distinct from v_key then
        v_new := v_old || jsonb_build_object('colourKey', v_key, 'colourName', v_name, 'colourHex', v_hex,
                                             'colourStatus', v_status, 'colourMatch', v_match);
        v_mats := jsonb_set(v_mats, array[v_idx::text], v_new, false);
        v_colours := v_colours || jsonb_build_object(v_key,
                       coalesce(v_colours -> v_key, '{}'::jsonb)
                       || jsonb_build_object('name', v_name, 'hex', v_hex, 'status', v_status));
        v_changed := v_changed || v_key;
      end if;
    else
      -- New to the sheet: only if a surface painted in it is on the job.
      select exists (
        select 1
          from jsonb_array_elements(coalesce(v_doc -> 'areas', '[]'::jsonb)) a,
               jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s
         where coalesce(s ->> 'colourKey', s ->> 'product') = v_key
           and (exists (select 1 from jsonb_array_elements(v_areas) sa,
                                     jsonb_array_elements(coalesce(sa -> 'surfaces', '[]'::jsonb)) ss
                         where ss ->> 'key' = s ->> 'key')
                or exists (select 1 from public.wo_surfaces r
                            where r.work_order_id = v_wo.id and r.surface_key = s ->> 'key'
                              and not coalesce(r.removed_from_scope, false)))
      ) into v_on_job;
      if v_on_job then
        v_mats := v_mats || jsonb_build_array(v_m || jsonb_build_object('colourKey', v_key, 'colourStatus', v_status));
        v_colours := v_colours || jsonb_build_object(v_key,
                       jsonb_build_object('name', v_name, 'hex', v_hex, 'status', v_status));
        v_added := v_added || v_key;
      end if;
    end if;
  end loop;

  -- ---- surfaces: each snapshot surface takes its working twin's colour (by key) --------
  select coalesce(jsonb_agg(
    a || jsonb_build_object('surfaces', (
      select coalesce(jsonb_agg(
        case when w.twin is not null and coalesce(w.twin ->> 'colourName', '') <> ''
             then st.s || jsonb_build_object('colourName', w.twin ->> 'colourName',
                                             'colourHex', coalesce(w.twin ->> 'colourHex', ''),
                                             'colourKey', coalesce(w.twin ->> 'colourKey', st.s ->> 'colourKey'))
             else st.s end
        order by st.sord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) with ordinality st(s, sord)
      left join lateral (
        select ws as twin
          from jsonb_array_elements(coalesce(v_doc -> 'areas', '[]'::jsonb)) wa,
               jsonb_array_elements(coalesce(wa -> 'surfaces', '[]'::jsonb)) ws
         where ws ->> 'key' = st.s ->> 'key'
         limit 1) w on true))
    order by aord), '[]'::jsonb)
  into v_areas
  from jsonb_array_elements(v_areas) with ordinality at(a, aord);

  if v_mats is distinct from coalesce(v_wo.wo_snapshot -> 'materials', '[]'::jsonb)
     or v_areas is distinct from coalesce(v_wo.wo_snapshot -> 'areas', '[]'::jsonb) then
    update public.work_orders
       set wo_snapshot = jsonb_set(jsonb_set(wo_snapshot, '{materials}', v_mats, true), '{areas}', v_areas, true),
           colours = v_colours
     where id = v_wo.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo.id, 'scope_colours_synced', auth.uid(), 'staff',
              jsonb_build_object('estimate_id', p_estimate_id, 'changed', to_jsonb(v_changed), 'added', to_jsonb(v_added)));
    return 'ok:synced:' || (coalesce(array_length(v_changed, 1), 0) + coalesce(array_length(v_added, 1), 0))::text;
  end if;
  return 'ok:unchanged';
end $$;
revoke execute on function public.wo_sync_scope_colours(uuid) from public, anon;
grant execute on function public.wo_sync_scope_colours(uuid) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_sync_scope_colours') as fn, 1 as _expect_fn,
  (select has_function_privilege('authenticated', 'public.wo_sync_scope_colours(uuid)', 'execute')) as granted, true as _expect_granted,
  (select has_function_privilege('anon', 'public.wo_sync_scope_colours(uuid)', 'execute')) as anon_can, false as _expect_anon_can;

insert into public._prod_migrations(name) values ('20270199000000_wo_sync_scope_colours.sql') on conflict (name) do nothing;
