-- =============================================================================
-- Homepage v2 · §4.4a · showcase_jobs — "Real jobs, real prices"
-- (docs/briefs/homepage-v2-build-brief.md, session 2)
--
-- One table. Tom enters finished jobs in Settings → Showcase (session 3);
-- the homepage cards and /work/[slug] project pages (sessions 4–5) read the
-- PUBLISHED rows. Public select where published = true; staff read
-- everything; NO client write policy at all — the only write path is the
-- zod'd server action (lib/showcase/actions.ts) through the service client,
-- the same law as crm_events / work_item_dismissals.
--
-- Media: Site Capture (and its media table) is not merged, so the brief's
-- `hero_media_id → media` cannot exist yet. Photos are storage paths in the
-- `showcase-media` bucket (public read, staff-only write, 10 MB images —
-- the same pattern as presentation-media). ⚑9.11 applies: consent_confirmed
-- lives on the row and publishing is REFUSED while it is false. When Site
-- Capture lands, swap the path columns for media ids in a follow-up.
--
-- Constraints mirror the business rules (CLAUDE.md): low ≤ high, scope line
-- ≤ 90 chars, featured ranks 1–3 unique, slug shape + locked after publish,
-- and a row cannot be published without a hero photo, a price range, a
-- completion month and photo consent.
--
-- A3 tenancy: tenant_id defaulting to current_tenant(). Idempotent.
-- =============================================================================

do $$ begin
  create type public.showcase_job_type as enum ('interior', 'exterior', 'commercial', 'heritage', 'body_corporate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.showcase_property_type as enum ('home', 'business');
exception when duplicate_object then null; end $$;

create table if not exists public.showcase_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) default public.current_tenant(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- From title + suburb, editable, IMMUTABLE once published (trigger below).
  slug              text not null
    constraint showcase_jobs_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),
  title             text not null
    constraint showcase_jobs_title_present check (length(trim(title)) between 1 and 120),
  job_type          public.showcase_job_type not null,
  property_type     public.showcase_property_type not null,
  suburb            text not null
    constraint showcase_jobs_suburb_present check (length(trim(suburb)) between 1 and 80),
  completed_on      date,
  days_on_site      integer
    constraint showcase_jobs_days_range check (days_on_site is null or days_on_site between 1 and 365),

  -- AUD inc. GST, integer cents (CLAUDE.md money law); rendered "$8,400 – $9,600".
  price_low_cents   integer,
  price_high_cents  integer,
  constraint showcase_jobs_price_nonneg check (coalesce(price_low_cents, 0) >= 0 and coalesce(price_high_cents, 0) >= 0),
  constraint showcase_jobs_price_order  check (price_low_cents is null or price_high_cents is null or price_low_cents <= price_high_cents),

  scope_line        text not null default ''
    constraint showcase_jobs_scope_line_len check (length(scope_line) <= 90),
  summary           text not null default ''
    constraint showcase_jobs_summary_len check (length(summary) <= 2000),
  what_we_did       jsonb not null default '[]'::jsonb
    constraint showcase_jobs_wwd_array check (jsonb_typeof(what_we_did) = 'array'),
  colours           jsonb not null default '[]'::jsonb
    constraint showcase_jobs_colours_array check (jsonb_typeof(colours) = 'array'),
  condition_notes   text not null default ''
    constraint showcase_jobs_condition_len check (length(condition_notes) <= 2000),

  -- Storage paths in the showcase-media bucket (see header).
  hero_path         text
    constraint showcase_jobs_hero_path_shape check (hero_path is null or (hero_path ~ '^[A-Za-z0-9/._-]+$' and length(hero_path) <= 300)),
  gallery           jsonb not null default '[]'::jsonb
    constraint showcase_jobs_gallery_array check (jsonb_typeof(gallery) = 'array'),

  -- When set, the wizard pre-fill clones this estimate's scope tree (session 4).
  estimate_id       uuid references public.estimates (id) on delete set null,

  -- ⚑9.13: first name + suburb only.
  review_quote      text
    constraint showcase_jobs_review_quote_len check (review_quote is null or length(review_quote) <= 600),
  review_name       text
    constraint showcase_jobs_review_name_len check (review_name is null or length(review_name) <= 80),

  -- The three lowest non-null ranks are the homepage cards; 1–3, unique.
  featured_rank     integer
    constraint showcase_jobs_rank_range check (featured_rank is null or featured_rank between 1 and 3),

  -- ⚑9.11: marketing use of the photos confirmed with the customer.
  consent_confirmed boolean not null default false,
  published         boolean not null default false,
  published_at      timestamptz,

  constraint showcase_jobs_publish_ready check (
    not published or (
      hero_path is not null
      and price_low_cents is not null and price_high_cents is not null
      and completed_on is not null
      and consent_confirmed
    )
  )
);

