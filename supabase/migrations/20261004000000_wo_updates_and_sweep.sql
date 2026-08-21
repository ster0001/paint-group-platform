-- =============================================================================
-- WO completion loop, step 4 — drafted customer updates, and the silent site
--
-- Nothing here sends anything. A draft is written from the day's ticks, a human
-- approves it, and only then is it marked sent. The three states are separate
-- RPCs precisely so "approved" cannot be skipped: wo_send_update refuses
-- anything that is not already approved.
--
-- The TEXT is composed in TypeScript (lib/workorder/updates.ts) because that is
-- where the English lives and where it can be unit-tested. This file stores it
-- and guards the transitions. The source tick ids are stored with it, so any
-- sentence can be traced back to the events it came from.
--
-- The silent-site catch writes a FLAG and never a message. A day with no ticks
-- means nobody knows what happened on that site — the answer to that is a
-- person ringing the crew, not an automated note to the customer.
-- =============================================================================

-- The scheduled sweep runs with the service key, which carries no user claims,
-- so is_staff() is false under it. That is the correct behaviour — it just
-- means "the system" needs saying out loud.
create or replace function public.wo_is_system()
returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

-- ---- draft ------------------------------------------------------------------
-- Upsert per (work order, date). An already-approved or sent update is NEVER
-- overwritten by a later sweep: once a person has put their name to the words,
-- the machine stops editing them.
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
   where work_order_id = p_work_order_id and for_date = p_for_date;

  if v_id is not null and v_status <> 'drafted' then
    return 'ok:' || v_id::text;          -- already approved or sent; leave it alone
  end if;

  insert into public.wo_updates
      (work_order_id, for_date, draft_text, source_tick_ids, photo_count, status)
    values (p_work_order_id, p_for_date, p_text,
            coalesce(p_tick_ids, '{}'::uuid[]), greatest(coalesce(p_photo_count, 0), 0), 'drafted')
  on conflict (work_order_id, for_date) do update
    set draft_text = excluded.draft_text,
        source_tick_ids = excluded.source_tick_ids,
        photo_count = excluded.photo_count
  returning id into v_id;

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_draft_update(uuid, date, text, uuid[], integer) to authenticated, service_role;

-- ---- approve ----------------------------------------------------------------
-- The edit and the approval are one action: whatever the PC leaves in the box
-- is what gets approved, so there is no window where edited-but-unapproved text
-- could be picked up by a send.
create or replace function public.wo_approve_update(p_update_id uuid, p_final_text text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_u public.wo_updates%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'error:already_sent'; end if;

  update public.wo_updates
     set final_text = coalesce(nullif(trim(p_final_text), ''), final_text, draft_text),
         status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_update_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_approved', auth.uid(), 'staff',
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date,
                               'edited', nullif(trim(p_final_text), '') is not null));

  return 'ok:approved';
end $$;
grant execute on function public.wo_approve_update(uuid, text) to authenticated;

-- ---- send -------------------------------------------------------------------
-- Delivery (email/SMS) is a later phase; this records that it went, and refuses
-- outright to send anything a person has not approved.
create or replace function public.wo_send_update(p_update_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_u public.wo_updates%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'ok:already'; end if;
  if v_u.status <> 'approved' then return 'error:not_approved'; end if;

  update public.wo_updates set status = 'sent', sent_at = now() where id = p_update_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_sent', auth.uid(), 'staff',
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date));

  return 'ok:sent';
end $$;
grant execute on function public.wo_send_update(uuid) to authenticated;

-- ---- the silent-site catch --------------------------------------------------
-- A job that is in progress, whose start date has arrived, and which logged no
-- tick yesterday or today. One flag per work order per day — a sweep that runs
-- late raises the flag late, it does not raise a week of them at once.
create or replace function public.wo_zero_tick_sweep()
returns integer language plpgsql security definer set search_path = public as $$
declare v_row record; v_count integer := 0;
begin
  if not (public.is_staff() or public.wo_is_system()) then return -1; end if;

  for v_row in
    select w.id, w.wo_ref
      from public.work_orders w
     where w.stage = 'in_progress'
       and w.start_date is not null
       and w.start_date <= current_date
       and not exists (
         select 1 from public.wo_events e
          where e.work_order_id = w.id
            and e.type = 'surface_tick'
            and e.created_at >= (current_date - interval '1 day')
       )
       and not exists (
         select 1 from public.wo_events f
          where f.work_order_id = w.id
            and f.type = 'zero_tick_flag'
            and (f.meta->>'date')::date = current_date
       )
  loop
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_row.id, 'zero_tick_flag', 'system',
              jsonb_build_object('date', current_date, 'wo_ref', v_row.wo_ref));

    update public.work_orders
       set blocked_reason = 'No ticks logged yesterday — call the crew'
     where id = v_row.id and blocked_reason is null;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
grant execute on function public.wo_zero_tick_sweep() to authenticated, service_role;

-- A tick clears the flag: the site is no longer silent.
create or replace function public.wo_clear_zero_tick_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'surface_tick' then
    update public.work_orders
       set blocked_reason = null
     where id = new.work_order_id
       and blocked_reason = 'No ticks logged yesterday — call the crew';
  end if;
  return new;
end $$;

drop trigger if exists wo_events_clear_zero_tick on public.wo_events;
create trigger wo_events_clear_zero_tick
  after insert on public.wo_events
  for each row execute function public.wo_clear_zero_tick_flag();

-- ---- Verification -----------------------------------------------------------
--   select public.wo_send_update('<a drafted update id>');   -> 'error:not_approved'
--   select public.wo_approve_update('<same id>', 'edited words');
--   select status, final_text from wo_updates where id = '<same>';  -> approved
--   select public.wo_send_update('<same id>');               -> 'ok:sent'
--   select public.wo_zero_tick_sweep();                      -> count of flags raised
--   run it twice in a day -> the second returns 0, never a duplicate flag
