-- =============================================================================
-- Videos in the estimate (Tom, 19 Oct 2026): make sure vids can be added in the estimate.
--
-- The estimate builder uploads an area or surface clip into the PUBLIC
-- estimate-media bucket beside the photos; the snapshot carries its public URL
-- in areas[].photos like any photo, and every reader tells a video by its
-- extension (lib/media/video.ts). The bucket itself is the real guard
-- (20260905000000 set it to images only, 10 MB), so it must now admit the
-- three video types the painter buckets already take, at the same 200 MB cap
-- as presentation-media. Images keep the same list; nothing else changes.
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

update storage.buckets set
  file_size_limit = 209715200, -- 200 MB
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif',
    'video/mp4','video/webm','video/quicktime'
  ]
where id = 'estimate-media';

-- ---- read-back: compare to the _expect_ columns before calling this live ----
select
  file_size_limit as size_limit, 209715200 as _expect_size_limit,
  array_length(allowed_mime_types, 1) as mime_count, 10 as _expect_mime_count,
  'video/mp4' = any(allowed_mime_types) as mp4_allowed, true as _expect_mp4_allowed,
  'video/quicktime' = any(allowed_mime_types) as mov_allowed, true as _expect_mov_allowed
from storage.buckets where id = 'estimate-media';

insert into public._prod_migrations(name) values ('20270276000000_estimate_media_video.sql') on conflict (name) do nothing;
