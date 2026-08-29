-- =============================================================================
-- CRM session 3.2/3.5 · saved email templates
--
-- One table. A template is a SUBJECT, a PREHEADER and an ordered list of typed
-- blocks (lib/campaigns/blocks.ts) — never HTML. The HTML is rendered from the
-- blocks at send time, so a design change improves every email ever written
-- rather than only the next one, and no stored row can contain markup somebody
-- pasted in.
--
-- Carries tenant_id per the A3 ruling (docs/briefs/crm-decisions.md): every
-- table from the CRM spine onward does.
--
-- NOT a campaign. Enrolment, the sweep, the guard chain and sending are the
-- next session and need their own tables — this is the writing surface, and it
-- deliberately cannot send anything.
-- =============================================================================

create table if not exists public.campaign_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) default public.current_tenant(),
  name        text not null,
  subject     text not null default '',
  preheader   text not null default '',
  -- The blocks, exactly as lib/campaigns/blocks.ts validates them.
  blocks      jsonb not null default '[]'::jsonb,
  -- Which segment it is written FOR. Advisory: the studio uses it to tell the
  -- writer who they are talking to, and the sweep will use it later.
  segment_key text,
  -- Whether a human has read it since it last changed. Every AI edit clears
  -- it, which is the approval queue's hinge in the next session.
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.campaign_templates is
  'Marketing email drafts as typed blocks. Rendered to HTML at send time; never stores markup.';

create index if not exists campaign_templates_tenant_idx
  on public.campaign_templates (tenant_id, updated_at desc);

drop trigger if exists t_campaign_templates_updated on public.campaign_templates;
create trigger t_campaign_templates_updated before update on public.campaign_templates
  for each row execute function public.set_updated_at();

alter table public.campaign_templates enable row level security;

drop policy if exists campaign_templates_staff_all on public.campaign_templates;
create policy campaign_templates_staff_all on public.campaign_templates
  for all to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant())
  with check (public.is_staff() and tenant_id = public.current_tenant());

revoke all on public.campaign_templates from anon;

-- ---- Verification -----------------------------------------------------------
-- As staff:
--   insert into campaign_templates (name) values ('probe') returning id, tenant_id;
--   select name, jsonb_typeof(blocks), approved_at from campaign_templates;
--   delete from campaign_templates where name = 'probe';
-- As anon (should be refused):
--   select * from campaign_templates;   -> permission denied
