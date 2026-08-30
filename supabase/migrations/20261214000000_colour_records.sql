-- =============================================================================
-- Trade portal v2 · Session 1b — colour_records (brief §4.1 + Tom's rulings 30 Aug)
--
-- One row per SURFACE GROUP at a PROPERTY, carrying provenance. This is the
-- colour fact table the diagnostic found missing: nothing in the platform
-- previously wrote "colour X went on surface Y at property Z".
--
-- Rulings encoded here:
--   · Colour is keyed by surface group (area_label × surface_type), never by
--     product — the first-colour-wins collapse (QuoteBuilder ~1128) is fixed
--     at SOURCE in session 2; this table is shaped to receive per-group truth.
--   · TBC is NEVER a row: colour_name is CHECK'd non-empty. The portal shows
--     the consult card from the WO's TBC state instead.
--   · Rows are never deleted or overwritten: a repaint marks the old row
--     superseded via superseded_by (self-FK). History stays.
--   · Backfilled rows from pre-fix (lossy, product-keyed) snapshots carry
--     source = historical_import AND colour_attribution_lossy = true so the
--     portal can label them "colours from original estimate — may not show
--     every room" (ruling 4).
--   · Writes: staff policy + session-2 SECURITY DEFINER RPCs only. Members
--     (non-finance, property-scoped) get SELECT — the invertible two-arm
--     policy shape from 3a-8; account_id is denormalised for exactly this.
--   · surface_type is TEXT, not an enum: values derive from the estimate's
--     surface codes (walls/ceilings/trims/doors/windows/fascia/…) which are
--     an open set in builder data, not a closed pg enum. The session-2 write
--     path normalises them; the DB does not guess.
--   · Status transitions (planned → applied → superseded) move only through
--     the session-2 server functions (CLAUDE.md state-machine law); no
--     member write path exists at all.
-- =============================================================================

do $$ begin
  create type public.colour_record_status as enum ('planned', 'applied', 'superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.colour_record_source as enum
    ('colour_schedule', 'wo_tick', 'staff_edit', 'historical_import');
exception when duplicate_object then null; end $$;

create table if not exists public.colour_records (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete restrict,
  account_id    uuid not null references public.accounts (id) on delete restrict,
  area_label    text not null check (btrim(area_label) <> ''),
  surface_type  text not null check (btrim(surface_type) <> ''),
  brand         text not null default '',
  product       text not null default '',
  colour_name   text not null check (btrim(colour_name) <> ''),
  colour_code   text not null default '',
  sheen         text not null default '',
  coats         integer not null default 0 check (coats >= 0),
  swatch_hex    text check (swatch_hex is null or swatch_hex ~* '^#[0-9a-f]{6}$'),
  status        public.colour_record_status not null default 'planned',
  applied_from  date,
  applied_to    date,
  source_job_id uuid references public.work_orders (id) on delete restrict,
  source        public.colour_record_source not null,
  colour_attribution_lossy boolean not null default false,
  superseded_by uuid references public.colour_records (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- applied_to never precedes applied_from; a superseded row must point at
  -- its successor, and only superseded rows may.
  constraint colour_records_dates check
    (applied_from is null or applied_to is null or applied_to >= applied_from),
  constraint colour_records_superseded_link check
    ((status = 'superseded') = (superseded_by is not null))
);

create index if not exists colour_records_property_status_idx
  on public.colour_records (property_id, status);
create index if not exists colour_records_account_idx
  on public.colour_records (account_id);
create index if not exists colour_records_source_job_idx
  on public.colour_records (source_job_id);
create index if not exists colour_records_superseded_by_idx
  on public.colour_records (superseded_by) where superseded_by is not null;

comment on table public.colour_records is
  'One row per surface group at a property. Written only by session-2 server functions and the backfill. TBC is never a row.';
comment on column public.colour_records.colour_attribution_lossy is
  'True on rows rebuilt from pre-fix product-keyed snapshots (first-colour-wins era) — portal labels these "may not show every room".';

-- ---- account_id inheritance (same structural pattern as property_references)

create or replace function public.colour_record_inherit_account()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_account uuid;
begin
  select account_id into v_account from public.properties where id = new.property_id;
  if v_account is null then
    raise exception 'property % has no account — cannot attach colour record', new.property_id;
  end if;
  if new.account_id is not null and new.account_id <> v_account then
    raise exception 'account/property mismatch on colour_records';
  end if;
  new.account_id := v_account;
  return new;
end $$;

drop trigger if exists colour_records_inherit_account on public.colour_records;
create trigger colour_records_inherit_account
  before insert on public.colour_records
  for each row execute function public.colour_record_inherit_account();

-- ---- RLS --------------------------------------------------------------------

alter table public.colour_records enable row level security;

drop policy if exists colour_records_staff_all on public.colour_records;
create policy colour_records_staff_all on public.colour_records
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Members: SELECT only, non-finance roles, within property scope. Finance
-- reads invoices/statements/references, never job detail (brief §4.2).
drop policy if exists colour_records_member_select on public.colour_records;
create policy colour_records_member_select on public.colour_records
  for select to authenticated
  using (
    account_id in (select au.account_id from public.account_users au
                   where au.profile_id = (select auth.uid())
                     and au.role <> 'finance' and au.property_scope is null)
    or property_id in (select unnest(au.property_scope) from public.account_users au
                       where au.profile_id = (select auth.uid())
                         and au.role <> 'finance' and au.property_scope is not null)
  );

-- ---- read-backs (CLAUDE.md law) --------------------------------------------

-- Expect: both enums, with their value lists
select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname in ('colour_record_status', 'colour_record_source')
group by t.typname order by t.typname;

-- Expect: the table, rls enabled = true
select relname, relrowsecurity from pg_class where relname = 'colour_records';

-- Expect: 2 policies
select policyname from pg_policies where tablename = 'colour_records' order by policyname;

-- Expect: 4 indexes + pkey
select indexname from pg_indexes
where tablename = 'colour_records' order by indexname;

-- Expect: the inheritance trigger
select tgname from pg_trigger where tgname = 'colour_records_inherit_account';
