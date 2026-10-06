-- =============================================================================
-- Visit requests and customer messages (visit booking addendum A, S4 — 6 Oct 2026).
--
-- Three things create a REQUEST rather than a booking (§4.4): a visit asked
-- for before the price range (R3), a pre-arranged address (R10), and a zone
-- customer who taps "None of these suit" or whose zone has nothing free (R19).
-- A fourth kind is the CALL request from "Speak with us" (R25). Each is one
-- row here, answered within one working day (R23, R33). The work queue DERIVES
-- its item from the row (answered_at null); nothing is stored twice.
--
-- `customer_message_receipts` is the idempotency fact for "Send us a message"
-- (section 8, test 17): the browser sends a client id with the message; a
-- retry with the same id is answered "already sent" and nothing is posted or
-- emailed twice. The messages themselves live in the two EXISTING stores —
-- the estimate chat (`estimate_messages`) after the range, the website chat
-- (`agent_conversations`) before it — never in a third.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. requests --------------------------------------------------------------
create table if not exists public.visit_requests (
  id             uuid primary key default gen_random_uuid(),
  -- time: a zone/pre-arranged/unmapped customer asks for a time; visit: asked before the range; call: Speak with us.
  kind           text not null check (kind in ('time', 'visit', 'call')),
  estimate_id    uuid references public.estimates (id) on delete set null,
  draft_id       uuid,
  account_id     uuid references public.accounts (id) on delete set null,
  property_id    uuid references public.properties (id) on delete set null,
  -- The address's outcome when the request was made (zone_1…5, pre_arranged, out_of_area, unmapped).
  zone           text not null default 'unmapped',
  suburb         text,
  postcode       text,
  address        text,
  name           text not null,
  email          text,
  mobile         text,
  note           text,
  -- "Days that suit": 0 = Sunday … 6 = Saturday; and morning | afternoon | either.
  preferred_days smallint[] not null default '{}',
  time_of_day    text check (time_of_day is null or time_of_day in ('morning', 'afternoon', 'either')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  -- R23/R33: end of the next working day, Melbourne, public holidays excluded. Computed on the server.
  due_at         timestamptz not null,
  answered_at    timestamptz,
  answered_by    uuid references public.profiles (id) on delete set null,
  answer         text,
  -- When staff answered by offering a time (4.4), the visit that made.
  visit_id       uuid references public.visits (id) on delete set null,
  constraint visit_requests_note_len check (note is null or char_length(note) <= 2000)
);
create index if not exists visit_requests_open_idx on public.visit_requests (due_at) where answered_at is null;
create index if not exists visit_requests_estimate_idx on public.visit_requests (estimate_id);
create index if not exists visit_requests_account_idx on public.visit_requests (account_id);

alter table public.visit_requests enable row level security;
drop policy if exists visit_requests_staff_all on public.visit_requests;
create policy visit_requests_staff_all on public.visit_requests
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
revoke all on public.visit_requests from anon;
grant select, insert, update, delete on public.visit_requests to authenticated;

-- ---- 2. message receipts (idempotency) -----------------------------------------
create table if not exists public.customer_message_receipts (
  client_id       uuid primary key,
  estimate_id     uuid references public.estimates (id) on delete set null,
  conversation_id uuid,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
alter table public.customer_message_receipts enable row level security;
drop policy if exists customer_message_receipts_staff_read on public.customer_message_receipts;
create policy customer_message_receipts_staff_read on public.customer_message_receipts
  for select to authenticated using ((select public.is_staff()));
revoke all on public.customer_message_receipts from anon;
revoke insert, update, delete on public.customer_message_receipts from authenticated;
grant select on public.customer_message_receipts to authenticated;

-- ---- 3. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('visit_requests', 'customer_message_receipts')) as policies,
  2 as _expect_policies,
  (select count(*) from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('visit_requests', 'customer_message_receipts')) as rls_on,
  2 as _expect_rls_on,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'visit_requests_open_idx') as open_index,
  1 as _expect_open_index,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in ('visit_requests', 'customer_message_receipts')) as anon_grants,
  0 as _expect_anon_grants;

insert into public._prod_migrations(name) values ('20270215000000_visit_requests.sql') on conflict (name) do nothing;
