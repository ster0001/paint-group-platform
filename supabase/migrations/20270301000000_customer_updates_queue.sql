-- Work order UX, Step 2 (docs/briefs/claude-code-brief-work-order-ux.md §4.2 + §4.3,
-- Step 0 report M3): the Customer updates queue.
--
-- The queue IS wo_updates (the daily update has had its own table since 20260927):
-- it gains a KIND, so a surface milestone, the 40% check-in and the defect-day note
-- can sit beside the end-of-day summary, the milestones it announces, the events it
-- was written from, who sent it and the sender line the customer reads. The one
-- (job, day) unique becomes partial: one END-OF-DAY row per job per day, any number
-- of milestones. Drafting a milestone bundles into an open draft of the last N
-- minutes; a job that is paused, in rectification or signed off gets no draft.
-- Approve and send may now run as the system too (the auto-send sweep), and a
-- dismissed draft records what it announced so it is never regenerated.
-- Only STAFF read drafts: a customer or painter session reads sent rows only.
set lock_timeout = '15s';

-- ---- 1. the columns ------------------------------------------------------------------------
alter table public.wo_updates
  add column if not exists kind             text not null default 'end_of_day',
  add column if not exists source_event_ids uuid[] not null default '{}',
  add column if not exists milestones       jsonb not null default '[]',
  add column if not exists sent_by          uuid references auth.users (id) on delete set null,
  add column if not exists sender_name      text;
alter table public.wo_updates drop constraint if exists wo_updates_kind_check;
alter table public.wo_updates add constraint wo_updates_kind_check
  check (kind in ('end_of_day', 'surface_milestone', 'checkin_40', 'defect_day'));
alter table public.wo_updates drop constraint if exists wo_updates_milestones_array;
alter table public.wo_updates add constraint wo_updates_milestones_array check (jsonb_typeof(milestones) = 'array');

-- One end-of-day summary per job per day; milestones are many.
alter table public.wo_updates drop constraint if exists wo_updates_work_order_id_for_date_key;
create unique index if not exists wo_updates_end_of_day_uidx
  on public.wo_updates (work_order_id, for_date) where kind = 'end_of_day';
create index if not exists wo_updates_kind_idx on public.wo_updates (work_order_id, kind, status, created_at desc);

-- ---- 2. drafts are read by staff only --------------------------------------------------------
drop policy if exists wo_updates_read on public.wo_updates;
create policy wo_updates_read on public.wo_updates
  for select to authenticated
  using (wo_updates.work_order_id in (select id from private.wo_visible_jobs)
         and (public.is_staff() or wo_updates.status = 'sent'));

-- ---- 3. may this job be written to? -----------------------------------------------------------
-- ok | stage:<stage> | paused | signed_off | rectification | not_found. Paused is the
-- blocked_reason the console sets (ruling M9 default); rectification is an open
-- rectification row. Stable helper, no grant (RPCs call it).
create or replace function public.wo_customer_updates_allowed(p_work_order_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when w.stage not in ('in_progress', 'completion_prep') then 'stage:' || w.stage::text
      when w.blocked_reason is not null then 'paused'
      when exists (select 1 from public.wo_signoff s where s.work_order_id = w.id and s.signed_at is not null) then 'signed_off'
      when exists (select 1 from public.wo_surfaces r
                    where r.work_order_id = w.id and r.rectification
                      and not coalesce(r.removed_from_scope, false) and r.state <> 'done') then 'rectification'
      else 'ok' end
      from public.work_orders w where w.id = p_work_order_id), 'not_found');
$$;

