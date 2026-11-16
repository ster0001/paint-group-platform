-- =============================================================================
-- 20270313 · The lead page (automations ruling A-F, Tom 11 Nov 2026)
-- =============================================================================
-- Brief: docs/briefs/claude-code-brief-automations-campaigns.md, ruling A-F:
-- leads get a token page with their range, as a SNAPSHOT, and the chat.
--
-- A wizard customer who has seen their range has a DRAFT estimate (the
-- submit route creates it) but no page: get_estimate_by_token answers only
-- for a sent estimate, and the share token was minted only by a first chat
-- message. So the lead sequence (L2, L3, L4, L6, L10) had nowhere to link.
--
-- 1 · estimates.lead_snapshot: the range the customer was shown, written by
--     the submit route from the price it has just worked out (never by the
--     browser). The page renders only this, never the live draft. Re-pricing
--     writes a fresh one. Null on every estimate the office builds.
-- 2 · get_lead_by_token: the read for /e/[token] when the estimate is not
--     sent. It answers only while the estimate is unsent AND holds a lead
--     snapshot; an unknown token, a staff draft or a sent estimate answers
--     nothing, so there is nothing to enumerate. Once the estimate is sent the
--     same token opens the sent estimate through get_estimate_by_token.
--
-- The chat needs nothing new: get_estimate_thread_by_token and
-- post_estimate_message_by_token already work on any token, sent or not.
-- No backfill: drafts priced before this run get a page the next time the
-- customer is priced, or when the office sends the estimate.
-- =============================================================================

set lock_timeout = '15s';

-- ---- 1 · the snapshot ---------------------------------------------------------------
alter table public.estimates add column if not exists lead_snapshot jsonb;
alter table public.estimates drop constraint if exists estimates_lead_snapshot_shape;
alter table public.estimates add constraint estimates_lead_snapshot_shape
  check (lead_snapshot is null or (jsonb_typeof(lead_snapshot) = 'object' and lead_snapshot->>'kind' = 'lead'));

-- ---- 2 · the token read ---------------------------------------------------------------
create or replace function public.get_lead_by_token(p_token text)
returns table (id uuid, status public.estimate_status, snapshot jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.status, e.lead_snapshot
    from public.estimates e
   where e.share_token = p_token
     and e.sent_at is null
     and e.lead_snapshot is not null
   limit 1;
$$;
revoke all on function public.get_lead_by_token(text) from public;
grant execute on function public.get_lead_by_token(text) to anon, authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name = 'lead_snapshot') as snapshot_column, 1 as _expect_snapshot_column,
  (select count(*) from pg_constraint where conname = 'estimates_lead_snapshot_shape') as shape_check, 1 as _expect_shape_check,
  (select has_function_privilege('anon', 'public.get_lead_by_token(text)', 'execute')) as read_anon, true as _expect_read_anon,
  (select prosecdef from pg_proc where oid = 'public.get_lead_by_token(text)'::regprocedure) as read_definer, true as _expect_read_definer,
  (select pg_get_functiondef('public.get_lead_by_token(text)'::regprocedure) like '%sent_at is null%') as read_unsent_only, true as _expect_read_unsent_only;

insert into public._prod_migrations(name) values ('20270313000000_lead_token_page.sql') on conflict (name) do nothing;
