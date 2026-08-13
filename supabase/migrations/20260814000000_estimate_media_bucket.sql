-- =============================================================================
-- Storage bucket for estimate photos.
-- Public bucket (images are shown to customers), but only staff can upload/change.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('estimate-media', 'estimate-media', true)
on conflict (id) do nothing;

drop policy if exists "estimate_media_read"   on storage.objects;
drop policy if exists "estimate_media_insert" on storage.objects;
drop policy if exists "estimate_media_update" on storage.objects;
drop policy if exists "estimate_media_delete" on storage.objects;

create policy "estimate_media_read" on storage.objects
  for select using (bucket_id = 'estimate-media');
create policy "estimate_media_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'estimate-media' and public.is_staff());
create policy "estimate_media_update" on storage.objects
  for update to authenticated using (bucket_id = 'estimate-media' and public.is_staff());
create policy "estimate_media_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'estimate-media' and public.is_staff());
