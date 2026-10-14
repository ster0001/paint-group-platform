-- 20270267 · Induction content and language — Step 4 of the induction brief
-- (docs/briefs/claude-code-brief-induction-demo-property.md §5, §8 Step 4; rulings I8, ⚑2, ⚑3).
--
-- What this adds:
--   · induction_languages — the seven codes (ruling I8), each with a live flag staff set
--     after the translation has been tested (⚑3). English is always live.
--   · induction_versions / induction_modules / induction_blocks — the induction as data:
--     one block row per module line per language, loaded by scripts/seed-induction.ts
--     from docs/induction/induction-v1.md (English) and docs/induction/translations/*.json.
--   · standards_strings — the finish standards sentences per language, keyed the way
--     lib/standards/strings.ts flattens the English model; the standards screens lay
--     them over the English model and fall back to English, logged, for any miss.
--   · contractors.induction_language and contractor_users.induction_language — the
--     painter record is contractors (Step 0 report); a worker login keeps its own.
--     Null means not chosen yet. Written only by induction_set_language.
-- Converges on a re-run. Paste starts with the lock timeout. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. languages ------------------------------------------------------------------------
create table if not exists public.induction_languages (
  code        text primary key,
  name        text not null,
  native_name text not null,
  dir         text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  live        boolean not null default false,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

insert into public.induction_languages (code, name, native_name, dir, live, sort) values
  ('en',    'English',             'English',   'ltr', true,  0),
  ('fa-AF', 'Dari (Afghan)',       'دری',       'rtl', false, 1),
  ('fa',    'Farsi',               'فارسی',     'rtl', false, 2),
  ('ar',    'Arabic (Lebanese)',   'العربية',   'rtl', false, 3),
  ('es',    'Spanish',             'Español',   'ltr', false, 4),
  ('pt-BR', 'Portuguese (Brazil)', 'Português', 'ltr', false, 5),
  ('it',    'Italian',             'Italiano',  'ltr', false, 6)
on conflict (code) do update set name = excluded.name, native_name = excluded.native_name, dir = excluded.dir, sort = excluded.sort;
update public.induction_languages set live = true where code = 'en' and not live;

-- ---- 2. the induction as data -------------------------------------------------------------
create table if not exists public.induction_versions (
  id            uuid primary key default gen_random_uuid(),
  version_kind  text not null default 'full' check (version_kind in ('full', 'refresher', 'worker')),
  version_no    integer not null check (version_no >= 1),
  title         text not null,
  published_at  date,
  is_material   boolean not null default true,
  change_note   text not null default '',
  source_file   text not null default '',
  created_at    timestamptz not null default now(),
  unique (version_kind, version_no)
);

create table if not exists public.induction_modules (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references public.induction_versions (id) on delete cascade,
  module_key         text not null check (module_key ~ '^m[0-9]{2}$'),
  sort               integer not null default 0,
  title              text not null,
  minutes            integer not null default 10 check (minutes > 0),
  standards_sections text[] not null default '{}',
  unique (version_id, module_key)
);
create index if not exists induction_modules_version_idx on public.induction_modules (version_id, sort);

create table if not exists public.induction_blocks (
  id         uuid primary key default gen_random_uuid(),
  module_id  uuid not null references public.induction_modules (id) on delete cascade,
  line_key   text not null check (line_key ~ '^(title|tick|s[0-9]+|w[0-9]+)$'),
  kind       text not null check (kind in ('title', 'statement', 'tick', 'worker_extra')),
  sort       integer not null default 0,
  audiences  text[] not null default '{contractor}',
  language   text not null references public.induction_languages (code),
  text       text not null check (length(trim(text)) > 0),
  unique (module_id, line_key, language)
);
create index if not exists induction_blocks_module_lang_idx on public.induction_blocks (module_id, language, sort);

create table if not exists public.standards_strings (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.standards_versions (id) on delete cascade,
  language   text not null references public.induction_languages (code),
  key        text not null,
  text       text not null check (length(trim(text)) > 0),
  unique (version_id, language, key)
);
create index if not exists standards_strings_version_lang_idx on public.standards_strings (version_id, language);

-- ---- 3. the painter choice ------------------------------------------------------------------
alter table public.contractors add column if not exists induction_language text references public.induction_languages (code);
alter table public.contractor_users add column if not exists induction_language text references public.induction_languages (code);

-- ---- 4. RLS: painters and staff read, nothing writes but the seed and the RPCs ------------
alter table public.induction_languages enable row level security;
alter table public.induction_versions  enable row level security;
alter table public.induction_modules   enable row level security;
alter table public.induction_blocks    enable row level security;
alter table public.standards_strings   enable row level security;

drop policy if exists induction_languages_read on public.induction_languages;
create policy induction_languages_read on public.induction_languages
  for select to authenticated using (true);
drop policy if exists induction_versions_read on public.induction_versions;
create policy induction_versions_read on public.induction_versions
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null or public.is_worker());
drop policy if exists induction_modules_read on public.induction_modules;
create policy induction_modules_read on public.induction_modules
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null or public.is_worker());
drop policy if exists induction_blocks_read on public.induction_blocks;
create policy induction_blocks_read on public.induction_blocks
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null or public.is_worker());
drop policy if exists standards_strings_read on public.standards_strings;
create policy standards_strings_read on public.standards_strings
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null or public.is_worker());

revoke all on public.induction_languages, public.induction_versions, public.induction_modules, public.induction_blocks, public.standards_strings from anon;
revoke insert, update, delete on public.induction_languages, public.induction_versions, public.induction_modules, public.induction_blocks, public.standards_strings from authenticated;
grant select on public.induction_languages, public.induction_versions, public.induction_modules, public.induction_blocks, public.standards_strings to authenticated;

-- ---- 5. RPCs ---------------------------------------------------------------------------------
-- The languages a painter may pick, for the join page (no session) and the picker.
create or replace function public.induction_languages_offered()
returns table (code text, name text, native_name text, dir text)
language sql stable security definer set search_path = public as $$
  select l.code, l.name, l.native_name, l.dir
    from public.induction_languages l
   where l.live or l.code = 'en'
   order by l.sort
$$;
revoke all on function public.induction_languages_offered() from public;
grant execute on function public.induction_languages_offered() to anon, authenticated;

-- The signed-in painter picks the language they read and tick in (ruling I8).
-- A contractor writes their own row; a worker login writes its contractor_users row.
create or replace function public.induction_set_language(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_wid uuid; v_ok boolean;
begin
  select (l.live or l.code = 'en') into v_ok from public.induction_languages l where l.code = p_code;
  if v_ok is null then return 'error:unknown_language'; end if;
  if not v_ok then return 'error:not_live'; end if;
  v_cid := public.current_contractor_id();
  if v_cid is not null then
    update public.contractors set induction_language = p_code where id = v_cid;
    return 'ok:' || p_code;
  end if;
  v_wid := public.current_worker_id();
  if v_wid is not null then
    update public.contractor_users set induction_language = p_code where id = v_wid;
    return 'ok:' || p_code;
  end if;
  return 'error:not_a_painter';
end $$;
revoke all on function public.induction_set_language(text) from public, anon;
grant execute on function public.induction_set_language(text) to authenticated;

-- The signed-in painter language, or null when not chosen yet (the screens then read English).
create or replace function public.induction_my_language()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.induction_language from public.contractors c where c.id = public.current_contractor_id()),
    (select cu.induction_language from public.contractor_users cu where cu.id = public.current_worker_id())
  )
$$;
revoke all on function public.induction_my_language() from public, anon;
grant execute on function public.induction_my_language() to authenticated;

-- Staff switch a language on once the Paint Group team has tested it (⚑3). English cannot be switched off.
create or replace function public.induction_language_set_live(p_code text, p_live boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_code = 'en' and not p_live then return 'error:english_always_live'; end if;
  update public.induction_languages set live = p_live, updated_at = now() where code = p_code;
  if not found then return 'error:unknown_language'; end if;
  return case when p_live then 'ok:live' else 'ok:off' end;
end $$;
revoke all on function public.induction_language_set_live(text, boolean) from public, anon;
grant execute on function public.induction_language_set_live(text, boolean) to authenticated;

-- ---- 6. read-back: compare each column to its _expect_ twin before calling this live ----
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('induction_languages','induction_versions','induction_modules','induction_blocks','standards_strings')) as tables, 5 as _expect_tables,
  (select count(*) from public.induction_languages) as languages, 7 as _expect_languages,
  (select count(*) from public.induction_languages where live) as live_languages, 1 as _expect_live_languages,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('induction_languages','induction_versions','induction_modules','induction_blocks','standards_strings')) as policies, 5 as _expect_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('induction_languages_offered','induction_set_language','induction_my_language','induction_language_set_live')) as functions, 4 as _expect_functions,
  (select count(*) from information_schema.columns where table_name = 'contractors' and column_name = 'induction_language') as contractor_column, 1 as _expect_contractor_column,
  (select count(*) from information_schema.columns where table_name = 'contractor_users' and column_name = 'induction_language') as worker_column, 1 as _expect_worker_column,
  (select count(*) from information_schema.role_routine_grants where routine_name = 'induction_languages_offered' and grantee = 'anon') as anon_offered_grant, 1 as _expect_anon_offered_grant;

insert into public._prod_migrations(name) values ('20270267000000_induction_content.sql') on conflict (name) do nothing;
