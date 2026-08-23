-- =============================================================================
-- Completion-prep QUESTIONS + the contractor may send the pack (Tom, 23 Aug):
--
--   The finishing-up list is no longer five plain ticks. It is:
--     1. Touch-up sweep done                      tick
--     2. Site left clean                          tick
--     3. Rubbish for collection?                  yes / no  → YES prompts the office
--     4. Equipment for collection?                yes / no  → YES needs the list
--     5. Final photos taken of every area         tick
--     6. All work completed to the level required tick
--     7. Any notes for the customer               notes box (optional)
--   …and ticking them is the painter's confirmation that the work has been
--   done to the required scope.
--
--   Also: once a quality check has passed, the pack to the customer may be
--   sent by staff OR the contractor — the qa→walkthrough row gains the
--   contractor actor. The whole matrix is re-seeded (it is canonical here now;
--   lib/workorder/stages.ts mirrors THIS file and its drift test reads it).
-- =============================================================================

-- ---- 1. the item can be a tick, a yes/no, or a notes box ---------------------
alter table public.wo_checklist_items
  add column if not exists kind        text not null default 'tick',
  add column if not exists item_key    text,
  add column if not exists answer      text,
  add column if not exists answer_note text not null default '',
  -- The office's "organised" on a yes — the dashboard prompt clears on it.
  add column if not exists handled_at  timestamptz,
  add column if not exists handled_by  uuid references auth.users (id) on delete set null;

alter table public.wo_checklist_items drop constraint if exists wo_checklist_items_kind_check;
alter table public.wo_checklist_items
  add constraint wo_checklist_items_kind_check check (kind in ('tick', 'yes_no', 'note'));

-- Existing prep rows: key them, and turn the two collection ticks into the
-- yes/no questions. A row already ticked on an old job reads as "yes, and
-- already handled" — nothing from the past pops up on the dashboard.
update public.wo_checklist_items set item_key = 'touch_up'
 where phase = 'completion_prep' and item_key is null and label = 'Touch-up sweep done';
update public.wo_checklist_items set item_key = 'site_clean'
 where phase = 'completion_prep' and item_key is null and label = 'Site left clean';
update public.wo_checklist_items set item_key = 'final_photos'
 where phase = 'completion_prep' and item_key is null and label = 'Final photos taken of every area';
update public.wo_checklist_items
   set item_key = 'rubbish', kind = 'yes_no', label = 'Rubbish for collection?',
       detail = 'Yes = the office organises a collection',
       answer = case when done_at is not null then 'yes' end,
       handled_at = case when done_at is not null then done_at end
 where phase = 'completion_prep' and item_key is null
   and label in ('Rubbish collected — courier booked by the office', 'Rubbish removed');
update public.wo_checklist_items
   set item_key = 'equipment', kind = 'yes_no', label = 'Equipment for collection?',
       detail = 'If yes, list what needs collecting',
       answer = case when done_at is not null then 'yes' end,
       handled_at = case when done_at is not null then done_at end
 where phase = 'completion_prep' and item_key is null and label = 'Equipment return booked';

-- Jobs that already have a prep list get the two new items now, so the list on
-- screen is complete on the NEXT view, not the one after the seeder runs.
insert into public.wo_checklist_items (work_order_id, phase, label, detail, required, sort, kind, item_key)
select distinct i.work_order_id, 'completion_prep'::public.wo_checklist_phase, 'All work completed to the level required', '', true, 6, 'tick', 'scope_complete'
  from public.wo_checklist_items i
  join public.work_orders w on w.id = i.work_order_id
 where i.phase = 'completion_prep' and w.stage not in ('closed')
   and not exists (select 1 from public.wo_checklist_items x
                    where x.work_order_id = i.work_order_id and x.phase = 'completion_prep' and x.item_key = 'scope_complete');
insert into public.wo_checklist_items (work_order_id, phase, label, detail, required, sort, kind, item_key)
select distinct i.work_order_id, 'completion_prep'::public.wo_checklist_phase, 'Any notes for the customer', 'Shown to the customer at sign-off', false, 7, 'note', 'customer_note'
  from public.wo_checklist_items i
  join public.work_orders w on w.id = i.work_order_id
 where i.phase = 'completion_prep' and w.stage not in ('closed')
   and not exists (select 1 from public.wo_checklist_items x
                    where x.work_order_id = i.work_order_id and x.phase = 'completion_prep' and x.item_key = 'customer_note');

