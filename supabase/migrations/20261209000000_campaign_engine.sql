-- =============================================================================
-- CRM session 3.1 · the campaign engine, draft-only
--
-- Three tables, and NO send path. Nothing in this migration can deliver a
-- message: it records who is on a campaign, what would go to them, and what a
-- human decided about it. Delivery is its own session and needs C9 (consent
-- wording, legal) and C17 (provider) settled first.
--
-- The shape follows the guard chain in lib/campaigns/guard.ts:
--   · campaign_messages.send_key is UNIQUE, so the same message cannot be
--     queued twice however many times the sweep runs. The key carries no
--     timestamp deliberately — see sendKey().
--   · Every refusal is RECORDED (state + reason), because "why didn't Sarah
--     get it?" is the question this table exists to answer.
--   · auto_send defaults FALSE on every campaign (brief §1: sending is guarded,
--     idempotent, and off by default).
--
-- tenant_id per the A3 ruling, as every table from the spine onward.
-- =============================================================================

-- ---- 1 · campaigns ---------------------------------------------------------

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) default public.current_tenant(),
  key         text not null,
  name        text not null,
  segment_key text not null,
  status      text not null default 'draft'
    constraint campaigns_status_check check (status in ('draft', 'live', 'paused')),
  -- [{ step, templateId, waitDays, channel }] — validated by lib/campaigns/sweep.ts
  steps       jsonb not null default '[]'::jsonb,
  -- The one switch that lets anything go without a person. Ships off, stays
  -- off until C9 is settled.
  auto_send   boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_key_unique unique (tenant_id, key)
);
comment on table public.campaigns is
  'A campaign: a segment, an ordered list of steps, and whether it is live. auto_send is false by default and must never be defaulted true.';

drop trigger if exists t_campaigns_updated on public.campaigns;
create trigger t_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---- 2 · enrolments --------------------------------------------------------

create table if not exists public.campaign_enrolments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) default public.current_tenant(),
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  last_step    int not null default 0,
  last_queued_at timestamptz,
  finished_at  timestamptz,
  finished_reason text,
  enrolled_at  timestamptz not null default now(),
  constraint campaign_enrolments_once unique (campaign_id, account_id)
);
comment on table public.campaign_enrolments is
  'One row per customer per campaign, ever. The unique constraint is what makes a repeated sweep a no-op.';

create index if not exists campaign_enrolments_account_idx
  on public.campaign_enrolments (account_id);

-- ---- 3 · messages ----------------------------------------------------------

create table if not exists public.campaign_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) default public.current_tenant(),
  enrolment_id  uuid not null references public.campaign_enrolments (id) on delete cascade,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  template_id   uuid references public.campaign_templates (id) on delete set null,
  step          int not null,
  channel       text not null default 'email'
    constraint campaign_messages_channel_check check (channel in ('email', 'sms')),
  -- queued  → waiting for a human (or for auto_send, which is off)
  -- approved→ a person said yes; still not sent, because nothing sends yet
  -- held    → the guard said "later" (quiet hours, frequency, snooze)
  -- stopped → the guard said "no" (unsubscribed, accepted, off the list)
  -- sent / failed → written by the sending session, which does not exist yet
  state         text not null default 'queued'
    constraint campaign_messages_state_check
      check (state in ('queued', 'approved', 'held', 'stopped', 'sent', 'failed')),
  -- Why it is in that state, in the words the office reads.
  reason        text,
  -- The idempotency stop. One message per customer per campaign step, ever.
  send_key      text not null,
  due_at        timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   uuid references public.profiles (id) on delete set null,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint campaign_messages_send_key_unique unique (send_key)
);
comment on table public.campaign_messages is
  'What would go out, and what happened to it. send_key is unique for all time: a repeated sweep cannot queue the same message twice.';

create index if not exists campaign_messages_queue_idx
  on public.campaign_messages (tenant_id, state, due_at);
create index if not exists campaign_messages_account_idx
  on public.campaign_messages (account_id, created_at desc);

drop trigger if exists t_campaign_messages_updated on public.campaign_messages;
create trigger t_campaign_messages_updated before update on public.campaign_messages
  for each row execute function public.set_updated_at();

-- ---- 4 · access ------------------------------------------------------------
-- Staff only, tenant-scoped, on all three. No customer-facing read: a customer
-- seeing the queue would see who else is on it.

alter table public.campaigns enable row level security;
alter table public.campaign_enrolments enable row level security;
alter table public.campaign_messages enable row level security;

drop policy if exists campaigns_staff_all on public.campaigns;
create policy campaigns_staff_all on public.campaigns
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

drop policy if exists campaign_enrolments_staff_all on public.campaign_enrolments;
create policy campaign_enrolments_staff_all on public.campaign_enrolments
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

drop policy if exists campaign_messages_staff_all on public.campaign_messages;
create policy campaign_messages_staff_all on public.campaign_messages
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

revoke all on public.campaigns, public.campaign_enrolments, public.campaign_messages from anon;

-- ---- 5 · unsubscribe -------------------------------------------------------
-- The one customer-owned fact in the whole module. On the ACCOUNT, because it
-- belongs to the person and not to any campaign, and honoured by the guard
-- chain before anything else is even considered.

alter table public.accounts
  add column if not exists marketing_unsubscribed_at timestamptz,
  add column if not exists marketing_undeliverable_at timestamptz;

grant update (marketing_unsubscribed_at, marketing_undeliverable_at)
  on public.accounts to authenticated;

comment on column public.accounts.marketing_unsubscribed_at is
  'Set once, never cleared by the system. The guard chain refuses every marketing message after it.';

-- ---- Verification -----------------------------------------------------------
-- As staff:
--   insert into campaigns (key, name, segment_key)
--     values ('probe', 'Probe', 'interior_no_exterior') returning id, auto_send;
--     -> auto_send MUST come back false
--   select conname from pg_constraint where conname = 'campaign_messages_send_key_unique';
--   delete from campaigns where key = 'probe';
