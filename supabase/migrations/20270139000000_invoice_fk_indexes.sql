-- =============================================================================
--  ███  PRODUCTION (llmrvgde…) AND the C1 TEST project (qarfyjrz…)
--       Run on BOTH. Check the editor's project name before pasting.
-- =============================================================================
--
-- Two foreign keys point at `invoices` with no index behind them:
--   crm_events.invoice_id   · append-only, grows forever
--   messages.invoice_id     · grows with every customer conversation
--
-- Postgres has to scan the whole child table to answer "is anything still
-- referencing this invoice?", so deleting ONE invoice by id gets slower every
-- day. On the C1 test project it already exceeds the statement timeout:
--
--     db.from("invoices").delete().eq("id", <one id>)
--       -> canceling statement due to statement timeout
--
-- Found through a test failure that looked like something else entirely. The
-- e2e fixture teardown deletes its invoices, that delete timed out UNCHECKED,
-- and the estimate delete after it failed on invoices_estimate_id_fkey — so the
-- error named a foreign key three steps from the cause and two CI specs were
-- red for it.
--
-- This is a PRODUCTION issue, not a test one. Production's crm_events is
-- smaller today, which is the only reason nobody has felt it: the same delete
-- gets slower there every day too, and any cascade that touches invoices
-- inherits it. CLAUDE.md's own rule — "every FK and every token/status column
-- used in a WHERE has an index, created in the same migration" — is exactly
-- this, and these two predate it.
--
-- CONCURRENTLY so the build takes no write lock. It cannot run inside a
-- transaction block: paste these two statements ON THEIR OWN, not wrapped.
-- If either reports INVALID afterwards, drop and re-run that one.
-- =============================================================================

create index concurrently if not exists crm_events_invoice_id_idx
  on public.crm_events (invoice_id) where invoice_id is not null;

create index concurrently if not exists messages_invoice_id_idx
  on public.messages (invoice_id) where invoice_id is not null;

-- ---- read-back ----------------------------------------------------------------
-- Expect both, and both valid (indisvalid = true).
select i.relname as index_name, idx.indisvalid as valid
  from pg_class i
  join pg_index idx on idx.indexrelid = i.oid
 where i.relname in ('crm_events_invoice_id_idx', 'messages_invoice_id_idx')
 order by 1;

-- PRODUCTION ONLY:
insert into public._prod_migrations(name)
values ('20270139000000_invoice_fk_indexes.sql')
on conflict (name) do nothing;
