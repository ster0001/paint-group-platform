-- =====================================================================
-- C14 · commercial BRIEFS (estimator journey v2 addendum S6c, §4.16).
--
-- The brief path never prices. A strata block, a shop front, "something
-- else", a hospital, and every commercial exterior answer four or five
-- questions, add photos and notes, and book a visit. This table holds the
-- customer's ANSWERS; the questions themselves are the `brief` json on the
-- segment row (C12), which this migration extends with the CHECKLIST map —
-- which answers raise which site_checklist_items (C5) — so adding a rule is
-- a seed edit, never a switch in code.
-- =====================================================================

create table if not exists public.commercial_briefs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) default public.current_tenant(),
  -- The estimate the booking created (a brief estimate: no priced blocks, total 0).
  estimate_id      uuid references public.estimates (id) on delete cascade,
  draft_id         uuid references public.wizard_drafts (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  segment          text not null,
  brief_key        text not null,
  what             text[] not null default '{}',
  answers          jsonb not null default '{}'::jsonb
                     constraint commercial_briefs_answers_object check (jsonb_typeof(answers) = 'object'),
  notes            text not null default '',
  meeting_date     date,
  photo_source_ids uuid[] not null default '{}',
  created_at       timestamptz not null default now()
);
comment on table public.commercial_briefs is
  'C14: the customer''s answers on the brief path (strata, shop front, other, hospital, every commercial exterior). Never priced; the estimate it points at has no priced blocks.';

create index if not exists commercial_briefs_estimate_idx on public.commercial_briefs (estimate_id);

alter table public.commercial_briefs enable row level security;
drop policy if exists commercial_briefs_staff_all on public.commercial_briefs;
create policy commercial_briefs_staff_all on public.commercial_briefs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists commercial_briefs_own_read on public.commercial_briefs;
create policy commercial_briefs_own_read on public.commercial_briefs
  for select to authenticated using (created_by = auth.uid());

-- The checklist map on each brief config, and the date question strata asks.
update public.commercial_segments set brief = brief || $j${"checklist":{"always":["hazmat_check"],"rows":{"Timing":{"Before the next meeting":"meeting_date"}}},"date":{"key":"meeting_date","label":"Your next meeting date","hint":"The quote is held to it, so we work back from it"}}$j$::jsonb, updated_at = now() where key = 'strata';
update public.commercial_segments set brief = brief || $j${"checklist":{"always":["hazmat_check"],"rows":{"Where is it?":{"Shopping centre":"centre_rules"}}}}$j$::jsonb, updated_at = now() where key = 'shopfront';
update public.commercial_segments set brief = brief || $j${"checklist":{"always":["hazmat_check"]}}$j$::jsonb, updated_at = now() where key = 'other';
update public.commercial_segments set brief = brief || $j${"checklist":{"always":["hazmat_check","induction","low_odour"]}}$j$::jsonb, updated_at = now() where key = 'health';
update public.commercial_segments set brief = brief || $j${"checklist":{"always":["hazmat_check"],"rows":{"Street frontage or footpath?":{"Yes":"loading_dock"}}}}$j$::jsonb, updated_at = now() where key = 'exterior';

insert into public._prod_migrations(name) values ('20270141000000_commercial_briefs.sql') on conflict (name) do nothing;
