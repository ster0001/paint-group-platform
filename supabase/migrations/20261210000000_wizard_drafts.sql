-- =============================================================================
-- Session C15 · the autosaved, part-finished estimate
--
-- The gap this closes: `wizard_leads` is written at SUBMIT, so somebody who
-- opens the wizard, answers half of it and closes the tab leaves NO row, no
-- email and nothing anyone can act on. Every drop-out funnel Tom described
-- targets exactly those people.
--
-- One row per visitor per attempt, upserted as they go. It holds:
--   · the state, so they can be picked up where they left off
--   · the CONTACT, captured during the questions rather than at the end
--   · the signals the "should we ring them?" rule needs — how complete, did
--     they upload anything, how many separate visits, what it is worth
--
-- Deliberately NOT an estimate. An estimate is a priced document the business
-- stands behind; this is somebody halfway through a form. It becomes an
-- estimate only when they submit, and the draft is then marked converted.
--
-- tenant_id per the A3 ruling.
-- =============================================================================

create table if not exists public.wizard_drafts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) default public.current_tenant(),

  -- The anonymous auth user the wizard already creates. One draft per attempt.
  user_id      uuid,
  account_id   uuid references public.accounts (id) on delete set null,
  estimate_id  uuid references public.estimates (id) on delete set null,

  -- Captured during the questions, which is the point of the whole change.
  name         text,
  email        text,
  phone        text,

  job_type     text,
  suburb       text,
  postcode     text,

  -- The part-finished answers.
  state        jsonb not null default '{}'::jsonb,

  -- The signals the warm rule reads. Stored rather than derived because the
  -- state shape will change and these must stay comparable over time.
  progress_pct int  not null default 0
    constraint wizard_drafts_progress_check check (progress_pct between 0 and 100),
  uploaded     boolean not null default false,   -- a plan or photos: real effort
  visits       int not null default 1,           -- coming BACK is the strongest signal
  est_value_cents int,                           -- worth a phone call, or not

  -- Lifecycle. `converted_at` means they finished; anything else is a drop-out.
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  converted_at timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table public.wizard_drafts is
  'A part-finished wizard run, autosaved. The only record of somebody who abandons — every drop-out funnel reads this.';

create unique index if not exists wizard_drafts_user_key
  on public.wizard_drafts (user_id) where user_id is not null and converted_at is null;
create index if not exists wizard_drafts_email_idx on public.wizard_drafts (lower(email));
create index if not exists wizard_drafts_open_idx
  on public.wizard_drafts (last_seen_at desc) where converted_at is null;
create index if not exists wizard_drafts_account_idx on public.wizard_drafts (account_id);

drop trigger if exists t_wizard_drafts_updated on public.wizard_drafts;
create trigger t_wizard_drafts_updated before update on public.wizard_drafts
  for each row execute function public.set_updated_at();

alter table public.wizard_drafts enable row level security;

-- Staff read them (the board, the funnel). Customers never read this table at
-- all: their own draft comes back through the wizard's own route, which knows
-- which one is theirs. No policy for anon or a customer role, deliberately —
-- a table of half-finished quotes with contact details is exactly the thing
-- that must not be listable.
drop policy if exists wizard_drafts_staff_all on public.wizard_drafts;
create policy wizard_drafts_staff_all on public.wizard_drafts
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

revoke all on public.wizard_drafts from anon;

-- ---- Verification -----------------------------------------------------------
-- As staff:  select count(*) from wizard_drafts;                  -> 0
-- As anon:   select * from wizard_drafts;                         -> permission denied
-- After a real part-finished run, from the app:
--   select name, email, progress_pct, uploaded, visits, est_value_cents,
--          converted_at from wizard_drafts order by last_seen_at desc limit 5;
