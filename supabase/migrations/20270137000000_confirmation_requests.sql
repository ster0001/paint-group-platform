-- =============================================================================
--  ███  PRODUCTION project (ref llmrvgdequpmzzuaxdhq) AND the C1 TEST project.
--       Run it on BOTH — the e2e for C5 needs it on the test stack.
--       Check the project name in the SQL editor before pasting.
-- =============================================================================
--
-- C5 — the qualified lead becomes a ROW (estimator journey v2 §3, plan §2.6).
--
-- The gap: ⚑7's desk check already assembles the pack and raises a work item,
-- but it is triggered by a jsonb marker — `builder_state.prepPack.kind =
-- 'desk_check'` — and read back by scanning estimates for it
-- (lib/crm/work-queue.ts:1050). That works, and it cannot carry what Phase 1
-- needs: who it is assigned to, what we suggested, what the pack looked like
-- WHEN IT WAS SENT, or the four numbers §2.6 says tell us whether any of this
-- is working — hours from sent to fixed, share fixed without a visit,
-- visit-to-signed, guide-to-fixed drift. A marker has no timestamps and no
-- history; it is either there or it is not.
--
-- So this is a MIGRATION of the queue, not a second queue beside it. Tom's
-- ruling, 11 Sep: option 1. Two answers to "who needs confirming?" is the bug
-- class this whole phase 0 removed — the ladder in four places,
-- requires_site_check in two, the draft's three copies.
--
-- `pack` is frozen at send. The desk-check PAGE still re-derives live (its own
-- comment says so, and it is right to: a builder edit after sending must not
-- be hidden). The frozen copy is what we PROMISED, kept so a later
-- disagreement can be read rather than argued.
-- =============================================================================

create table if not exists public.confirmation_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) default public.current_tenant(),
  estimate_id   uuid not null references public.estimates (id) on delete cascade,

  requested_at  timestamptz not null default now(),
  requested_by  text not null check (requested_by in ('customer', 'staff')),

  -- What was ASKED FOR. `remote` = confirm from what we have; `visit` = a
  -- person comes; `fix_online` = the customer fixed it themselves (C7).
  kind          text not null check (kind in ('remote', 'visit', 'fix_online')),
  status        text not null default 'requested'
                  check (status in ('requested', 'question_asked', 'fixed', 'visit_booked', 'declined')),

  -- What the RULES suggested at send (plan §2.6, lib/wizard/desk-check.ts
  -- recommendedOutcome). Recorded, never enforced: an estimator who does
  -- something else is not wrong, and the gap between suggested and done is
  -- the signal that tells us whether the rules are any good.
  suggested_action text check (suggested_action in ('fix', 'ask', 'visit')),

  -- The estimator whose patch this postcode falls in (profiles.patch_postcodes).
  assigned_to   uuid references public.profiles (id) on delete set null,

  -- The pack AS SENT. Frozen; the live one is re-derived by the desk-check page.
  pack          jsonb not null default '{}'::jsonb
                  constraint confirmation_requests_pack_object check (jsonb_typeof(pack) = 'object'),

  fixed_price_cents  int check (fixed_price_cents is null or fixed_price_cents >= 0),
  fixed_at           timestamptz,
  question_thread_id uuid,
  visit_booking_id   uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.confirmation_requests is
  'One row per "a person should look at this price". The estimator queue derives from this table alone (C5) — it replaced a jsonb marker on builder_state, which could not carry assignment, the suggested action, the pack as sent, or any of the four Phase 1 metrics.';
comment on column public.confirmation_requests.pack is
  'The lead pack FROZEN at send. The desk-check page re-derives live so a later builder edit is never hidden; this is what we promised, kept so a disagreement can be read rather than argued.';
comment on column public.confirmation_requests.suggested_action is
  'What the rules suggested (plan §2.6). Recorded, never enforced — the gap between suggested and done is how we learn whether the rules are any good.';

-- ONE open request per estimate. A second "please confirm this" while the
-- first is still open is a double-tap, not a new job; the terminal states are
-- deliberately excluded so a job CAN come back for a second look later.
create unique index if not exists confirmation_requests_open_per_estimate
  on public.confirmation_requests (estimate_id)
  where status in ('requested', 'question_asked');

create index if not exists confirmation_requests_queue_idx
  on public.confirmation_requests (status, requested_at desc);
create index if not exists confirmation_requests_assigned_idx
  on public.confirmation_requests (assigned_to) where assigned_to is not null;
create index if not exists confirmation_requests_estimate_idx
  on public.confirmation_requests (estimate_id);

