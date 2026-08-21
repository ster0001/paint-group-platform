-- =============================================================================
-- WO completion loop, step 1 — the loop's tables
--
-- Shape is §3 of docs/briefs/claude-code-brief-wo-loop-pc-command.md. Created
-- together so the build has no further DDL pauses between steps 2 and 5; each
-- step brings its own RPCs, which is where the rules live. Every table is
-- RLS'd three ways — staff everything, contractor their assigned jobs, customer
-- their own job — and every one of them is read-only to both non-staff roles,
-- because every write in this module goes through a SECURITY DEFINER RPC.
--
-- ONE DELIBERATE DEPARTURE from §3: surfaces and QA checks do not carry their
-- own history columns. §3 asks for "state history (who/when per transition)" on
-- wo_surfaces, but wo_events already is that log, and the brief itself says the
-- report and the console both read from events. A second history would be a
-- second truth. Tick history is wo_events rows of type 'surface_tick' carrying
-- {surface_id, from, to} — same query, no duplication.
-- =============================================================================

do $$ begin
  create type public.wo_checklist_phase as enum ('pre_offer', 'pre_start', 'completion_prep');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_surface_state as enum ('todo', 'prepped', 'done');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_photo_kind as enum ('before', 'progress', 'qa', 'completion', 'variation');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_variation_status as enum
    ('raised', 'priced', 'customer_approved', 'contractor_accepted', 'declined', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_update_status as enum ('drafted', 'approved', 'sent');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.wo_signoff_kind as enum ('in_person', 'remote', 'deemed');
exception when duplicate_object then null; end $$;

-- ---- gate checklists (pre-offer, pre-start, completion prep) ----------------
create table if not exists public.wo_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  phase         public.wo_checklist_phase not null,
  label         text not null,
  required      boolean not null default true,
  sort          integer not null default 0,
  done_at       timestamptz,
  done_by       uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists wo_checklist_wo_idx on public.wo_checklist_items (work_order_id, phase, sort);

-- ---- the tick list ----------------------------------------------------------
-- Seeded in step 2 from the WO's existing elevation/area grouping. `heading` is
-- the elevation ("Front"), `heading_meta` its measured description
-- ("12 × 2.6 m · wb 75 / render 25") — display only, never priced from.
create table if not exists public.wo_surfaces (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  heading       text not null,
  heading_meta  text not null default '',
  label         text not null,
  surface_key   text,                       -- ties back to the snapshot's surface where there is one
  sort          integer not null default 0,
  state         public.wo_surface_state not null default 'todo',
  state_changed_at timestamptz,
  -- Rectification surfaces are appended by a QA fail or a walkthrough flag and
  -- live in the SAME list, per the brief: one tick list, always.
  rectification boolean not null default false,
  source_ref    uuid,                       -- the qa check / signoff area that raised it
  created_at    timestamptz not null default now()
);
create index if not exists wo_surfaces_wo_idx on public.wo_surfaces (work_order_id, sort);
create index if not exists wo_surfaces_state_idx on public.wo_surfaces (work_order_id, state);

-- ---- photos -----------------------------------------------------------------
-- storage_path is a PATH into the private wo-photos bucket, never a public URL
-- (the contractor-docs convention). Bytes are magic-byte checked server-side on
-- the staged object before the row is written — the remediated upload path.
create table if not exists public.wo_photos (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  surface_id    uuid references public.wo_surfaces (id) on delete set null,
  area          text not null default '',    -- when the photo is of an area, not one surface
  kind          public.wo_photo_kind not null,
  storage_path  text not null,
  caption       text not null default '',
  taken_by      uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists wo_photos_wo_idx on public.wo_photos (work_order_id, kind, created_at desc);
create index if not exists wo_photos_surface_idx on public.wo_photos (surface_id);
create index if not exists wo_photos_area_idx on public.wo_photos (work_order_id, area, kind);

-- ---- variations -------------------------------------------------------------
-- priced_lines is the engine's own output, stored verbatim. contractor_delta_cents
-- is hours × the contractor rate, computed server-side in step 3 — never sent up
-- from a browser.
create table if not exists public.wo_variations (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  raised_by     uuid references auth.users (id) on delete set null,
  raised_kind   text not null default 'contractor',   -- contractor | staff (PC verbal override)
  override      boolean not null default false,       -- PC entered it on a verbal approval
  category      text not null,                        -- rot | damage | extra_scope | customer_request
  comment       text not null default '',
  est_hours     numeric(6,2),
  status        public.wo_variation_status not null default 'raised',
  priced_lines  jsonb,
  price_cents   integer check (price_cents is null or price_cents >= 0),
  contractor_delta_cents integer check (contractor_delta_cents is null or contractor_delta_cents >= 0),
  customer_token text unique,                         -- the mini-estimate link
  customer_responded_at  timestamptz,
  contractor_offer_id    uuid references public.booking_offers (id) on delete set null,
  contractor_accepted_at timestamptz,
  declined_reason text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists wo_variations_wo_idx on public.wo_variations (work_order_id, created_at desc);
create index if not exists wo_variations_status_idx on public.wo_variations (status)
  where status in ('raised', 'priced', 'customer_approved');

-- ---- drafted customer updates ----------------------------------------------
-- source_tick_ids proves the copy came from real ticks; step 4's test asserts an
-- update can only be drafted from events that exist.
create table if not exists public.wo_updates (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  for_date      date not null default current_date,
  draft_text    text not null,
  final_text    text,
  source_tick_ids uuid[] not null default '{}',
  photo_count   integer not null default 0,
  status        public.wo_update_status not null default 'drafted',
  approved_by   uuid references auth.users (id) on delete set null,
  approved_at   timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (work_order_id, for_date)
);
create index if not exists wo_updates_status_idx on public.wo_updates (status, created_at desc);

-- ---- QA ---------------------------------------------------------------------
create table if not exists public.wo_qa_checks (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  scheduled_for date,
  kind          text not null default 'final',      -- day_one | final | spot
  result        text check (result in ('pass', 'fail')),
  notes         text not null default '',
  checked_by    uuid references auth.users (id) on delete set null,
  checked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists wo_qa_wo_idx on public.wo_qa_checks (work_order_id, scheduled_for);

-- ---- walkthrough & sign-off -------------------------------------------------
-- One row per work order. `areas` holds the customer's per-area verdicts
-- ({area: {approved_at | flagged_at, note}}); `nudges` records which rung of the
-- ladder has fired, keyed by rung, so a rung can never fire twice — a late sweep
-- sends a late nudge, it does not send the whole ladder at once.
create table if not exists public.wo_signoff (
  work_order_id uuid primary key references public.work_orders (id) on delete cascade,
  evidence_pack_sent_at timestamptz,
  deadline_at   timestamptz,                  -- computed when the pack is delivered
  views         jsonb not null default '[]',  -- [{at, ip_hash}] — viewed-but-silent is the defensible bit
  nudges        jsonb not null default '{}',  -- {"0h": ts, "24h": ts, "48h": ts}
  extension_requested_at timestamptz,
  extension_until date,
  extension_approved_at  timestamptz,
  extension_approved_by  uuid references auth.users (id) on delete set null,
  areas         jsonb not null default '{}',
  signed_at     timestamptz,
  signed_name   text,
  signed_kind   public.wo_signoff_kind,
  signed_device text not null default '',
  created_at    timestamptz not null default now()
);

-- ---- private bucket for site photos ----------------------------------------
-- Private, like contractor-docs: site photos carry the customer's property.
-- Served through short-lived signed URLs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('wo-photos', 'wo-photos', false, 26214400,
          array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- RLS, three ways, on every table ---------------------------------------
-- Written as a loop because the predicate is identical for all seven and one
-- hand-copied policy with the wrong table name is exactly how a leak happens.
do $$
declare t text;
begin
  foreach t in array array['wo_checklist_items','wo_surfaces','wo_photos','wo_variations',
                           'wo_updates','wo_qa_checks','wo_signoff']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format($f$create policy %I on public.%I
        for all to authenticated using (public.is_staff()) with check (public.is_staff())$f$,
      t || '_staff', t);

    execute format('drop policy if exists %I on public.%I', t || '_contractor', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (
          exists (select 1 from public.work_orders w
                   where w.id = %I.work_order_id
                     and w.contractor_id is not null
                     and w.contractor_id = public.current_contractor_id()))$f$,
      t || '_contractor', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_customer', t);
    execute format($f$create policy %I on public.%I
        for select to authenticated using (
          exists (select 1 from public.work_orders w
                    join public.estimates e on e.id = w.estimate_id
                    join public.customers c on c.id = e.customer_id
                   where w.id = %I.work_order_id and c.profile_id = auth.uid()))$f$,
      t || '_customer', t, t);

    -- Every write is an RPC. Nothing here is client-writable, so there is no
    -- column-by-column grant to keep in step with later ALTERs.
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---- Verification -----------------------------------------------------------
--   select tablename, count(*) from pg_policies
--    where tablename like 'wo\_%' group by 1 order by 1;
--     -> 3 policies each for the seven tables above
--   select id, public from storage.buckets where id = 'wo-photos';   -> public = false
-- As a contractor JWT, on a job that is NOT theirs:
--   select * from wo_surfaces where work_order_id = '<other job>';   -> 0 rows
--   insert into wo_surfaces (...) values (...);                      -> permission denied
