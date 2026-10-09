-- =============================================================================
-- Site check-ins become their own thing (Tom, 9 Oct 2026):
--
--   "the extra site visits don't send any alerts to the customer, they are
--    logged just for Felipe."
--   "site check ins shouldn't hold jobs back"
--   "a site check in isn't documented as pass or fail, but progress notes can
--    be made with the option to send to the painter, and also attach photos"
--
-- Until now "+ Add a site check-in" (20270247) wrote a wo_qa_checks row of kind
-- 'mid' — a QUALITY CHECK: it counted in wo_qa_open_count, so it parked the job
-- at Quality check; it took a pass/fail; its result fed the painter-status
-- evaluator (lib/painterStatus/run.ts reads every wo_qa_checks row); a fail
-- texted the painter. And kind 'mid' is ALSO what the standards cadence
-- (wo_schedule_qa, by painter colour) may create — a real mid-job check.
--
-- So a site check-in is NOT a new kind on wo_qa_checks: every reader of that
-- table (the open count, the routing, the stage gate, the fail text, the
-- evaluator, the customer timeline, the painter's page, wo_events-based invite
-- history the painter and the customer can read through wo_visible_jobs) would
-- have to learn to skip it, and missing one is a hold or a leak. It is its own
-- table, which none of them read:
--
--   wo_site_visits        — the visit: a day and time (before the final, the
--                           same refusals as a check: wo_qa_when_problem),
--                           visited_at (Mark visited — what clears its PC
--                           Command card). No result column: never pass/fail.
--                           Its calendar-invite history lives on the row
--                           (invite_log), not in wo_events, so the painter's and
--                           the customer's sessions cannot read it.
--   wo_site_visit_notes   — progress notes, several per visit, author + time.
--                           send_to_painter = the office chose to tell the
--                           painter; sent_outcome/sent_detail = what the
--                           dispatcher did (sent, or skipped and why).
--   wo_site_visit_photos  — photos on a note, in their own PRIVATE bucket
--                           'site-visit-photos' (the wo-photos bucket lets the
--                           job's painter AND customer read every object of the
--                           job — wo_photo_access — so it cannot hold these).
--
-- WHO READS WHAT (RLS):
--   staff     — everything.
--   painter   — the notes the office SENT them (send_to_painter), and those
--               notes' photos, for a job they are on (wo_painter_on_job).
--               Never the visit itself, never an unsent note.
--   customer  — nothing. anon — nothing.
-- Writes go through the staff-only definer functions below; the dispatcher's
-- outcome is written by the server's service client.
--
-- EXISTING DATA: open site check-ins the office added since 20270247 went live
-- (kind 'mid', trigger 'mid', a staff 'qa_check_added' event, no result, not a
-- re-check, created after 20270247's ledger row) MOVE to wo_site_visits with
-- the SAME id — so Felipe's calendar entry (UID qa-check-<id>) is the same
-- entry — carrying their invite history. Recorded checks, re-checks, cadence
-- checks and anything older are left exactly as they are; the read-back counts
-- what moved and what was left.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the visit ------------------------------------------------------------
create table if not exists public.wo_site_visits (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  scheduled_for  date,
  scheduled_time time,
  visited_at     timestamptz,
  visited_by     uuid references auth.users (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- Felipe's calendar: the same {check_id, kind, method, date, time, outcome,
  -- hash, sequence, to, created_at} objects the quality-check invites keep in
  -- wo_events, kept here because wo_events is readable by the job's painter
  -- and customer.
  invite_log     jsonb not null default '[]'::jsonb,
  constraint wo_site_visits_time_needs_day check (scheduled_time is null or scheduled_for is not null),
  constraint wo_site_visits_invite_log_array check (jsonb_typeof(invite_log) = 'array')
);
create index if not exists wo_site_visits_wo_idx on public.wo_site_visits (work_order_id);
create index if not exists wo_site_visits_due_idx on public.wo_site_visits (scheduled_for)
  where visited_at is null and scheduled_for is not null;

-- ---- 2. progress notes -------------------------------------------------------
create table if not exists public.wo_site_visit_notes (
  id               uuid primary key default gen_random_uuid(),
  visit_id         uuid not null references public.wo_site_visits (id) on delete cascade,
  work_order_id    uuid not null references public.work_orders (id) on delete cascade,
  body             text not null,
  author           uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  send_to_painter  boolean not null default false,
  sent_outcome     text,
  sent_detail      text not null default '',
  sent_at          timestamptz,
  constraint wo_site_visit_notes_body_len check (char_length(btrim(body)) between 1 and 2000),
  constraint wo_site_visit_notes_outcome check (sent_outcome is null or sent_outcome in ('sent', 'skipped')),
  constraint wo_site_visit_notes_outcome_needs_send check (sent_outcome is null or send_to_painter)
);
create index if not exists wo_site_visit_notes_visit_idx on public.wo_site_visit_notes (visit_id, created_at);
create index if not exists wo_site_visit_notes_wo_idx on public.wo_site_visit_notes (work_order_id);

-- ---- 3. photos on a note -----------------------------------------------------
create table if not exists public.wo_site_visit_photos (
  id             uuid primary key default gen_random_uuid(),
  note_id        uuid not null references public.wo_site_visit_notes (id) on delete cascade,
  visit_id       uuid not null references public.wo_site_visits (id) on delete cascade,
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  storage_path   text not null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint wo_site_visit_photos_path_unique unique (storage_path)
);
create index if not exists wo_site_visit_photos_note_idx on public.wo_site_visit_photos (note_id);
create index if not exists wo_site_visit_photos_visit_idx on public.wo_site_visit_photos (visit_id);
create index if not exists wo_site_visit_photos_wo_idx on public.wo_site_visit_photos (work_order_id);

-- ---- 4. may this caller (a painter) read this note? --------------------------
-- Called from the RLS policies below, so it runs as the CALLER and needs the
-- grant; definer, so it can read the note and the job without the caller
-- needing a policy on either (the 20270159 wo_painter_on_job shape).
create or replace function public.wo_site_visit_note_shared(p_note_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wo_site_visit_notes n
     where n.id = p_note_id
       and n.send_to_painter
       and public.wo_painter_on_job(n.work_order_id, public.current_contractor_id())
  )
$$;
revoke execute on function public.wo_site_visit_note_shared(uuid) from public, anon;
grant execute on function public.wo_site_visit_note_shared(uuid) to authenticated;

-- ---- 5. RLS ------------------------------------------------------------------
alter table public.wo_site_visits enable row level security;
alter table public.wo_site_visit_notes enable row level security;
alter table public.wo_site_visit_photos enable row level security;

drop policy if exists wo_site_visits_staff on public.wo_site_visits;
create policy wo_site_visits_staff on public.wo_site_visits
  for select to authenticated using (public.is_staff());

drop policy if exists wo_site_visit_notes_staff on public.wo_site_visit_notes;
create policy wo_site_visit_notes_staff on public.wo_site_visit_notes
  for select to authenticated using (public.is_staff());
drop policy if exists wo_site_visit_notes_painter on public.wo_site_visit_notes;
create policy wo_site_visit_notes_painter on public.wo_site_visit_notes
  for select to authenticated using (public.wo_site_visit_note_shared(id));

drop policy if exists wo_site_visit_photos_staff on public.wo_site_visit_photos;
create policy wo_site_visit_photos_staff on public.wo_site_visit_photos
  for select to authenticated using (public.is_staff());
drop policy if exists wo_site_visit_photos_painter on public.wo_site_visit_photos;
create policy wo_site_visit_photos_painter on public.wo_site_visit_photos
  for select to authenticated using (public.wo_site_visit_note_shared(note_id));

revoke all on public.wo_site_visits, public.wo_site_visit_notes, public.wo_site_visit_photos from anon;
revoke insert, update, delete on public.wo_site_visits, public.wo_site_visit_notes, public.wo_site_visit_photos from authenticated;
grant select on public.wo_site_visits, public.wo_site_visit_notes, public.wo_site_visit_photos to authenticated;
grant select, insert, update, delete on public.wo_site_visits, public.wo_site_visit_notes, public.wo_site_visit_photos to service_role;

-- ---- 6. the bucket and its own storage policies ------------------------------
-- Private; photos only, 25 MB (= MAX_UPLOAD_BYTES). Objects live at
-- <work_order_id>/<visit_id>/<file>. Staff write and read; a painter reads an
-- object only when its photo row is readable to them — the subquery runs under
-- THEIR row security, so that is exactly the photos of notes sent to them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-visit-photos', 'site-visit-photos', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists site_visit_photos_insert on storage.objects;
create policy site_visit_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-visit-photos' and public.is_staff());

drop policy if exists site_visit_photos_select on storage.objects;
create policy site_visit_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-visit-photos'
    and (public.is_staff()
         or exists (select 1 from public.wo_site_visit_photos p where p.storage_path = objects.name))
  );

