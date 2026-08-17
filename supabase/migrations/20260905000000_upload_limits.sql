-- =============================================================================
-- Upload limits - audit finding C5
--
-- Every one of the six upload paths went straight from the browser to Storage
-- with nothing checking the file but the `accept=` attribute on the input,
-- which is a UI hint and not a control. A contractor could upload a 2 GB file,
-- or an HTML page as their insurance certificate.
--
-- The storage policies already say WHERE each person may write. This says WHAT.
-- Both numbers are enforced by Storage itself, server-side, so a hand-made
-- request with no browser involved is refused the same way:
--
--   file_size_limit     - bytes, checked against the actual uploaded body
--   allowed_mime_types  - checked against the request's content-type
--
-- The matching plain-English refusal shown before the upload starts lives in
-- lib/uploads/validate.ts. Change a limit here, change it there.
--
-- SVG is excluded everywhere on purpose: it can carry script, and these buckets
-- are served from an origin we would rather never execute anything.
--
-- Note this constrains NEW uploads. Anything already in a bucket stays as it
-- is - nothing in these buckets today is outside the lists below.
-- =============================================================================

-- ---- certificates and licences: a PDF, or a photo of one --------------------
update storage.buckets set
  file_size_limit = 15728640, -- 15 MB
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'
  ]
where id = 'contractor-docs';

-- ---- images: logos, product shots, estimate photos --------------------------
update storage.buckets set
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'
  ]
where id in ('contractor-logos', 'estimate-media', 'product-photos');

-- ---- presentations: posters and the fallback video file ---------------------
update storage.buckets set
  file_size_limit = 209715200, -- 200 MB
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif',
    'video/mp4','video/webm','video/quicktime'
  ]
where id = 'presentation-media';

update storage.buckets set
  file_size_limit = 15728640, -- 15 MB
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'
  ]
where id = 'presentation-docs';

-- ---- Verification -----------------------------------------------------------
-- Every bucket should now show a limit and a list, none of them null:
--   select id, file_size_limit, allowed_mime_types from storage.buckets order by id;
--
-- And from the portal, uploading a .txt renamed to .pdf must be refused by the
-- server ("mime type text/plain is not supported"), not merely by the screen.
