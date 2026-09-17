-- =============================================================================
-- Employed painters — Session 4b: the whole crew can work the job (ruling 6)
--
-- Every painter-side RPC used to ask "is this painter the work order's
-- contractor_id?" — which, since 20270154, is only the LEAD. A second employee
-- on the same job could see the tick list (wo_visible_jobs) but every tick,
-- photo, checklist answer and note came back error:not_yours. Ruling 6 says
-- everyone assigned can update scope.
--
-- The one question, asked once: wo_painter_on_job(work_order, painter) =
-- the lead, or anyone assigned and not released. The five painter RPCs below
-- are their LIVE definitions (pg_get_functiondef on the test project, which
-- matches production for these files) with that single test swapped — no
-- body was retyped from memory. The two money RPCs that carry the same test
-- (contractor_invoice_request, wo_contractor_accept_variation) are left
-- lead-only on purpose: an employee never invoices or accepts an adjusted
-- offer, and a contractor's crew never has.
-- =============================================================================

create or replace function public.wo_painter_on_job(p_work_order_id uuid, p_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_contractor_id is not null and (
    exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.contractor_id = p_contractor_id)
    or exists (select 1 from public.wo_assignments a
                where a.work_order_id = p_work_order_id and a.contractor_id = p_contractor_id and a.status <> 'released')
  )
$$;
grant execute on function public.wo_painter_on_job(uuid, uuid) to authenticated;

-- The scalar helper the single-row policies and the storage bucket use.
create or replace function public.wo_is_my_job_as_contractor(p_wo_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.wo_painter_on_job(p_wo_id, public.current_contractor_id())
$$;

-- ---- wo_tick_surface (live definition, ownership test widened) ----
CREATE OR REPLACE FUNCTION public.wo_tick_surface(p_surface_id uuid, p_to wo_surface_state)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean; v_completes boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  -- Struck by a signed credit: display-only from here on.
  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
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

  -- The other end (Tom, 1 Sep): the tick that would finish the area needs the
  -- finished shot on record first. Removed rows don't count — an area whose
  -- only unticked rows were struck by a signed credit is finished.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id and heading = v_s.heading
         and id <> v_s.id and not coalesce(removed_from_scope, false)
         and state <> 'done'
    ) into v_completes;
    if v_completes and not public.wo_has_after_photo(v_s.work_order_id, v_s.heading) then
      return 'error:after_photo_required:' || v_s.heading;
    end if;
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  return 'ok:' || p_to::text;
end $function$;