-- ---- 2. the seeder: seven items, keyed, idempotent by key ---------------------
create or replace function public.wo_seed_prep_checklist(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_item record; v_wo public.work_orders%rowtype;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  for v_item in
    select * from (values
      ('touch_up',       'Touch-up sweep done',                       '',                                         'tick',   true,  1),
      ('site_clean',     'Site left clean',                           '',                                         'tick',   true,  2),
      ('rubbish',        'Rubbish for collection?',                   'Yes = the office organises a collection',  'yes_no', true,  3),
      ('equipment',      'Equipment for collection?',                 'If yes, list what needs collecting',       'yes_no', true,  4),
      ('final_photos',   'Final photos taken of every area',          '',                                         'tick',   true,  5),
      ('scope_complete', 'All work completed to the level required',  '',                                         'tick',   true,  6),
      ('customer_note',  'Any notes for the customer',                'Shown to the customer at sign-off',        'note',   false, 7)
    ) as t(item_key, label, detail, kind, required, sort)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id
                      and phase = 'completion_prep'
                      and (item_key = v_item.item_key or (item_key is null and label = v_item.label))) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, kind, item_key)
        values (p_work_order_id, 'completion_prep', v_item.label, v_item.detail,
                v_item.required, v_item.sort, v_item.kind, v_item.item_key);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_prep_checklist(uuid) to authenticated, service_role;

-- ---- 3. a question is ANSWERED, not ticked ----------------------------------
-- Same people as the tick (staff, or the assigned contractor). A yes/no answer
-- is done once answered; the equipment yes needs its list; the notes box is
-- done when it has words and never gates.
create or replace function public.wo_answer_checklist_item(
  p_item_id uuid, p_answer text default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
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
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
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
end $$;
grant execute on function public.wo_answer_checklist_item(uuid, text, text) to authenticated;

-- The tick RPC refuses a question: a tick without an answer would hide a
-- collection the office needs to organise. 20261101 body, one guard added.
create or replace function public.wo_tick_checklist_item(p_item_id uuid, p_done boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare v_i public.wo_checklist_items%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
begin
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_i.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
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
end $$;
grant execute on function public.wo_tick_checklist_item(uuid, boolean) to authenticated;

-- ---- 4. the office marks a collection organised -----------------------------
create or replace function public.wo_handle_collection(p_item_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_i public.wo_checklist_items%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;
  if v_i.kind <> 'yes_no' or v_i.answer is distinct from 'yes' then return 'error:nothing_to_handle'; end if;

  update public.wo_checklist_items set handled_at = now(), handled_by = auth.uid() where id = p_item_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_i.work_order_id, 'collection_handled', auth.uid(), 'staff',
            jsonb_build_object('item_id', p_item_id, 'item_key', v_i.item_key, 'label', v_i.label));
  return 'ok';
end $$;
grant execute on function public.wo_handle_collection(uuid) to authenticated;

-- ---- 5. the painter's note, read by the customer's token --------------------
-- Customer token or Mode A session token, same trust as the walkthrough
-- itself. Empty string when there is nothing to say.
create or replace function public.wo_prep_note_by_token(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select i.answer_note
      from public.wo_signoff_by_token(p_token) t
      join public.wo_checklist_items i on i.work_order_id = (t.s).work_order_id
     where i.phase = 'completion_prep' and i.item_key = 'customer_note'
     limit 1), '');
$$;
grant execute on function public.wo_prep_note_by_token(text) to anon, authenticated;

-- ---- 6. the matrix: contractor may send the pack once the check has passed ---
delete from public.wo_stage_transitions;
insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',       array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff']),
  ('in_progress',     'completion_prep', 'all surfaces done — prep begins',     array['system','staff','contractor']),
  ('completion_prep', 'qa',              'prep confirmed — quality check due',  array['system','staff','contractor']),
  ('completion_prep', 'walkthrough',     'prep confirmed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'walkthrough',     'quality check passed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer']);

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from public.wo_stage_transitions) as transitions,
  (select actors from public.wo_stage_transitions
    where from_stage = 'qa' and to_stage = 'walkthrough') as qa_to_walkthrough_actors,
  (select count(*) from pg_proc where proname = 'wo_answer_checklist_item') as answer_fn,
  (select count(*) from pg_proc where proname = 'wo_handle_collection') as handle_fn,
  (select count(*) from pg_proc where proname = 'wo_prep_note_by_token') as note_fn,
  (select count(*) from information_schema.columns
    where table_name = 'wo_checklist_items' and column_name in ('kind','item_key','answer','answer_note','handled_at')) as new_cols;
