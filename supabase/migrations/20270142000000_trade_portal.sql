-- =====================================================================
-- C15 · the TRADE PORTAL (estimator journey v2, plan of record §8; brief
-- claude-code-brief-c15-trade-portal.md).
--
-- Trade is not a second product: the same tree, the same engine, the same
-- components composed for a desk. What it needs in the schema:
--
--   trade_specs          a job done again and again — scope, coats, condition,
--                        colour policy — saved once per account. REPLACES the
--                        specs JSON that lived on accounts.flags (moved below).
--   building_profiles    the file a trade account keeps on a building: segment,
--                        levels, access, compliance, contacts, the assigned
--                        estimator, when it was measured (walk B).
--   tenant_photo_links   a token the occupant opens on their phone; the photos
--                        pin to the property and the estimate (walk A).
--   properties.measured_tree  already exists (C6, 20270138) — now versioned:
--                        {version, blocks, measuredAt, measuredBy, estimateId}.
--   settings             measured_tree_max_age_days (⚑56, default 365).
-- =====================================================================

-- ---- trade_specs ------------------------------------------------------
create table if not exists public.trade_specs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) default public.current_tenant(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  -- scope preset, systems overrides, condition band, colour policy
  -- (register | choose | brand), hours, segment defaults — lib/wizard/trade-specs.ts
  spec         jsonb not null default '{}'::jsonb
                 constraint trade_specs_spec_object check (jsonb_typeof(spec) = 'object'),
  created_by   uuid references auth.users (id) on delete set null,
  used_count   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.trade_specs is
  'C15: a trade account''s saved specs — the end-of-lease repaint, the brand fit-out. Replaces the specs JSON on accounts.flags.';
create index if not exists trade_specs_account_idx on public.trade_specs (account_id);

alter table public.trade_specs enable row level security;
drop policy if exists trade_specs_staff_all on public.trade_specs;
create policy trade_specs_staff_all on public.trade_specs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists trade_specs_member_all on public.trade_specs;
create policy trade_specs_member_all on public.trade_specs
  for all to authenticated
  using (exists (select 1 from public.account_users au where au.account_id = trade_specs.account_id and au.profile_id = auth.uid()))
  with check (exists (select 1 from public.account_users au where au.account_id = trade_specs.account_id and au.profile_id = auth.uid()));

-- Move the specs that lived on accounts.flags.specs (lib/wizard/saved-specs.ts
-- shape) into rows, once; the JSON is left in place until the readers are gone.
insert into public.trade_specs (account_id, name, spec, created_at)
select a.id,
       left(coalesce(s->>'name', 'Saved spec'), 60),
       s - 'id' - 'name' - 'createdAt',
       coalesce(nullif(s->>'createdAt', '')::timestamptz, now())
from public.accounts a,
     jsonb_array_elements(case when jsonb_typeof(a.flags->'specs') = 'array' then a.flags->'specs' else '[]'::jsonb end) s
where a.account_type = 'trade'
  and not exists (select 1 from public.trade_specs t where t.account_id = a.id and t.name = left(coalesce(s->>'name', 'Saved spec'), 60));

-- ---- building_profiles --------------------------------------------------
create table if not exists public.building_profiles (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) default public.current_tenant(),
  property_id           uuid not null references public.properties (id) on delete cascade,
  account_id            uuid not null references public.accounts (id) on delete cascade,
  segment               text,
  levels                int check (levels is null or levels between 1 and 200),
  units                 int check (units is null or units between 1 and 5000),
  access_notes          text not null default '',
  -- induction, hours, COC required — the checklist the building always raises
  compliance            jsonb not null default '{}'::jsonb
                          constraint building_profiles_compliance_object check (jsonb_typeof(compliance) = 'object'),
  assigned_estimator_id uuid references public.profiles (id) on delete set null,
  contacts              jsonb not null default '[]'::jsonb
                          constraint building_profiles_contacts_array check (jsonb_typeof(contacts) = 'array'),
  documents             text[] not null default '{}',
  measured_at           timestamptz,
  measured_by           uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (property_id)
);
comment on table public.building_profiles is
  'C15: the file a trade account keeps on a building — segment, levels, access, compliance, contacts, the assigned estimator, when it was measured. The measured tree itself is on properties.measured_tree.';
create index if not exists building_profiles_account_idx on public.building_profiles (account_id);

alter table public.building_profiles enable row level security;
drop policy if exists building_profiles_staff_all on public.building_profiles;
create policy building_profiles_staff_all on public.building_profiles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists building_profiles_member_read on public.building_profiles;
create policy building_profiles_member_read on public.building_profiles
  for select to authenticated
  using (exists (select 1 from public.account_users au where au.account_id = building_profiles.account_id and au.profile_id = auth.uid()));

-- ---- tenant_photo_links ---------------------------------------------------
create table if not exists public.tenant_photo_links (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) default public.current_tenant(),
  property_id        uuid references public.properties (id) on delete set null,
  estimate_id        uuid references public.estimates (id) on delete cascade,
  account_id         uuid references public.accounts (id) on delete cascade,
  token              text not null unique,
  expires_at         timestamptz not null,
  requested_by       uuid references auth.users (id) on delete set null,
  sent_to            text,
  asked_for          text[] not null default '{}',
  uploaded_photo_ids uuid[] not null default '{}',
  status             text not null default 'sent' check (status in ('sent', 'opened', 'photos_received', 'expired')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.tenant_photo_links is
  'C15 (⚑61): a link the occupant opens on their phone — no account, no app. Photos pin to the property and the estimate and become condition flags for the estimator; the agent sees what was sent.';
create index if not exists tenant_photo_links_estimate_idx on public.tenant_photo_links (estimate_id);

alter table public.tenant_photo_links enable row level security;
drop policy if exists tenant_photo_links_staff_all on public.tenant_photo_links;
create policy tenant_photo_links_staff_all on public.tenant_photo_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists tenant_photo_links_member_read on public.tenant_photo_links;
create policy tenant_photo_links_member_read on public.tenant_photo_links
  for select to authenticated
  using (account_id is not null and exists (select 1 from public.account_users au where au.account_id = tenant_photo_links.account_id and au.profile_id = auth.uid()));
-- The tenant page itself runs on the service role by token; anon has no policy and no access.

-- ---- the measured tree, versioned; the staleness setting (⚑56) -----------
comment on column public.properties.measured_tree is
  'C6/C15: the estimator''s confirmed tree, written by fix_price to the ESTIMATE''s property — {version: 1, blocks, measuredAt, measuredBy, estimateId}. Older rows may hold the bare blocks array; lib/wizard/measured-tree.ts reads both. Reused by rebook and by every later quick look on the property (§8.3).';

insert into public.settings (key, value) values ('measured_tree_max_age_days', jsonb_build_object('days', 365))
on conflict (key) do nothing;

insert into public._prod_migrations(name) values ('20270142000000_trade_portal.sql') on conflict (name) do nothing;
