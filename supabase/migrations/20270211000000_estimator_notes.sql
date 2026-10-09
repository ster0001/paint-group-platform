-- =============================================================================
-- Estimator notes (Tom, 4 Oct 2026): "an estimator notes section at the top
-- … add notes or a voice recording … added in the PC command page in the
-- project … internal … not for contractors".
--
-- One table, one private bucket. A note is text or a voice memo (the memo is
-- a file in `estimator-notes`, the row points at it). Staff only at every
-- layer: the table has no contractor or customer policy, the bucket is
-- private with staff-only object policies, and nothing here is ever copied
-- into a work-order snapshot or any /w, /e or portal surface.
--
-- The existing free-text "Admin notes" box on the builder (builder_state.
-- adminNotes) stays as it is; this is the dated, per-note log beside it.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. table ----------------------------------------------------------------
create table if not exists public.estimate_notes (
  id               uuid primary key default gen_random_uuid(),
  estimate_id      uuid not null references public.estimates (id) on delete cascade,
  kind             text not null check (kind in ('text', 'voice')),
  body             text not null default '',
  -- voice only: the object in the estimator-notes bucket, "<estimate_id>/<ts>.<ext>"
  audio_path       text,
  audio_mime       text,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 3600),
  author           uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint estimate_notes_body_len check (char_length(body) <= 4000),
  -- a text note says something; a voice note points at a recording
  constraint estimate_notes_shape check (
    (kind = 'text' and char_length(btrim(body)) >= 1)
    or (kind = 'voice' and audio_path is not null and audio_path like estimate_id::text || '/%')
  )
);
create index if not exists estimate_notes_estimate_idx on public.estimate_notes (estimate_id, created_at desc);

alter table public.estimate_notes enable row level security;
drop policy if exists estimate_notes_staff on public.estimate_notes;
create policy estimate_notes_staff on public.estimate_notes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- Plain writes under the staff policy, as wo_booking_notes does: no money, no state.
grant select, insert, delete on public.estimate_notes to authenticated;
revoke all on public.estimate_notes from anon;

-- ---- 2. the bucket — PRIVATE, staff only, audio only, 25 MB -----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estimator-notes', 'estimator-notes', false, 26214400,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists estimator_notes_read   on storage.objects;
drop policy if exists estimator_notes_write  on storage.objects;
drop policy if exists estimator_notes_delete on storage.objects;
create policy estimator_notes_read on storage.objects for select to authenticated
  using (bucket_id = 'estimator-notes' and public.is_staff());
create policy estimator_notes_write on storage.objects for insert to authenticated
  with check (bucket_id = 'estimator-notes' and public.is_staff());
create policy estimator_notes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'estimator-notes' and public.is_staff());

-- ---- 3. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'estimate_notes') as table_policies,
  1 as _expect_table_policies,
  (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'estimator_notes_%') as bucket_policies,
  3 as _expect_bucket_policies,
  (select not public from storage.buckets where id = 'estimator-notes') as bucket_private,
  true as _expect_bucket_private,
  (select 'audio/webm' = any (allowed_mime_types) from storage.buckets where id = 'estimator-notes') as webm_allowed,
  true as _expect_webm_allowed;

insert into public._prod_migrations(name) values ('20270211000000_estimator_notes.sql') on conflict (name) do nothing;
