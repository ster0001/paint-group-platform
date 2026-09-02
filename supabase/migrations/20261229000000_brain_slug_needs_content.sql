-- =============================================================================
-- Assistant S6 — the Brain import needs two things brain_entries lacked:
--   slug           stable id per entry (the ### heading in docs/brain/*.md) so
--                  the importer is idempotent and Tom's edits survive re-imports;
--   needs_content  the [TOM TO WRITE] flag — the entry exists as a topic but
--                  its answer is a placeholder that must NEVER be served
--                  (brain-v1.md import instruction 2).
-- Idempotent; read-back at the end.
-- =============================================================================

alter table public.brain_entries add column if not exists slug text;
alter table public.brain_entries add column if not exists needs_content boolean not null default false;

create unique index if not exists brain_entries_slug_key on public.brain_entries (tenant_id, slug) where slug is not null;

comment on column public.brain_entries.needs_content is
  'True = topic known, answer not yet written by Tom. Retrieval treats these as absent: "no entry yet, want a person?"';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'brain_entries' and column_name = 'slug') then
    raise exception 'read-back: brain_entries.slug missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'brain_entries' and column_name = 'needs_content') then
    raise exception 'read-back: brain_entries.needs_content missing';
  end if;
end $$;

select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'brain_entries' and column_name in ('slug', 'needs_content')
 order by column_name;