-- ---- 4. the end-of-day draft keeps its one-per-day rule through the partial index -----------
create or replace function public.wo_draft_update(
  p_work_order_id uuid, p_for_date date, p_text text,
  p_tick_ids uuid[] default '{}', p_photo_count integer default 0
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.wo_update_status;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  if coalesce(trim(p_text), '') = '' then return 'error:empty'; end if;

  select id, status into v_id, v_status
    from public.wo_updates
   where work_order_id = p_work_order_id and for_date = p_for_date and kind = 'end_of_day';

  if v_id is not null and v_status <> 'drafted' then
    return 'ok:' || v_id::text;          -- already approved or sent; leave it alone
  end if;

  insert into public.wo_updates
      (work_order_id, for_date, kind, draft_text, source_tick_ids, source_event_ids, photo_count, status)
    values (p_work_order_id, p_for_date, 'end_of_day', p_text,
            coalesce(p_tick_ids, '{}'::uuid[]), coalesce(p_tick_ids, '{}'::uuid[]),
            greatest(coalesce(p_photo_count, 0), 0), 'drafted')
  on conflict (work_order_id, for_date) where kind = 'end_of_day' do update
    set draft_text = excluded.draft_text,
        source_tick_ids = excluded.source_tick_ids,
        source_event_ids = excluded.source_event_ids,
        photo_count = excluded.photo_count
  returning id into v_id;

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_draft_update(uuid, date, text, uuid[], integer) to authenticated, service_role;

-- ---- 5. a surface milestone, bundled -------------------------------------------------------
-- An open milestone draft on the job younger than p_bundle_minutes takes the new
-- words and the union of milestones (the caller composes the union); otherwise a
-- new draft. Refused on a job that may not be written to.
create or replace function public.wo_draft_milestone(
  p_work_order_id uuid, p_text text, p_milestones jsonb, p_source_event_ids uuid[] default '{}',
  p_bundle_minutes integer default 5
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok text;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  if coalesce(trim(p_text), '') = '' then return 'error:empty'; end if;
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array' then return 'error:bad_milestones'; end if;
  v_ok := public.wo_customer_updates_allowed(p_work_order_id);
  if v_ok <> 'ok' then return 'error:' || v_ok; end if;

  select id into v_id from public.wo_updates
   where work_order_id = p_work_order_id and kind = 'surface_milestone' and status = 'drafted'
     and created_at > now() - make_interval(mins => greatest(coalesce(p_bundle_minutes, 0), 0))
   order by created_at desc limit 1
     for update;

  if v_id is not null then
    update public.wo_updates
       set draft_text = p_text,
           milestones = p_milestones,
           source_event_ids = (select coalesce(array_agg(distinct x), '{}'::uuid[])
                                 from unnest(source_event_ids || coalesce(p_source_event_ids, '{}'::uuid[])) x)
     where id = v_id;
    return 'ok:' || v_id::text || ':bundled';
  end if;

  insert into public.wo_updates (work_order_id, for_date, kind, draft_text, milestones, source_event_ids, status)
    values (p_work_order_id, (now() at time zone 'Australia/Melbourne')::date, 'surface_milestone', p_text,
            p_milestones, coalesce(p_source_event_ids, '{}'::uuid[]), 'drafted')
    returning id into v_id;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_draft_milestone(uuid, text, jsonb, uuid[], integer) to authenticated, service_role;

-- ---- 6. approve and send: a person, or the system when the switch is on -------------------
create or replace function public.wo_approve_update(p_update_id uuid, p_final_text text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_u public.wo_updates%rowtype; v_kind text;
begin
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  else return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'error:already_sent'; end if;

  update public.wo_updates
     set final_text = coalesce(nullif(trim(p_final_text), ''), final_text, draft_text),
         status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_update_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_approved', auth.uid(), v_kind,
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date, 'kind', v_u.kind,
                               'edited', nullif(trim(p_final_text), '') is not null));

  return 'ok:approved';
end $$;
grant execute on function public.wo_approve_update(uuid, text) to authenticated, service_role;

drop function if exists public.wo_send_update(uuid, uuid[]);
create or replace function public.wo_send_update(p_update_id uuid, p_photo_ids uuid[] default '{}', p_sender_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_u public.wo_updates%rowtype;
  v_photos uuid[];
  v_kind text;
begin
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  else return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'ok:already'; end if;
  if v_u.status <> 'approved' then return 'error:not_approved'; end if;

  -- Only photos of THIS job, at most 8, in the order they were chosen.
  select coalesce(array_agg(p.id order by ord), '{}'::uuid[]) into v_photos
    from unnest(coalesce(p_photo_ids, '{}'::uuid[])) with ordinality as chosen(id, ord)
    join public.wo_photos p on p.id = chosen.id
   where p.work_order_id = v_u.work_order_id
     and ord <= 8;

  update public.wo_updates
     set status = 'sent',
         sent_at = now(),
         sent_by = auth.uid(),
         sender_name = coalesce(nullif(trim(p_sender_name), ''), sender_name),
         photo_ids = v_photos,
         photo_count = greatest(photo_count, coalesce(array_length(v_photos, 1), 0))
   where id = p_update_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_sent', auth.uid(), v_kind,
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date, 'kind', v_u.kind,
                               'photo_count', coalesce(array_length(v_photos, 1), 0)));

  return 'ok:sent';
end $$;
grant execute on function public.wo_send_update(uuid, uuid[], text) to authenticated, service_role;

-- ---- 7. a dropped draft remembers what it announced ------------------------------------------
create or replace function public.wo_dismiss_update(p_update_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_u public.wo_updates%rowtype; v_stage public.wo_stage;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'error:already_sent'; end if;

  select stage into v_stage from public.work_orders where id = v_u.work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_dismissed', auth.uid(), 'staff',
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date,
                               'kind', v_u.kind, 'milestones', v_u.milestones,
                               'source_event_ids', to_jsonb(v_u.source_event_ids),
                               'status', v_u.status::text, 'job_stage', v_stage::text,
                               'reason', coalesce(nullif(trim(p_reason), ''), 'not sent'),
                               'text', left(coalesce(v_u.final_text, v_u.draft_text), 600)));

  delete from public.wo_updates where id = p_update_id;
  return 'ok:dismissed';
end $$;
grant execute on function public.wo_dismiss_update(uuid, text) to authenticated;

-- ---- 8. read-back: compare to the _expect_ values -----------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wo_updates'
     and column_name in ('kind', 'source_event_ids', 'milestones', 'sent_by', 'sender_name')) as columns, 5 as _expect_columns,
  (select count(*) from pg_indexes where tablename = 'wo_updates' and indexname = 'wo_updates_end_of_day_uidx') as partial_unique, 1 as _expect_partial_unique,
  (select count(*) from pg_constraint where conname = 'wo_updates_work_order_id_for_date_key') as old_unique, 0 as _expect_old_unique,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('wo_customer_updates_allowed', 'wo_draft_milestone')) as new_fns, 2 as _expect_new_fns,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'wo_send_update') as send_overloads, 1 as _expect_send_overloads,
  (select count(*) from information_schema.role_routine_grants where routine_schema = 'public' and grantee = 'service_role'
     and routine_name in ('wo_draft_milestone', 'wo_approve_update', 'wo_send_update')) as system_grants, 3 as _expect_system_grants,
  (select pg_get_expr(p.polqual, p.polrelid) like '%sent%' from pg_policy p where p.polname = 'wo_updates_read') as drafts_staff_only, true as _expect_drafts_staff_only;

insert into public._prod_migrations(name) values ('20270301000000_customer_updates_queue.sql') on conflict (name) do nothing;
