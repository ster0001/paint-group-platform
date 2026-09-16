-- Session 1 of the messaging-automations brief (Tom, 16 Sep 2026):
-- the control screen's two tables.
--
--   automation_holds  — an automatic message that did NOT go out the moment
--                       it fired: the office chose "approves first" (pending),
--                       or it fell in quiet hours / over the daily cap (held,
--                       with a release time). One row = one message with both
--                       renditions (email + text) so it can be edited, then
--                       sent through the same path. The "Messages to approve"
--                       list on Today is DERIVED from pending rows here — no
--                       work_items table (CLAUDE.md one-queue rule).
--   automation_claims — once-only claims for reminder rungs and any other
--                       per-entity send: (automation, entity, rung) can be
--                       claimed exactly once, so a sweep that runs twice never
--                       double-sends. Sessions 3–7 lean on this.
--
-- Written by the service role (the dispatcher); read and decided by staff.

create table if not exists public.automation_holds (
  id              uuid primary key default gen_random_uuid(),
  automation_key  text not null,
  audience        text not null check (audience in ('customer', 'painter', 'office')),
  account_id      uuid references public.accounts(id) on delete set null,
  contractor_id   uuid references public.contractors(id) on delete set null,
  estimate_id     uuid references public.estimates(id) on delete cascade,
  work_order_id   uuid references public.work_orders(id) on delete cascade,
  invoice_id      uuid,
  to_email        text,
  to_phone        text,
  channels        text[] not null default '{}',          -- planned channels, in send order
  subject         text,
  body_html       text,
  sms_body        text,
  attachments     jsonb,                                  -- Resend shape, base64 content
  ctx             jsonb not null default '{}',            -- MessageContext as the send site gave it
  reason          text not null check (reason in ('approve', 'quiet', 'cap')),
  reason_detail   text,
  release_at      timestamptz,                            -- null for 'approve'
  status          text not null default 'pending' check (status in ('pending', 'held', 'sent', 'skipped', 'failed')),
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  result          jsonb,                                  -- per-channel outcome once sent
  created_at      timestamptz not null default now()
);

create index if not exists automation_holds_open_idx
  on public.automation_holds (status, release_at) where status in ('pending', 'held');
create index if not exists automation_holds_account_idx
  on public.automation_holds (account_id, created_at desc) where account_id is not null;
create index if not exists automation_holds_wo_idx
  on public.automation_holds (work_order_id) where work_order_id is not null;

alter table public.automation_holds enable row level security;

drop policy if exists automation_holds_staff_read on public.automation_holds;
create policy automation_holds_staff_read on public.automation_holds
  for select to authenticated using (public.is_staff());
drop policy if exists automation_holds_staff_update on public.automation_holds;
create policy automation_holds_staff_update on public.automation_holds
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.automation_claims (
  automation_key  text not null,
  entity_id       text not null,
  rung            text not null default '',
  claimed_at      timestamptz not null default now(),
  primary key (automation_key, entity_id, rung)
);

alter table public.automation_claims enable row level security;
drop policy if exists automation_claims_staff_read on public.automation_claims;
create policy automation_claims_staff_read on public.automation_claims
  for select to authenticated using (public.is_staff());

-- Read back what was made (CLAUDE.md: never assume the tail applied).
select tablename, policyname from pg_policies
 where schemaname = 'public' and tablename in ('automation_holds', 'automation_claims')
 order by 1, 2;

insert into public._prod_migrations(name) values ('20270150000000_automation_holds.sql') on conflict (name) do nothing;