drop trigger if exists t_confirmation_requests_updated on public.confirmation_requests;
create trigger t_confirmation_requests_updated before update on public.confirmation_requests
  for each row execute function public.set_updated_at();

alter table public.confirmation_requests enable row level security;

-- Staff see and work the queue. Customers never read this table: what they are
-- told about their own request comes back through the estimate's own route,
-- which already knows whose it is. A table of "jobs a person still has to
-- check", with prices, is not something to make listable.
drop policy if exists confirmation_requests_staff_all on public.confirmation_requests;
create policy confirmation_requests_staff_all on public.confirmation_requests
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

-- ---- the estimator's patch ----------------------------------------------------
-- Assignment by postcode, from staff records (plan §5 ruling I). A person with
-- no postcodes is simply never auto-assigned; assignment is a convenience, and
-- an unassigned request is still in the queue for anyone to pick up.
alter table public.profiles
  add column if not exists patch_postcodes text[] not null default '{}'::text[];
comment on column public.profiles.patch_postcodes is
  'The postcodes this estimator covers. Empty = never auto-assigned (they can still pick anything up). Settings → Staff logins.';

-- ---- the compliance checklist -------------------------------------------------
-- v2.5 replaced the asbestos/lead HARD STOP with a checklist item raised at
-- confirmation: a trained person makes that call, and no price is acceptable
-- until they have. Never a price line — these change what a job needs, not
-- what it costs.
create table if not exists public.site_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) default public.current_tenant(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  key         text not null check (key in (
                'induction', 'swms', 'wwcc', 'police_check', 'security', 'loading_dock',
                'centre_rules', 'coc_required', 'meeting_date', 'hazmat_check', 'low_odour')),
  value       text,
  source      text not null check (source in ('wizard', 'brief', 'staff')),
  created_at  timestamptz not null default now(),
  unique (estimate_id, key)
);
comment on table public.site_checklist_items is
  'Compliance and site conditions raised at confirmation — induction, SWMS, hazmat_check. Never price lines: they change what a job NEEDS, not what it costs. hazmat_check replaced the asbestos/lead hard stop (v2.5).';

alter table public.site_checklist_items enable row level security;
drop policy if exists site_checklist_items_staff_all on public.site_checklist_items;
create policy site_checklist_items_staff_all on public.site_checklist_items
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

-- ---- backfill: the queue must not lose what it already had -------------------
-- Every estimate carrying the old marker becomes a row, so migrating the queue
-- moves the work rather than dropping it. `requested_at` comes from the marker's
-- own timestamp where it has one, so a job that has been waiting keeps its age
-- and the turnaround warning still fires on the right day.
--
-- kind/suggested_action are left NULL deliberately: they are derived from the
-- ladder and the pack, and guessing them in SQL would be a second opinion about
-- a decision lib/wizard/confirmation.ts owns. The queue treats a null
-- suggestion as least-ready, so a backfilled row sorts conservatively until
-- somebody opens it.
insert into public.confirmation_requests (estimate_id, requested_at, requested_by, kind, status)
select e.id,
       coalesce((e.builder_state -> 'prepPack' ->> 'at')::timestamptz, now()),
       'customer',
       'remote',
       'requested'
  from public.estimates e
 where e.builder_state -> 'prepPack' ->> 'kind' = 'desk_check'
   and e.status = 'draft'
   and not exists (
     select 1 from public.confirmation_requests c
      where c.estimate_id = e.id and c.status in ('requested', 'question_asked')
   );

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'confirmation_requests') then
    raise exception 'read-back: confirmation_requests missing';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'site_checklist_items') then
    raise exception 'read-back: site_checklist_items missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'patch_postcodes') then
    raise exception 'read-back: profiles.patch_postcodes missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'confirmation_requests' and policyname = 'confirmation_requests_staff_all') then
    raise exception 'read-back: the staff policy is missing';
  end if;
end $$;

-- Paste the result in chat: expect 2 tables and 1 column.
select 'confirmation_requests' as object, count(*) as found from pg_tables where schemaname='public' and tablename='confirmation_requests'
union all select 'site_checklist_items', count(*) from pg_tables where schemaname='public' and tablename='site_checklist_items'
union all select 'profiles.patch_postcodes', count(*) from information_schema.columns
  where table_schema='public' and table_name='profiles' and column_name='patch_postcodes';

insert into public._prod_migrations(name)
values ('20270137000000_confirmation_requests.sql')
on conflict (name) do nothing;