drop policy if exists site_visit_photos_delete on storage.objects;
create policy site_visit_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-visit-photos' and public.is_staff());

-- ---- 7. the office adds, moves, removes and visits ---------------------------
-- A day AND a time, before the booked final, not a day already gone — the
-- same rule and refusals as a check (wo_qa_when_problem). Unlike
-- wo_add_qa_check it does NOT clear the job's "quality check not required":
-- a visit is not a check.
create or replace function public.wo_add_site_visit(p_work_order_id uuid, p_date date, p_time time)
returns text language plpgsql security definer set search_path = public as $$
declare v_stage public.wo_stage; v_problem text; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select stage into v_stage from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if p_date is null or p_time is null then return 'error:no_time'; end if;
  v_problem := public.wo_qa_when_problem(p_work_order_id, p_date, p_time);
  if v_problem is not null then return 'error:' || v_problem; end if;

  insert into public.wo_site_visits (work_order_id, scheduled_for, scheduled_time, created_by)
    values (p_work_order_id, p_date, p_time, auth.uid())
    returning id into v_id;
  return 'ok:' || v_id;
end $$;
revoke execute on function public.wo_add_site_visit(uuid, date, time) from public, anon;
grant execute on function public.wo_add_site_visit(uuid, date, time) to authenticated;

