-- 20270168 — the contractor invitation can be EMAILED from the platform
-- (Tom, 18 Sep 2026: "send an invitation link to them when registering …
-- via email"). Until now the office created the /join/<token> link and sent
-- it by hand. The send itself goes through lib/messaging (a `messages` row,
-- delivery-tracked like everything else); these two columns let the
-- Contractors page say when the link was last emailed, and how often.
-- Staff already hold `for all` on contractor_invites (20260830), so the
-- server action updates them under the staff session — no new RPC.

alter table public.contractor_invites
  add column if not exists emailed_at    timestamptz,
  add column if not exists emailed_count integer not null default 0 check (emailed_count >= 0);

-- Read-back. Read it; do not assume it.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contractor_invites' and column_name = 'emailed_at') as emailed_at_ok,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contractor_invites' and column_name = 'emailed_count') as emailed_count_ok,
  (select relrowsecurity from pg_class where oid = 'public.contractor_invites'::regclass) as rls_on,
  (select count(*) from pg_policies where tablename = 'contractor_invites') as policies;

insert into public._prod_migrations(name) values ('20270168000000_contractor_invite_emailed.sql') on conflict (name) do nothing;
