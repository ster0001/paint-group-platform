-- =============================================================================
-- Tom, 5 Sep 2026 — a video on a showcase job (testimonial, progress, or
-- anything else), YouTube or Vimeo. Shown in the project page's "What the
-- customer said" block as a poster + play (the player loads only on play),
-- with a transcript under it (accessibility + indexable text) and VideoObject
-- schema. One of them can be the homepage's featured review video
-- (Settings → Website). Idempotent; read-back at the end.
-- =============================================================================

alter table public.showcase_jobs add column if not exists video_url text
  constraint showcase_jobs_video_url_shape check (video_url is null or (video_url ~ '^https://' and length(video_url) <= 300));
alter table public.showcase_jobs add column if not exists video_caption text
  constraint showcase_jobs_video_caption_len check (video_caption is null or length(video_caption) <= 160);
alter table public.showcase_jobs add column if not exists video_transcript text
  constraint showcase_jobs_video_transcript_len check (video_transcript is null or length(video_transcript) <= 20000);
alter table public.showcase_jobs add column if not exists video_poster_path text
  constraint showcase_jobs_video_poster_shape check (video_poster_path is null or (video_poster_path ~ '^[A-Za-z0-9/._-]+$' and length(video_poster_path) <= 300));

do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'showcase_jobs'
        and column_name in ('video_url', 'video_caption', 'video_transcript', 'video_poster_path')) <> 4 then
    raise exception 'read-back: showcase_jobs video columns missing';
  end if;
end $$;

-- Paste the result in chat: expect 4 rows.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'showcase_jobs' and column_name like 'video_%' order by column_name;