create or replace function public.wo_site_visit_set_schedule(p_visit_id uuid, p_date date, p_time time)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_site_visits%rowtype; v_stage public.wo_stage; v_problem text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.wo_site_visits where id = p_visit_id;
  if not found then return 'error:not_found'; end if;
  if v.visited_at is not null then return 'error:already_recorded'; end if;
  select stage into v_stage from public.work_orders where id = v.work_order_id;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if p_date is null or p_time is null then return 'error:no_time'; end if;
  v_problem := public.wo_qa_when_problem(v.work_order_id, p_date, p_time);
  if v_problem is not null then return 'error:' || v_problem; end if;
  update public.wo_site_visits set scheduled_for = p_date, scheduled_time = p_time where id = p_visit_id;
  return 'ok:' || p_date::text;
end $$;
revoke execute on function public.wo_site_visit_set_schedule(uuid, date, time) from public, anon;
grant execute on function public.wo_site_visit_set_schedule(uuid, date, time) to authenticated;

-- Remove a visit booked by mistake: only one with nothing on it (no notes, not
-- visited) — a visit with a record is history, not a mistake.
create or replace function public.wo_remove_site_visit(p_visit_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_site_visits%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.wo_site_visits where id = p_visit_id;
  if not found then return 'error:not_found'; end if;
  if v.visited_at is not null then return 'error:already_recorded'; end if;
  if exists (select 1 from public.wo_site_visit_notes where visit_id = p_visit_id) then return 'error:has_notes'; end if;
  delete from public.wo_site_visits where id = p_visit_id;
  return 'ok:removed';
end $$;
revoke execute on function public.wo_remove_site_visit(uuid) from public, anon;
grant execute on function public.wo_remove_site_visit(uuid) to authenticated;

-- "Mark visited" — what clears the PC Command card. Never a result.
create or replace function public.wo_site_visit_mark_visited(p_visit_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_site_visits%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.wo_site_visits where id = p_visit_id;
  if not found then return 'error:not_found'; end if;
  if v.visited_at is not null then return 'ok:already'; end if;
  update public.wo_site_visits set visited_at = now(), visited_by = auth.uid() where id = p_visit_id;
  return 'ok:visited';
end $$;
revoke execute on function public.wo_site_visit_mark_visited(uuid) from public, anon;
grant execute on function public.wo_site_visit_mark_visited(uuid) to authenticated;

-- ---- 8. notes and their photos ----------------------------------------------
create or replace function public.wo_site_visit_add_note(p_visit_id uuid, p_body text, p_send boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v public.wo_site_visits%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.wo_site_visits where id = p_visit_id;
  if not found then return 'error:not_found'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then return 'error:empty'; end if;
  if char_length(btrim(p_body)) > 2000 then return 'error:too_long'; end if;
  insert into public.wo_site_visit_notes (visit_id, work_order_id, body, author, send_to_painter)
    values (p_visit_id, v.work_order_id, btrim(p_body), auth.uid(), coalesce(p_send, false))
    returning id into v_id;
  return 'ok:' || v_id;
end $$;
revoke execute on function public.wo_site_visit_add_note(uuid, text, boolean) from public, anon;
grant execute on function public.wo_site_visit_add_note(uuid, text, boolean) to authenticated;

-- Share a note the office kept to itself at first — the "Send to painter"
-- button on a note already written. Sharing is what makes it readable to the
-- painter; the server then sends the text and email and records the outcome.
create or replace function public.wo_site_visit_share_note(p_note_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.wo_site_visit_notes set send_to_painter = true where id = p_note_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:shared';
end $$;
revoke execute on function public.wo_site_visit_share_note(uuid) from public, anon;
grant execute on function public.wo_site_visit_share_note(uuid) to authenticated;

-- The uploaded object must sit under its own job and visit.
create or replace function public.wo_site_visit_record_photo(p_note_id uuid, p_storage_path text)
returns text language plpgsql security definer set search_path = public as $$
declare n public.wo_site_visit_notes%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into n from public.wo_site_visit_notes where id = p_note_id;
  if not found then return 'error:not_found'; end if;
  if coalesce(p_storage_path, '') not like (n.work_order_id::text || '/' || n.visit_id::text || '/%') then
    return 'error:bad_path';
  end if;
  insert into public.wo_site_visit_photos (note_id, visit_id, work_order_id, storage_path, created_by)
    values (n.id, n.visit_id, n.work_order_id, p_storage_path, auth.uid())
    on conflict (storage_path) do nothing
    returning id into v_id;
  if v_id is null then return 'error:already_recorded'; end if;
  return 'ok:' || v_id;
end $$;
revoke execute on function public.wo_site_visit_record_photo(uuid, text) from public, anon;
grant execute on function public.wo_site_visit_record_photo(uuid, text) to authenticated;

-- ---- 9. existing data: the office's open site check-ins move -----------------
-- Only what can be identified for certain as a "+ Add a site check-in" press
-- since 20270247 went live: kind 'mid' with trigger 'mid' (set only by
-- wo_add_qa_check — the cadence writes new_painter / yellow_cadence /
-- orange_every / required), a staff 'qa_check_added' event naming it, no
-- result, not a re-check and nothing re-checking it. With no ledger row for
-- 20270247 nothing qualifies. Same id, same invite history.
insert into public.wo_site_visits (id, work_order_id, scheduled_for, scheduled_time, created_by, created_at, invite_log)
select c.id, c.work_order_id, c.scheduled_for,
       case when c.scheduled_for is null then null else c.scheduled_time end,
       (select e.actor from public.wo_events e
         where e.work_order_id = c.work_order_id and e.type = 'qa_check_added'
           and e.meta->>'check_id' = c.id::text order by e.created_at limit 1),
       c.created_at,
       coalesce((select jsonb_agg(e.meta || jsonb_build_object('created_at', e.created_at) order by e.created_at)
                   from public.wo_events e
                  where e.work_order_id = c.work_order_id and e.type = 'qa_check_invite'
                    and e.meta->>'check_id' = c.id::text), '[]'::jsonb)
  from public.wo_qa_checks c
 where c.kind = 'mid' and c.trigger = 'mid'
   and c.result is null and c.retry_of is null
   and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id)
   and exists (select 1 from public.wo_events e
                where e.work_order_id = c.work_order_id and e.type = 'qa_check_added'
                  and e.actor_kind = 'staff' and e.meta->>'check_id' = c.id::text)
   and c.created_at >= (select applied_at from public._prod_migrations
                         where name = '20270247000000_qa_check_scheduling.sql')
on conflict (id) do nothing;

-- Anything typed on the check before it moved becomes the visit's first note,
-- office-only.
insert into public.wo_site_visit_notes (visit_id, work_order_id, body, created_at)
select c.id, c.work_order_id, left(btrim(c.notes), 2000), c.created_at
  from public.wo_qa_checks c
  join public.wo_site_visits v on v.id = c.id
 where btrim(coalesce(c.notes, '')) <> ''
   and not exists (select 1 from public.wo_site_visit_notes n where n.visit_id = c.id);

-- The moved rows leave wo_qa_checks (their unanswered standards rows cascade).
delete from public.wo_qa_checks c
 using public.wo_site_visits v
 where v.id = c.id and c.result is null;

-- ---- read-back: ONE row, every column equals its _expect_ -------------------
-- moved_site_checkins and office_mids_left are COUNTS to read, not to match:
-- what moved, and the open office-added 'mid' checks left as quality checks
-- (older than 20270247, or without the staff event) for Tom to decide on.
select
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('wo_site_visits', 'wo_site_visit_notes', 'wo_site_visit_photos')) as tables, 3 as _expect_tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('wo_site_visits', 'wo_site_visit_notes', 'wo_site_visit_photos')
      and c.relrowsecurity) as rls_on, 3 as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public'
    and policyname in ('wo_site_visits_staff', 'wo_site_visit_notes_staff', 'wo_site_visit_notes_painter',
                       'wo_site_visit_photos_staff', 'wo_site_visit_photos_painter')) as table_policies, 5 as _expect_table_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wo_site_visits'
    and policyname <> 'wo_site_visits_staff') as visit_policies_beyond_staff, 0 as _expect_visit_policies_beyond_staff,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('site_visit_photos_insert', 'site_visit_photos_select', 'site_visit_photos_delete')) as storage_policies, 3 as _expect_storage_policies,
  (select public from storage.buckets where id = 'site-visit-photos') as bucket_public, false as _expect_bucket_public,
  has_table_privilege('anon', 'public.wo_site_visit_notes', 'select') as anon_reads_notes, false as _expect_anon_reads_notes,
  has_table_privilege('authenticated', 'public.wo_site_visit_notes', 'insert') as authenticated_inserts_notes, false as _expect_authenticated_inserts_notes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('wo_add_site_visit', 'wo_site_visit_set_schedule', 'wo_remove_site_visit', 'wo_site_visit_mark_visited',
                        'wo_site_visit_add_note', 'wo_site_visit_share_note', 'wo_site_visit_record_photo', 'wo_site_visit_note_shared')) as definer_fns, 8 as _expect_definer_fns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('wo_add_site_visit', 'wo_site_visit_set_schedule', 'wo_remove_site_visit', 'wo_site_visit_mark_visited',
                        'wo_site_visit_add_note', 'wo_site_visit_share_note', 'wo_site_visit_record_photo', 'wo_site_visit_note_shared')
      and has_function_privilege('authenticated', p.oid, 'execute')) as granted_fns, 8 as _expect_granted_fns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('wo_add_site_visit', 'wo_site_visit_set_schedule', 'wo_remove_site_visit', 'wo_site_visit_mark_visited',
                        'wo_site_visit_add_note', 'wo_site_visit_share_note', 'wo_site_visit_record_photo', 'wo_site_visit_note_shared')
      and has_function_privilege('anon', p.oid, 'execute')) as anon_fns, 0 as _expect_anon_fns,
  (select count(*) from public.wo_qa_checks c join public.wo_site_visits v on v.id = c.id) as still_in_both, 0 as _expect_still_in_both,
  (select count(*) from public.wo_site_visits) as moved_site_checkins,
  (select count(*) from public.wo_qa_checks c
    where c.kind = 'mid' and c.result is null and c.retry_of is null
      and exists (select 1 from public.wo_events e where e.work_order_id = c.work_order_id
                   and e.type = 'qa_check_added' and e.actor_kind = 'staff' and e.meta->>'check_id' = c.id::text)) as office_mids_left;

insert into public._prod_migrations(name) values ('20270248000000_site_checkins.sql') on conflict (name) do nothing;
