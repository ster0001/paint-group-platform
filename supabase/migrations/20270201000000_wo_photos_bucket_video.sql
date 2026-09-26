-- =============================================================================
-- The wo-photos bucket takes videos (Tom, 26 Sep 2026).
--
-- 20260927 created the bucket with allowed_mime_types = the five image types
-- and a 25 MB file_size_limit. The app now names and sniffs videos (PR #150),
-- but Supabase Storage checks the request's content-type against this list
-- BEFORE the bytes land — so every painter's video PUT was refused with
-- "mime type video/mp4 is not supported" (found by e2e/wo-photos.spec.ts on
-- the test project). Add the three video types the app accepts and lift the
-- limit to the app's video cap. Photos are still capped at 25 MB by the route.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

update storage.buckets
   set file_size_limit = 209715200,   -- 200 MB, = MAX_VIDEO_UPLOAD_BYTES
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
                                  'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'wo-photos';

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select file_size_limit from storage.buckets where id = 'wo-photos') as size_limit, 209715200 as _expect_size_limit,
  (select 'video/mp4' = any (allowed_mime_types) and 'video/quicktime' = any (allowed_mime_types) and 'video/webm' = any (allowed_mime_types)
     from storage.buckets where id = 'wo-photos') as video_allowed, true as _expect_video_allowed,
  (select 'image/jpeg' = any (allowed_mime_types) from storage.buckets where id = 'wo-photos') as photos_still_allowed, true as _expect_photos_still_allowed,
  (select public from storage.buckets where id = 'wo-photos') as is_public, false as _expect_is_public;

insert into public._prod_migrations(name) values ('20270201000000_wo_photos_bucket_video.sql') on conflict (name) do nothing;
