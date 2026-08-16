-- =============================================================================
-- Presentations — ordered typed content blocks injected into the estimate view
-- when a presentation is ticked on an estimate. Content is snapshotted into the
-- estimate's sent_snapshot at send time (like scope), so later edits only affect
-- future sends. Storage buckets hold the media/docs.
-- =============================================================================

do $$ begin
  create type public.presentation_block_kind as enum ('video', 'before_after_gallery', 'review_set', 'capability_panel');
exception when duplicate_object then null; end $$;

create table if not exists public.presentations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  is_default  boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.presentation_blocks (
  id              uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations (id) on delete cascade,
  kind            public.presentation_block_kind not null,
  position        integer not null default 0,
  enabled         boolean not null default true,
  content         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists presentation_blocks_pres_idx on public.presentation_blocks (presentation_id, position);

-- The tick: which presentation (if any) this estimate uses.
alter table public.estimates add column if not exists presentation_id uuid references public.presentations (id) on delete set null;

alter table public.presentations       enable row level security;
alter table public.presentation_blocks enable row level security;
drop policy if exists presentations_staff on public.presentations;
create policy presentations_staff on public.presentations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists presentation_blocks_staff on public.presentation_blocks;
create policy presentation_blocks_staff on public.presentation_blocks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- Storage buckets (public read, staff-only write) ------------------------
insert into storage.buckets (id, name, public) values ('presentation-media', 'presentation-media', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('presentation-docs',  'presentation-docs',  true) on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['presentation-media','presentation-docs'] loop
    execute format('drop policy if exists %I on storage.objects', b||'_read');
    execute format('drop policy if exists %I on storage.objects', b||'_insert');
    execute format('drop policy if exists %I on storage.objects', b||'_update');
    execute format('drop policy if exists %I on storage.objects', b||'_delete');
    execute format($f$create policy %I on storage.objects for select using (bucket_id = %L)$f$, b||'_read', b);
    execute format($f$create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_staff())$f$, b||'_insert', b);
    execute format($f$create policy %I on storage.objects for update to authenticated using (bucket_id = %L and public.is_staff())$f$, b||'_update', b);
    execute format($f$create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_staff())$f$, b||'_delete', b);
  end loop;
end $$;

-- Verification: expect presentations + presentation_blocks + the estimates column + 2 buckets.
-- select count(*) from public.presentations;
-- select id from storage.buckets where id in ('presentation-media','presentation-docs');
