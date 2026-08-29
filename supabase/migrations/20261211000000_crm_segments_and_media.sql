-- =============================================================================
-- CRM · segments become YOURS, and campaign emails get real photos
--
-- Tom, 30 Aug: "I can't create the segments section myself or edit any
-- information … we need to have control over building this, not a predefined
-- list which has already been created."
--
-- Two things:
--
--   crm_segments — the lists move out of code and into a table the office
--     edits. The three built-in lists are seeded as ORDINARY EDITABLE ROWS
--     (marked standing only so the UI can label them); from here on a list is
--     created in the app, not in a deploy. Criteria stay the typed form shape
--     lib/crm/segments.ts validates — the column holds data, never a query.
--
--   campaign-media — a public bucket for the photos that go INTO marketing
--     emails. Public because email clients fetch images with no credentials;
--     an email pointing at a private bucket renders as broken squares. Staff
--     write, world reads — the same shape as product-photos.
--
-- tenant_id per the A3 ruling.
-- =============================================================================

-- ---- 1 · the segments table ------------------------------------------------

create table if not exists public.crm_segments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) default public.current_tenant(),
  key         text not null,
  name        text not null,
  description text not null default '',
  -- The typed criteria rows, exactly as the evaluator reads them.
  criteria    jsonb not null default '[]'::jsonb,
  -- Seeded with the product. Editable like any other; the flag only labels it.
  standing    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint crm_segments_key_unique unique (tenant_id, key)
);
comment on table public.crm_segments is
  'Customer lists, office-built. Criteria are typed form rows read by the one evaluator — the board preview, the campaign dry run and the sweep all see the same people.';

drop trigger if exists t_crm_segments_updated on public.crm_segments;
create trigger t_crm_segments_updated before update on public.crm_segments
  for each row execute function public.set_updated_at();

alter table public.crm_segments enable row level security;

drop policy if exists crm_segments_staff_all on public.crm_segments;
create policy crm_segments_staff_all on public.crm_segments
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

revoke all on public.crm_segments from anon;

-- ---- 2 · the built-in lists become editable rows ----------------------------
-- Idempotent: an existing key is left exactly as the office has edited it.

insert into public.crm_segments (key, name, description, criteria, standing)
values
  ('past_customers', 'Past customers',
   'People who accepted a quote and had the work done. Not people we quoted and lost.',
   '[{"field":"is_customer","op":"is","value":true},
     {"field":"status","op":"is_not","value":["unsubscribed"]}]'::jsonb, true),
  ('interior_no_exterior', 'Interior customers with no exterior job',
   'You painted their inside. Nobody has ever quoted their outside.',
   '[{"field":"is_customer","op":"is","value":true},
     {"field":"job_type","op":"is","value":"interior"},
     {"field":"has_job_type","op":"is_not","value":"exterior"},
     {"field":"status","op":"is_not","value":["unsubscribed","open_work"]}]'::jsonb, true),
  ('exteriors_due_repaint', 'Exteriors due a repaint',
   'Exterior work finished more than seven years ago, and quiet for a year.',
   '[{"field":"is_customer","op":"is","value":true},
     {"field":"job_type","op":"is","value":"exterior"},
     {"field":"completed","op":"more_than","months":84},
     {"field":"last_contact","op":"more_than","months":12},
     {"field":"status","op":"is_not","value":["unsubscribed","open_work"]}]'::jsonb, true)
on conflict (tenant_id, key) do nothing;

-- ---- 3 · the campaign media bucket ------------------------------------------
-- Images only, 10 MB — an email photo larger than that is a mistake either way.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('campaign-media', 'campaign-media', true, 10485760,
          array['image/jpeg','image/png','image/webp','image/gif'])
  on conflict (id) do update
    set public = true, file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "campaign_media_read"   on storage.objects;
drop policy if exists "campaign_media_insert" on storage.objects;
drop policy if exists "campaign_media_update" on storage.objects;
drop policy if exists "campaign_media_delete" on storage.objects;

create policy "campaign_media_read" on storage.objects
  for select using (bucket_id = 'campaign-media');
create policy "campaign_media_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'campaign-media' and public.is_staff());
create policy "campaign_media_update" on storage.objects
  for update to authenticated using (bucket_id = 'campaign-media' and public.is_staff());
create policy "campaign_media_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'campaign-media' and public.is_staff());

-- ---- Verification -----------------------------------------------------------
-- As staff:
--   select key, name, standing, jsonb_array_length(criteria) from crm_segments;
--     -> the three seeded lists, standing = true
--   select id, public, file_size_limit from storage.buckets where id = 'campaign-media';
--     -> public = true, 10485760
-- As anon:
--   select * from crm_segments;   -> permission denied
