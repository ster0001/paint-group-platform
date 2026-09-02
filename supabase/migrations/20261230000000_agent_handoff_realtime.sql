-- =============================================================================
-- Assistant S7 — live handoff.
--   · Realtime on the transcript and the conversation row (§5: persisted
--     first, broadcast second — the browser subscribes under its own RLS).
--   · agent_handoffs.escalated_at: the SLA fired (D10, default 3 minutes) —
--     the card escalates and the customer is offered a callback instead.
--   · Customers may read their own handoff rows (already) and callback rows.
-- Idempotent; read-back at the end.
-- =============================================================================

alter table public.agent_handoffs add column if not exists escalated_at timestamptz;
create index if not exists agent_handoffs_sla_idx on public.agent_handoffs (requested_at) where status = 'requested';

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_messages') then
    alter publication supabase_realtime add table public.agent_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_conversations') then
    alter publication supabase_realtime add table public.agent_conversations;
  end if;
end $$;

-- Realtime evaluates RLS with the subscriber's JWT; the select policies from
-- 20261228 already scope customers to their own conversation.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_handoffs' and column_name = 'escalated_at') then
    raise exception 'read-back: agent_handoffs.escalated_at missing';
  end if;
end $$;

select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('agent_messages', 'agent_conversations') order by tablename;
--   -> two rows.