comment on table public.showcase_jobs is
  'Homepage brief §4.4a. Finished jobs shown as "Real jobs, real prices" cards and /work/[slug] pages. Public reads published rows; written ONLY through lib/showcase/actions.ts (service client) — no client write policy by design.';

-- Postgres caps a regex repetition count at 255, so the path rule is
-- "shape + length", not {1,300}. Drop-and-add so a project that took the
-- earlier form converges.
alter table public.showcase_jobs drop constraint if exists showcase_jobs_hero_path_shape;
alter table public.showcase_jobs add constraint showcase_jobs_hero_path_shape
  check (hero_path is null or (hero_path ~ '^[A-Za-z0-9/._-]+$' and length(hero_path) <= 300));

create unique index if not exists showcase_jobs_slug_key     on public.showcase_jobs (tenant_id, slug);
create unique index if not exists showcase_jobs_featured_key on public.showcase_jobs (tenant_id, featured_rank) where featured_rank is not null;
create index        if not exists showcase_jobs_public_idx   on public.showcase_jobs (tenant_id, published, completed_on desc);
create index        if not exists showcase_jobs_estimate_idx on public.showcase_jobs (estimate_id);

-- ---- triggers: updated_at, slug lock, published_at ------------------------

drop trigger if exists t_showcase_jobs_updated on public.showcase_jobs;
create trigger t_showcase_jobs_updated before update on public.showcase_jobs
  for each row execute function public.set_updated_at();

create or replace function public.showcase_jobs_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.published and new.slug <> old.slug then
    raise exception 'showcase_jobs: the slug is locked once a job is published' using errcode = '23514';
  end if;
  if new.published and (tg_op = 'INSERT' or not old.published) then
    new.published_at := now();
  end if;
  if not new.published then
    new.published_at := null;
  end if;
  return new;
end $$;

drop trigger if exists t_showcase_jobs_guard on public.showcase_jobs;
create trigger t_showcase_jobs_guard before insert or update on public.showcase_jobs
  for each row execute function public.showcase_jobs_guard();

-- ---- RLS ------------------------------------------------------------------

alter table public.showcase_jobs enable row level security;

drop policy if exists showcase_jobs_public_read on public.showcase_jobs;
create policy showcase_jobs_public_read on public.showcase_jobs
  for select to anon, authenticated
  using (published);

drop policy if exists showcase_jobs_staff_read on public.showcase_jobs;
create policy showcase_jobs_staff_read on public.showcase_jobs
  for select to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant());

-- No INSERT/UPDATE/DELETE policy for any client role, and the default table
-- privileges Supabase grants to new tables are taken back, so a client can't
-- even reach RLS for a write: the server action (service role) is the path.
revoke insert, update, delete, truncate, references, trigger on public.showcase_jobs from anon, authenticated;
grant select on public.showcase_jobs to anon, authenticated;

-- ---- storage: showcase-media (public read, staff-only write, 10 MB images) --

insert into storage.buckets (id, name, public) values ('showcase-media', 'showcase-media', true) on conflict (id) do nothing;

update storage.buckets set
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']
where id = 'showcase-media';

do $$
declare b text := 'showcase-media';
begin
  execute format('drop policy if exists %I on storage.objects', b||'_read');
  execute format('drop policy if exists %I on storage.objects', b||'_insert');
  execute format('drop policy if exists %I on storage.objects', b||'_update');
  execute format('drop policy if exists %I on storage.objects', b||'_delete');
  execute format($f$create policy %I on storage.objects for select using (bucket_id = %L)$f$, b||'_read', b);
  execute format($f$create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_staff())$f$, b||'_insert', b);
  execute format($f$create policy %I on storage.objects for update to authenticated using (bucket_id = %L and public.is_staff())$f$, b||'_update', b);
  execute format($f$create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_staff())$f$, b||'_delete', b);
end $$;

-- ---- read-backs (CLAUDE.md: a migration "running" ≠ its statements applying)

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'showcase_jobs') then
    raise exception 'read-back: showcase_jobs missing';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'showcase_jobs') <> 2 then
    raise exception 'read-back: expected 2 policies on showcase_jobs';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'showcase-media%') <> 4 then
    raise exception 'read-back: expected 4 storage policies for showcase-media';
  end if;
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'showcase_jobs'
               and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'read-back: a client role still holds a write grant on showcase_jobs';
  end if;
  if not exists (select 1 from storage.buckets where id = 'showcase-media' and public) then
    raise exception 'read-back: showcase-media bucket missing or not public';
  end if;
end $$;

-- Paste the result in chat: expect 2 rows (showcase_jobs_public_read, showcase_jobs_staff_read).
select policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename = 'showcase_jobs' order by policyname;
