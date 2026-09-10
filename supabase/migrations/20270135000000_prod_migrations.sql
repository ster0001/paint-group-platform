-- =============================================================================
-- The production migration ledger (C0, 11 Sep 2026)
--
-- The audit of 11 Sep found there is no way to answer "is this migration live?"
-- from anything but memory. 180 files in supabase/migrations/, seven duplicate
-- numbers, one gap, a handoff doc stale since 6 Sep, and drift documented in
-- both directions. Tom pastes SQL by hand, so the repo has never been proof of
-- what production actually ran.
--
-- public._prod_migrations is that proof. One row per migration file that has
-- been applied to production, named exactly as the file is named. From here on
-- EVERY migration ends with its own insert, so the row lands in the same paste
-- as the statements it records — no separate bookkeeping step to forget.
--
-- Backfill is Tom's, once: the PR body carries an INSERT for all 180 existing
-- files; he deletes the lines he knows are NOT live before pasting. A missing
-- row after that means "not applied", not "unknown".
--
-- Underscore prefix: this is operational bookkeeping, not product data. It sorts
-- away from the domain tables and reads as plumbing at a glance.
-- =============================================================================

create table if not exists public._prod_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);

comment on table public._prod_migrations is
  'One row per migration file applied to PRODUCTION, named exactly as the file in supabase/migrations/. Every migration self-registers with a final insert. A file with no row here has not been applied.';
comment on column public._prod_migrations.name is
  'The migration filename, including the .sql extension — e.g. 20270135000000_prod_migrations.sql.';
comment on column public._prod_migrations.applied_at is
  'When the row was written, which is when the migration was pasted into production.';

-- RLS: staff read it (the console and the handoff doc want to show it); nobody
-- writes it over REST. Writes come from the SQL editor and the service client
-- only, which is exactly how migrations are applied.
alter table public._prod_migrations enable row level security;

drop policy if exists prod_migrations_staff_read on public._prod_migrations;
create policy prod_migrations_staff_read on public._prod_migrations
  for select using (public.is_staff());

revoke insert, update, delete on public._prod_migrations from anon, authenticated;

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = '_prod_migrations'
  ) then
    raise exception 'read-back: public._prod_migrations was not created';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = '_prod_migrations'
       and policyname = 'prod_migrations_staff_read'
  ) then
    raise exception 'read-back: prod_migrations_staff_read policy is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public._prod_migrations'::regclass) then
    raise exception 'read-back: RLS is not enabled on public._prod_migrations';
  end if;
end $$;

-- ---- self-registration --------------------------------------------------------
-- The rule this table exists to enforce, applied to itself first.
insert into public._prod_migrations(name)
values ('20270135000000_prod_migrations.sql')
on conflict (name) do nothing;

-- Paste the result in chat: expect one row, this migration.
select name, applied_at from public._prod_migrations order by name;
