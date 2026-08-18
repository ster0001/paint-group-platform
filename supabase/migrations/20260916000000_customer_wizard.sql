-- =============================================================================
-- Step 8 (W4) - the customer wizard layer.
--
-- ARCHITECTURE, deliberately narrow: anonymous visitors get a Supabase
-- ANONYMOUS AUTH identity (a real auth.users row with is_anonymous = true),
-- but they receive NO direct table access at all - no new RLS policies for
-- them. Every customer read and write flows through server routes that use
-- the service-role client (server env only, per CLAUDE.md) with explicit
-- ownership checks against auth.uid(). The rate card is therefore never
-- readable from a customer's browser, and RLS remains the wall it always was.
--
-- Manual steps that pair with this migration (PROJECT_STATUS):
--   1. Supabase dashboard -> Authentication -> Sign In / Up ->
--      enable "Allow anonymous sign-ins".
--   2. Add SUPABASE_SERVICE_ROLE_KEY to the server env (.env.local + Vercel).
-- =============================================================================

-- ---- who created an estimate (wizard ownership) -----------------------------
-- Staff estimates keep null (they are owned by the staff role collectively);
-- customer-wizard estimates carry the anonymous user's id, and the wizard
-- edit routes verify it before touching the row.

alter table public.estimates
  add column if not exists created_by uuid references auth.users (id);

create index if not exists estimates_created_by_idx on public.estimates (created_by)
  where created_by is not null;

-- (estimate_sources and extraction_runs already carry created_by from
-- migration 20260910 — the routes check ownership against those.)

-- ---- wizard leads -----------------------------------------------------------
-- One row per customer submit attempt: the email captured at the gate, what
-- the guardrails decided, and the hashed IP for rate limiting. Staff-only to
-- read; written exclusively by the server routes (service role bypasses RLS,
-- so no anon policies exist - that is the point).

create table if not exists public.wizard_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  estimate_id uuid references public.estimates (id) on delete set null,
  email text not null,
  ip_hash text,
  suburb text,
  postcode text,
  job_type text,
  outcome text not null check (outcome in
    ('revealed', 'walkthrough_only', 'handoff', 'hard_stop', 'below_floor', 'outside_area', 'rate_limited')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wizard_leads_email_idx on public.wizard_leads (email, created_at desc);
create index if not exists wizard_leads_ip_idx on public.wizard_leads (ip_hash, created_at desc);

alter table public.wizard_leads enable row level security;

drop policy if exists wizard_leads_staff on public.wizard_leads;
create policy wizard_leads_staff on public.wizard_leads
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- customer-stated provenance ---------------------------------------------
-- A number the CUSTOMER typed (a wall length, a board condition) is its own
-- provenance: better than an AI assumption, never as good as a staff
-- confirmation, and always shown as theirs in the review queue.

alter table public.defect_observations drop constraint if exists defect_observations_origin_check;
alter table public.defect_observations add constraint defect_observations_origin_check
  check (origin in ('ai_extracted', 'ai_derived', 'ai_assumed', 'human_confirmed', 'customer_stated'));

-- ---- Verification -----------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_name = 'estimates' and column_name = 'created_by';   -- 1 row
-- select count(*) from wizard_leads;                                  -- runs, 0
-- As a signed-in CUSTOMER (not staff): select * from wizard_leads;    -- 0 rows (RLS)
