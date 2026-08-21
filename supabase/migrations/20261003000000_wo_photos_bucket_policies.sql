-- =============================================================================
-- WO loop — storage policies for the wo-photos bucket
--
-- 20260927 created the bucket but no policies on storage.objects, so every
-- upload failed at the signed-URL step with a 502 the painter would have read
-- as "try again in a moment" for ever. Found by driving the real screen: the
-- bucket existing is not the same as the bucket being usable.
--
-- Objects live at wo/<work_order_id>/<file>, so the work order is the second
-- path segment and that is what authorises the object. Private bucket: reads go
-- through short-lived signed URLs, the contractor-docs convention.
-- =============================================================================

-- Who may touch photos for a given work order: staff, the assigned contractor,
-- or the job's own customer. Text in, because it comes out of a storage path.
create or replace function public.wo_photo_access(p_wo_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare v_id uuid;
begin
  begin
    v_id := p_wo_id::uuid;
  exception when invalid_text_representation then
    return false;                     -- a path that isn't ours authorises nothing
  end;

  if public.is_staff() then return true; end if;

  return exists (
    select 1 from public.work_orders w
     where w.id = v_id
       and (
         (w.contractor_id is not null and w.contractor_id = public.current_contractor_id())
         or exists (select 1 from public.estimates e
                      join public.customers c on c.id = e.customer_id
                     where e.id = w.estimate_id and c.profile_id = auth.uid())
       )
  );
end $$;

drop policy if exists wo_photos_insert on storage.objects;
create policy wo_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'wo-photos'
    and split_part(name, '/', 1) = 'wo'
    and public.wo_photo_access(split_part(name, '/', 2))
  );

drop policy if exists wo_photos_select on storage.objects;
create policy wo_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'wo-photos'
    and public.wo_photo_access(split_part(name, '/', 2))
  );

-- Deletes exist so the ingest route can clear a file that failed its magic-byte
-- check rather than leaving an orphan in the bucket.
drop policy if exists wo_photos_delete on storage.objects;
create policy wo_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'wo-photos'
    and public.wo_photo_access(split_part(name, '/', 2))
  );

-- ---- Verification -----------------------------------------------------------
-- As the assigned contractor, from the portal: raise a variation with a photo.
--   -> the upload succeeds and wo_photos has the row
-- As a contractor who is NOT on that job, request a signed upload URL for the
-- same path -> refused by the policy, not by the app.
