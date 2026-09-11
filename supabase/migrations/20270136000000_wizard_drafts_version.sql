-- =============================================================================
-- One server truth for a part-finished wizard run — C3 (11 Sep 2026)
--
-- wizard_drafts autosaved last-write-wins: /api/wizard/draft read the open row,
-- then wrote the whole state back. Two tabs, a phone picked up beside a laptop,
-- or a staff member joining an assisted session through wizard_assist_patch and
-- the later write silently erased the earlier one. Nobody saw it happen — the
-- route is best-effort by design and answers 200 either way.
--
-- `version` makes the write conditional. The client sends the version it read;
-- the update carries `where version = <that>` and bumps it. Zero rows updated
-- means somebody else moved first, and the route answers 409 WITH the server's
-- copy so the client can merge instead of guessing.
--
-- `last_screen` is where they actually were — the quick look's step name
-- ("start", "place", "job", "condition") or a page label. current_page and
-- furthest_page are numbers for the funnel; this is the string the estimator
-- reads when they open a live session and the customer is still in it.
--
-- Backfill: existing rows get version 1, which is what the client assumes when
-- it has never seen a version. No row needs rewriting.
-- =============================================================================

alter table public.wizard_drafts
  add column if not exists version int not null default 1,
  add column if not exists last_screen text;

comment on column public.wizard_drafts.version is
  'Optimistic concurrency. The client sends the version it read; /api/wizard/draft updates only where it still matches and bumps it, answering 409 with the server copy otherwise. Never decremented.';
comment on column public.wizard_drafts.last_screen is
  'Where the customer actually was — the quick-look step or page label, not a number. Read by staff opening a live session and by the resume.';

-- A guard rather than a convention: version only ever goes forward, so a stale
-- client cannot rewind it by sending an old number in an otherwise valid write.
create or replace function public.wizard_drafts_version_forward()
returns trigger language plpgsql as $$
begin
  if new.version < old.version then
    raise exception 'wizard_drafts.version cannot go backwards (% -> %)', old.version, new.version
      using errcode = '22003';
  end if;
  return new;
end $$;

drop trigger if exists t_wizard_drafts_version_forward on public.wizard_drafts;
create trigger t_wizard_drafts_version_forward before update on public.wizard_drafts
  for each row execute function public.wizard_drafts_version_forward();

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'wizard_drafts'
          and column_name in ('version', 'last_screen')) <> 2 then
    raise exception 'read-back: wizard_drafts.version / last_screen missing';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 't_wizard_drafts_version_forward'
  ) then
    raise exception 'read-back: the version-forward trigger is missing';
  end if;
end $$;

-- Paste the result in chat: expect 2 rows (last_screen, version).
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'wizard_drafts'
   and column_name in ('version', 'last_screen')
 order by column_name;

insert into public._prod_migrations(name)
values ('20270136000000_wizard_drafts_version.sql')
on conflict (name) do nothing;
