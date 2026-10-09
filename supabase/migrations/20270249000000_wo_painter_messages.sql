-- =============================================================================
-- 20270249 · Messages between the office and the painter, per project
--
-- Tom, 9 Oct 2026: "a message box in PC Command in the project, to message
-- the contractor — this shows up in a messages box and the contractor can see
-- which project the message is linked to — photos can be attached from both
-- sides to send each way."
--
-- ONE THREAD PER PROJECT PER PAINTER: wo_message_threads is keyed on
-- (work_order_id, contractor_id). A job with a lead and assigned employees has
-- one thread per painter — the office picks whose thread it is writing in, and
-- nothing one painter writes is read by another.
--
-- Who reads what (RLS, through each caller's own session):
--   · staff — every thread (is_staff()).
--   · a painter — only threads that are THEIRS (contractor_id is their own)
--     on a job they are still on (wo_painter_on_job: the lead, a live
--     assignment, or a booked return visit). The ownership question is asked
--     by a SECURITY DEFINER helper, so the policy never needs the caller to
--     read work_orders (an employee cannot — 20270153).
--   · a customer, anon — nothing: no policy matches, no grant to anon.
-- Writes go only through wo_message_post / wo_message_post_from /
-- wo_message_mark_read (definer, validate the caller and the current state).
-- authenticated has SELECT only.
--
-- One notification per burst (the "don't spam" rule): the post decides, under
-- the thread's row lock, whether the OTHER side should be told now. They are
-- told when nobody has told them on this thread yet, or the last telling was
-- 10 minutes ago or more, or they have read the thread since it. A message
-- inside the window is stamped notify_status = 'batched' — the text already
-- on its way covers it. TS twin: lib/workorder/messageModel.ts pingDue().
--
-- Photos: a PRIVATE bucket, wo-messages, images only, 25 MB. Objects live at
-- "<work_order_id>/<contractor_id>/<file>" — the thread's own folder — and the
-- storage policies ask the same ownership question as the tables. The app
-- signs read URLs through the caller's session, never the service key.
--
-- ONE route to the painter: a site check-in note (20270248) with "Send to
-- painter" ticked is delivered as an office message in this thread —
-- wo_message_post_from('site_checkin', <note id>, …), once per note (unique on
-- source + source_id) — and told through the same burst rule and the same
-- text/email, instead of a separate send of its own.
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the thread --------------------------------------------------------------
create table if not exists public.wo_message_threads (
  id                       uuid primary key default gen_random_uuid(),
  work_order_id            uuid not null references public.work_orders (id) on delete cascade,
  contractor_id            uuid not null references public.contractors (id) on delete cascade,
  created_at               timestamptz not null default now(),
  last_message_at          timestamptz,
  last_staff_message_at    timestamptz,
  last_painter_message_at  timestamptz,
  -- Read state per side. Posting counts as reading: you have seen your own thread.
  staff_read_at            timestamptz,
  painter_read_at          timestamptz,
  -- The burst clock: when each side was last told (text/email, or a staff alert).
  painter_pinged_at        timestamptz,
  staff_pinged_at          timestamptz,
  -- Derived, so the PC work queue's "painter wrote and nobody has read it" is
  -- an indexed read rather than a scan.
  staff_unread             boolean generated always as (
    last_painter_message_at is not null and (staff_read_at is null or staff_read_at < last_painter_message_at)
  ) stored,
  painter_unread           boolean generated always as (
    last_staff_message_at is not null and (painter_read_at is null or painter_read_at < last_staff_message_at)
  ) stored,
  constraint wo_message_threads_one_per_painter unique (work_order_id, contractor_id)
);
create index if not exists wo_message_threads_contractor_idx on public.wo_message_threads (contractor_id, last_message_at desc);
create index if not exists wo_message_threads_staff_unread_idx on public.wo_message_threads (last_painter_message_at) where staff_unread;

-- ---- 2. the messages --------------------------------------------------------------
create table if not exists public.wo_messages (
  id                 uuid primary key default gen_random_uuid(),
  thread_id          uuid not null references public.wo_message_threads (id) on delete cascade,
  author_kind        text not null check (author_kind in ('staff', 'painter')),
  author_profile_id  uuid references auth.users (id) on delete set null,
  author_name        text not null default '',
  body               text not null default '' check (char_length(body) <= 4000),
  photo_paths        text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  -- Where it came from: typed in a Messages box, or another module's hook.
  source             text not null default 'manual' check (source in ('manual', 'site_checkin')),
  source_id          uuid,
  -- What telling the other side came to, in words the office can read.
  notify_status      text check (notify_status in ('sent', 'queued', 'skipped', 'batched', 'off')),
  notify_detail      text not null default '',
  created_at         timestamptz not null default now(),
  constraint wo_messages_says_something check (char_length(btrim(body)) > 0 or cardinality(photo_paths) > 0)
);
create index if not exists wo_messages_thread_idx on public.wo_messages (thread_id, created_at);
create index if not exists wo_messages_author_idx on public.wo_messages (author_profile_id);
create unique index if not exists wo_messages_source_once on public.wo_messages (source, source_id) where source_id is not null;

-- ---- 3. ownership helpers (definer: they answer about the CALLER only) ------------
-- Is this (job, painter) pair the signed-in painter's own, on a job they are on?
-- NEVER null: a caller with no contractors row (a customer) makes
-- current_contractor_id() null, and "not null" is null, not true — a null
-- here once let a customer post as the painter (caught by the probe, 9 Oct).
create or replace function public.wo_message_painter_ok(p_work_order_id uuid, p_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    p_contractor_id is not null
      and p_contractor_id = public.current_contractor_id()
      and public.wo_painter_on_job(p_work_order_id, p_contractor_id),
    false)
$$;

create or replace function public.wo_message_thread_mine(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wo_message_threads t
     where t.id = p_thread_id and public.wo_message_painter_ok(t.work_order_id, t.contractor_id)
  )
$$;

-- Storage: "<work_order_id>/<contractor_id>/<file>". Anything else authorises nothing.
create or replace function public.wo_message_object_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_parts text[]; v_wo uuid; v_c uuid;
begin
  v_parts := string_to_array(coalesce(p_name, ''), '/');
  if array_length(v_parts, 1) is distinct from 3 or coalesce(v_parts[3], '') = '' then return false; end if;
  begin
    v_wo := v_parts[1]::uuid;
    v_c  := v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if public.is_staff() then
    return exists (select 1 from public.work_orders w where w.id = v_wo);
  end if;
  return public.wo_message_painter_ok(v_wo, v_c) is true;
end $$;

-- The burst rule, one place. Called only by the definer post below — no grant.
create or replace function public.wo_message_ping_due(p_pinged_at timestamptz, p_read_at timestamptz, p_now timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select p_pinged_at is null
      or p_pinged_at <= p_now - interval '10 minutes'
      or (p_read_at is not null and p_read_at >= p_pinged_at)
$$;

-- ---- 4. RLS: read through your own session; write only through the functions ------
alter table public.wo_message_threads enable row level security;
alter table public.wo_messages enable row level security;

drop policy if exists wo_message_threads_read on public.wo_message_threads;
create policy wo_message_threads_read on public.wo_message_threads
  for select to authenticated
  using (public.is_staff() or public.wo_message_painter_ok(work_order_id, contractor_id));

drop policy if exists wo_messages_read on public.wo_messages;
create policy wo_messages_read on public.wo_messages
  for select to authenticated
  using (public.is_staff() or public.wo_message_thread_mine(thread_id));

revoke all on public.wo_message_threads from public, anon, authenticated;
revoke all on public.wo_messages from public, anon, authenticated;
grant select on public.wo_message_threads to authenticated;
grant select on public.wo_messages to authenticated;

-- ---- 5. post a message ------------------------------------------------------------------
-- ONE insert for every way a message arrives (typed in a Messages box, or
-- delivered from another module such as a site check-in note). It is not
-- callable by anyone: the two definer functions below decide WHO is posting
-- and as which side, then call it. It validates the content, files the
-- message in the (job, painter) thread, and decides — under the thread's row
-- lock — whether the other side is told now (the burst rule).
-- Returns jsonb: { ok, message_id, thread_id, side, notify, already } or { error }.
create or replace function public.wo_message_insert(
  p_work_order_id uuid, p_contractor_id uuid, p_side text, p_body text, p_photo_paths text[],
  p_source text, p_source_id uuid
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_paths  text[] := coalesce(p_photo_paths, '{}');
  v_prefix text := p_work_order_id::text || '/' || p_contractor_id::text || '/';
  v_p      text;
  v_name   text;
  -- The wall clock, not the transaction's: two posts in one transaction still
  -- order and compare correctly.
  v_now    timestamptz := clock_timestamp();
  v_thread public.wo_message_threads%rowtype;
  v_id     uuid;
  v_notify boolean;
begin
  if p_side not in ('staff', 'painter') then return jsonb_build_object('error', 'bad_input'); end if;
  if char_length(v_body) > 4000 then return jsonb_build_object('error', 'too_long'); end if;
  if cardinality(v_paths) > 6 then return jsonb_build_object('error', 'too_many_photos'); end if;
  if v_body = '' and cardinality(v_paths) = 0 then return jsonb_build_object('error', 'empty'); end if;
  foreach v_p in array v_paths loop
    if v_p is null or left(v_p, char_length(v_prefix)) <> v_prefix
       or v_p !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then
      return jsonb_build_object('error', 'bad_photo');
    end if;
  end loop;

  select coalesce(nullif(btrim(p.name), ''), case when p_side = 'staff' then 'The office' else 'Painter' end)
    into v_name from public.profiles p where p.id = auth.uid();

  insert into public.wo_message_threads (work_order_id, contractor_id)
    values (p_work_order_id, p_contractor_id)
    on conflict (work_order_id, contractor_id) do nothing;
  select * into v_thread from public.wo_message_threads
   where work_order_id = p_work_order_id and contractor_id = p_contractor_id
   for update;

  insert into public.wo_messages (thread_id, author_kind, author_profile_id, author_name, body, photo_paths, source, source_id, created_at)
    values (v_thread.id, p_side, auth.uid(), coalesce(v_name, ''), v_body, v_paths, coalesce(p_source, 'manual'), p_source_id, v_now)
    on conflict (source, source_id) where source_id is not null do nothing
    returning id into v_id;
  if v_id is null then
    -- Already delivered (a second press of "Send to painter"): nothing new, nobody told twice.
    select m.id into v_id from public.wo_messages m where m.source = p_source and m.source_id = p_source_id;
    return jsonb_build_object('ok', true, 'already', true, 'message_id', v_id, 'thread_id', v_thread.id, 'side', p_side, 'notify', false);
  end if;

  if p_side = 'staff' then
    v_notify := public.wo_message_ping_due(v_thread.painter_pinged_at, v_thread.painter_read_at, v_now);
    update public.wo_message_threads
       set last_message_at = v_now, last_staff_message_at = v_now, staff_read_at = v_now,
           painter_pinged_at = case when v_notify then v_now else painter_pinged_at end
     where id = v_thread.id;
  else
    v_notify := public.wo_message_ping_due(v_thread.staff_pinged_at, v_thread.staff_read_at, v_now);
    update public.wo_message_threads
       set last_message_at = v_now, last_painter_message_at = v_now, painter_read_at = v_now,
           staff_pinged_at = case when v_notify then v_now else staff_pinged_at end
     where id = v_thread.id;
  end if;
  if not v_notify then
    update public.wo_messages set notify_status = 'batched' where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'message_id', v_id, 'thread_id', v_thread.id, 'side', p_side, 'notify', v_notify);
end $$;

-- Typed in a Messages box. The caller's side is decided here, never by the
-- client: staff (to a painter on the job), or the painter whose thread it is.
create or replace function public.wo_message_post(
  p_work_order_id uuid, p_contractor_id uuid, p_body text, p_photo_paths text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff boolean := public.is_staff();
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if p_work_order_id is null or p_contractor_id is null then return jsonb_build_object('error', 'bad_input'); end if;
  if v_staff is true then
    if public.wo_painter_on_job(p_work_order_id, p_contractor_id) is not true then
      return jsonb_build_object('error', 'not_on_job');
    end if;
  elsif public.wo_message_painter_ok(p_work_order_id, p_contractor_id) is not true then
    return jsonb_build_object('error', 'not_yours');
  end if;
  return public.wo_message_insert(p_work_order_id, p_contractor_id,
    case when v_staff is true then 'staff' else 'painter' end, p_body, p_photo_paths, 'manual', null);
end $$;

-- Delivered from another module, as the office (Tom, 9 Oct 2026: ONE route for
-- messages to the painter). Today: a site check-in note (20270248) with "Send
-- to painter" ticked. STAFF ONLY. The words are the note's own, read here —
-- never taken from the caller — and the note must be shared and on this job's
-- painter's job. Once per note: a second call answers already=true.
-- p_photo_paths: the note's photos, already COPIED into this thread's folder
-- of wo-messages by the server (storage cannot be copied from SQL).
create or replace function public.wo_message_post_from(
  p_source text, p_source_id uuid, p_contractor_id uuid, p_photo_paths text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wo uuid; v_body text; v_shared boolean;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if public.is_staff() is not true then return jsonb_build_object('error', 'not_staff'); end if;
  if p_source is distinct from 'site_checkin' or p_source_id is null or p_contractor_id is null then
    return jsonb_build_object('error', 'bad_input');
  end if;
  select n.work_order_id, n.body, n.send_to_painter into v_wo, v_body, v_shared
    from public.wo_site_visit_notes n where n.id = p_source_id;
  if v_wo is null then return jsonb_build_object('error', 'not_found'); end if;
  if v_shared is not true then return jsonb_build_object('error', 'not_shared'); end if;
  if public.wo_painter_on_job(v_wo, p_contractor_id) is not true then
    return jsonb_build_object('error', 'not_on_job');
  end if;
  return public.wo_message_insert(v_wo, p_contractor_id, 'staff', v_body, p_photo_paths, p_source, p_source_id);
end $$;

-- ---- 6. mark a thread read (your own side only) -------------------------------------------
create or replace function public.wo_message_mark_read(p_thread_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error:not_signed_in'; end if;
  if public.is_staff() is true then
    update public.wo_message_threads set staff_read_at = clock_timestamp() where id = p_thread_id;
    return case when found then 'ok' else 'error:not_found' end;
  end if;
  if public.wo_message_thread_mine(p_thread_id) is not true then return 'error:not_yours'; end if;
  update public.wo_message_threads set painter_read_at = clock_timestamp() where id = p_thread_id;
  return 'ok';
end $$;

-- ---- 7. the painter's Messages box: their threads, unread counts ---------------------------
-- No address here: the server looks the job's location up for these ids and
-- reduces it to the suburb before anything reaches the painter's browser
-- (lib/workorder/messagesLoad.ts — the privacy gate lives in the server render).
create or replace function public.wo_my_message_threads()
returns table (
  thread_id uuid, work_order_id uuid, wo_ref text, last_message_at timestamptz,
  last_author_kind text, last_body text, last_photo_count integer, unread integer
) language sql stable security definer set search_path = public as $$
  select t.id, t.work_order_id, w.wo_ref, t.last_message_at,
         m.author_kind, left(m.body, 140), coalesce(cardinality(m.photo_paths), 0),
         (select count(*)::int from public.wo_messages x
           where x.thread_id = t.id and x.author_kind = 'staff'
             and (t.painter_read_at is null or x.created_at > t.painter_read_at))
    from public.wo_message_threads t
    join public.work_orders w on w.id = t.work_order_id
    left join lateral (
      select y.author_kind, y.body, y.photo_paths from public.wo_messages y
       where y.thread_id = t.id order by y.created_at desc limit 1
    ) m on true
   where t.contractor_id = public.current_contractor_id()
     and public.wo_painter_on_job(t.work_order_id, t.contractor_id)
   order by t.last_message_at desc nulls last
   limit 50
$$;

-- ---- 8. grants: callers named explicitly (default privileges grant nobody since 20270201) --
revoke execute on function public.wo_message_painter_ok(uuid, uuid) from public, anon;
revoke execute on function public.wo_message_thread_mine(uuid) from public, anon;
revoke execute on function public.wo_message_object_ok(text) from public, anon;
revoke execute on function public.wo_message_ping_due(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.wo_message_insert(uuid, uuid, text, text, text[], text, uuid) from public, anon, authenticated;
revoke execute on function public.wo_message_post(uuid, uuid, text, text[]) from public, anon;
revoke execute on function public.wo_message_post_from(text, uuid, uuid, text[]) from public, anon;
revoke execute on function public.wo_message_mark_read(uuid) from public, anon;
revoke execute on function public.wo_my_message_threads() from public, anon;
-- The three helpers are asked by RLS / storage policies, which run as the caller.
grant execute on function public.wo_message_painter_ok(uuid, uuid) to authenticated;
grant execute on function public.wo_message_thread_mine(uuid) to authenticated;
grant execute on function public.wo_message_object_ok(text) to authenticated;
grant execute on function public.wo_message_post(uuid, uuid, text, text[]) to authenticated;
grant execute on function public.wo_message_post_from(text, uuid, uuid, text[]) to authenticated;
grant execute on function public.wo_message_mark_read(uuid) to authenticated;
grant execute on function public.wo_my_message_threads() to authenticated;

-- ---- 9. the photo bucket — PRIVATE, images only, 25 MB ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wo-messages', 'wo-messages', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists wo_messages_obj_read   on storage.objects;
drop policy if exists wo_messages_obj_write  on storage.objects;
drop policy if exists wo_messages_obj_delete on storage.objects;
create policy wo_messages_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'wo-messages' and public.wo_message_object_ok(name));
create policy wo_messages_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'wo-messages' and public.wo_message_object_ok(name));
-- Removing a photo is the office's call; a refused upload is removed server-side.
create policy wo_messages_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'wo-messages' and public.is_staff());

-- ---- 10. read-back: compare every column to its _expect_ before calling this live ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('wo_message_threads', 'wo_messages')) as tables_made, 2 as _expect_tables_made,
  (select count(*) from pg_class where relname in ('wo_message_threads', 'wo_messages') and relrowsecurity) as rls_on, 2 as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('wo_message_threads', 'wo_messages')) as table_policies, 2 as _expect_table_policies,
  (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'wo_messages_obj_%') as bucket_policies, 3 as _expect_bucket_policies,
  (select not public from storage.buckets where id = 'wo-messages') as bucket_private, true as _expect_bucket_private,
  has_table_privilege('authenticated', 'public.wo_messages', 'insert') as auth_can_insert, false as _expect_auth_can_insert,
  has_table_privilege('anon', 'public.wo_messages', 'select') as anon_can_read, false as _expect_anon_can_read,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('wo_message_painter_ok', 'wo_message_thread_mine', 'wo_message_object_ok', 'wo_message_ping_due',
                       'wo_message_insert', 'wo_message_post', 'wo_message_post_from', 'wo_message_mark_read', 'wo_my_message_threads')) as functions, 9 as _expect_functions,
  has_function_privilege('authenticated', 'public.wo_message_post(uuid, uuid, text, text[])', 'execute') as auth_can_post, true as _expect_auth_can_post,
  has_function_privilege('anon', 'public.wo_message_post(uuid, uuid, text, text[])', 'execute') as anon_can_post, false as _expect_anon_can_post,
  has_function_privilege('anon', 'public.wo_my_message_threads()', 'execute') as anon_can_list, false as _expect_anon_can_list,
  has_function_privilege('authenticated', 'public.wo_message_post_from(text, uuid, uuid, text[])', 'execute') as auth_can_post_from, true as _expect_auth_can_post_from,
  has_function_privilege('anon', 'public.wo_message_post_from(text, uuid, uuid, text[])', 'execute') as anon_can_post_from, false as _expect_anon_can_post_from,
  has_function_privilege('authenticated', 'public.wo_message_insert(uuid, uuid, text, text, text[], text, uuid)', 'execute') as auth_can_insert_direct, false as _expect_auth_can_insert_direct,
  (select prosecdef from pg_proc where proname = 'wo_message_post_from') as post_from_definer, true as _expect_post_from_definer;

insert into public._prod_migrations(name) values ('20270249000000_wo_painter_messages.sql') on conflict (name) do nothing;
