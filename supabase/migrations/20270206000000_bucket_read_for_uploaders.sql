-- =============================================================================
-- Uploads to the public buckets fail with "new row violates row-level security
-- policy" (Tom, 30 Sep 2026: "unable to add photos to new products").
--
-- Cause: 20270201 (Security Advisor) dropped the `for select to public` policy
-- on the seven public buckets, because public URLs never consult policies and
-- the only thing that policy enabled was anonymous listing. What it ALSO
-- enabled — unseen — was the storage API's own read on upload: an upload with
-- `upsert: true` (every browser uploader in Settings, the builder's SWMS, the
-- portal logo) looks the object up and updates it on conflict, and under RLS
-- that lookup needs SELECT. With no select policy at all, Storage answers with
-- the RLS violation and the photo never lands.
--
-- Fix: a SELECT policy per bucket scoped to the people who may WRITE it —
-- staff for six of them, any signed-in user for contractor-logos (its write
-- policy is `to authenticated`, unchanged since 20260822). Never `to public`,
-- never anon: the advisor's finding (anonymous listing) stays closed.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

do $$
declare b text;
begin
  foreach b in array array['product-photos', 'estimate-media', 'presentation-media', 'presentation-docs', 'campaign-media', 'showcase-media']
  loop
    execute format('drop policy if exists %I on storage.objects', b || '_uploader_read');
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.is_staff())',
      b || '_uploader_read', b);
  end loop;
end $$;

drop policy if exists "contractor-logos_uploader_read" on storage.objects;
create policy "contractor-logos_uploader_read" on storage.objects
  for select to authenticated using (bucket_id = 'contractor-logos');

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname like '%\_uploader\_read' escape '\') as uploader_read_policies, 7 as _expect_uploader_read_policies,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname like '%\_uploader\_read' escape '\' and 'anon' = any(roles)) as anon_can_list, 0 as _expect_anon_can_list,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname like '%\_uploader\_read' escape '\' and roles = '{public}') as public_can_list, 0 as _expect_public_can_list;

insert into public._prod_migrations(name) values ('20270206000000_bucket_read_for_uploaders.sql') on conflict (name) do nothing;