-- ---- wo_record_photo (live definition, ownership test widened) ----
CREATE OR REPLACE FUNCTION public.wo_record_photo(p_work_order_id uuid, p_kind wo_photo_kind, p_storage_path text, p_surface_id uuid DEFAULT NULL::uuid, p_area text DEFAULT ''::text, p_caption text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if coalesce(trim(p_storage_path), '') = '' then return 'error:no_path'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
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
end $function$;

-- ---- wo_tick_checklist_item (live definition, ownership test widened) ----
CREATE OR REPLACE FUNCTION public.wo_tick_checklist_item(p_item_id uuid, p_done boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_i public.wo_checklist_items%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
begin
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_i.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_i.auto_key is not null then return 'error:derived:' || v_i.auto_key; end if;
  -- NEW: questions are answered through wo_answer_checklist_item.
  if v_i.kind <> 'tick' then return 'error:answer_required'; end if;

  if p_done and v_i.label = 'Materials ordered' and not exists (
    select 1 from public.wo_checklist_items c
     where c.work_order_id = v_i.work_order_id and c.phase = 'pre_start'
       and c.label = 'Colour schedule finalised' and c.done_at is not null
  ) then
    return 'error:colours_first';
  end if;

  update public.wo_checklist_items
     set done_at = case when p_done then now() else null end,
         done_by = case when p_done then auth.uid() else null end
   where id = p_item_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_i.work_order_id, 'checklist_ticked', auth.uid(), v_kind,
            jsonb_build_object('item_id', p_item_id, 'label', v_i.label,
                               'phase', v_i.phase::text, 'done', p_done));

  return 'ok:' || case when p_done then 'done' else 'undone' end;
end $function$;

-- ---- wo_answer_checklist_item (live definition, ownership test widened) ----
CREATE OR REPLACE FUNCTION public.wo_answer_checklist_item(p_item_id uuid, p_answer text DEFAULT NULL::text, p_note text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_i public.wo_checklist_items%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_done boolean;
begin
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_i.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_i.kind = 'tick' then return 'error:not_a_question'; end if;

  if v_i.kind = 'yes_no' then
    if p_answer is null or p_answer not in ('yes', 'no') then return 'error:bad_answer'; end if;
    if v_i.item_key = 'equipment' and p_answer = 'yes' and length(trim(coalesce(p_note, ''))) = 0 then
      return 'error:list_required';
    end if;
    update public.wo_checklist_items
       set answer = p_answer,
           answer_note = case when p_answer = 'yes' then coalesce(p_note, '') else '' end,
           done_at = now(), done_by = auth.uid(),
           -- A changed answer re-opens the office prompt.
           handled_at = null, handled_by = null
     where id = p_item_id;
    v_done := true;
  else -- note
    v_done := length(trim(coalesce(p_note, ''))) > 0;
    update public.wo_checklist_items
       set answer_note = coalesce(p_note, ''),
           done_at = case when v_done then now() end,
           done_by = case when v_done then auth.uid() end
     where id = p_item_id;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_i.work_order_id, 'checklist_answered', auth.uid(), v_kind,
            jsonb_build_object('item_id', p_item_id, 'label', v_i.label, 'item_key', v_i.item_key,
                               'phase', v_i.phase::text, 'answer', p_answer,
                               'note', left(coalesce(p_note, ''), 500), 'done', v_done));

  return 'ok:' || coalesce(p_answer, case when v_done then 'noted' else 'cleared' end);
end $function$;

-- ---- wo_add_note (live definition, ownership test widened) ----
CREATE OR REPLACE FUNCTION public.wo_add_note(p_work_order_id uuid, p_note text, p_area text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
begin
  if coalesce(trim(p_note), '') = '' then return 'error:empty'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'note', auth.uid(), v_kind,
            jsonb_build_object('note', trim(p_note), 'area', coalesce(p_area, '')));

  return 'ok:noted';
end $function$;

-- ---- wo_photo_access (storage: the crew can upload and view) ----
CREATE OR REPLACE FUNCTION public.wo_photo_access(p_wo_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  begin
    v_id := p_wo_id::uuid;
  exception when invalid_text_representation then
    return false;                     -- a path that isn't ours authorises nothing
  end;

  if public.is_staff() then return true; end if;

  return exists (
    select 1 from public.work_orders w
     where w.id = v_id
       and (
         public.wo_painter_on_job(w.id, public.current_contractor_id())
         or exists (select 1 from public.estimates e
                      join public.customers c on c.id = e.customer_id
                     where e.id = w.estimate_id and c.profile_id = auth.uid())
       )
  );
end $function$;

-- wo_photo_access answers the STORAGE policies (insert/select/delete on the
-- wo-photos bucket). It reads work_orders, and it ran with the caller's
-- rights — fine for a contractor, who can read their job; an employee has no
-- work_orders read at all (20270153), so every one of their uploads was
-- refused by the bucket, not by the app. It answers a yes/no about the
-- caller's OWN access and nothing else, so definer rights are safe.
alter function public.wo_photo_access(text) security definer;
alter function public.wo_photo_access(text) set search_path = public;

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select count(*) from pg_proc where proname = 'wo_painter_on_job') = 1 as helper,
  (select count(*) from pg_proc p where p.proname in ('wo_tick_surface','wo_record_photo','wo_tick_checklist_item','wo_answer_checklist_item','wo_add_note')
     and p.prosrc like '%wo_painter_on_job%') = 5 as five_widened,
  (select prosrc like '%wo_painter_on_job%' and prosecdef from pg_proc where proname = 'wo_photo_access') as storage_widened_definer,
  (select prosrc like '%wo_painter_on_job%' from pg_proc where proname = 'wo_is_my_job_as_contractor') as scalar_widened,
  (select count(*) from pg_proc p where p.proname in ('contractor_invoice_request','wo_contractor_accept_variation')
     and p.prosrc like '%v_wo.contractor_id is distinct from v_cid%') = 2 as money_rpcs_still_lead_only;

insert into public._prod_migrations(name) values ('20270159000000_crew_can_work.sql') on conflict (name) do nothing;
