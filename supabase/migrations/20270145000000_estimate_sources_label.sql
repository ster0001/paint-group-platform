-- Tom, 15 Sep 2026 (exterior batch): the customer's side photos are labelled
-- by the side they were taken of ("Left side"), so the estimator's pack and
-- the scope editor's strip say which elevation each picture shows. The photo
-- route stores it; lib/wizard/documents.ts reads it ahead of the kind label.
-- Data-only column; safe to re-run.
alter table public.estimate_sources add column if not exists label text;
comment on column public.estimate_sources.label is 'Customer-facing label for the picture, e.g. the side of the house it shows (15 Sep 2026).';

-- Registers itself in the production ledger (added 16 Sep 2026: this file
-- shipped without it, so `select … from public._prod_migrations` could not say
-- whether it was live — see docs/ARCHITECTURE.md, the invoicing read-failure note).
insert into public._prod_migrations(name) values ('20270145000000_estimate_sources_label.sql') on conflict (name) do nothing;
